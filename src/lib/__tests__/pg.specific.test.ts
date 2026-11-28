import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { seedId as S } from "../data/ids";
import { applyMigrations } from "../data/pg/migrate";
import { createPool } from "../data/pg/pool";
import { deriveHandoverCode } from "../handover";
import type { AppError } from "../types";
import { endTestPool, makePgEnv, TEST_URL, type PgEnv } from "./pg-env";

const suite = TEST_URL ? describe : describe.skip;
const PHOTO = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ";
// PNG 1x1 valide
const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");
const code = (e: unknown) => (e as AppError).code;

afterAll(endTestPool);

suite("PostgreSQL : comportements propres à la base", () => {
  let env: PgEnv;
  let data: PgEnv["data"];
  beforeEach(async () => {
    env = await makePgEnv();
    data = env.data;
  });

  async function signup(phone: string, name: string) {
    await data.requestOtp(phone);
    return (await data.verifyOtp(phone, "123456", name)).user;
  }
  async function listing(sellerId: string, over: Record<string, unknown> = {}) {
    const d = await data.createDraft(sellerId, {
      title: "Robe test", description: "", categoryId: S("cat-robes"), condition: "good", priceMinor: 2500, currency: "USD", areaId: S("area-com-gombe"), photos: [PHOTO], ...over,
    });
    return data.publishItem(sellerId, d.id);
  }
  const rejects = async (p: Promise<unknown>): Promise<AppError> => {
    try { await p; } catch (e) { return e as AppError; }
    throw new Error("aurait dû échouer");
  };
  async function paid(buyerPhone: string, priceMinor = 2500) {
    const seller = (await data.getUser(S("user-marie")))!;
    const buyer = await signup(buyerPhone, "Acheteur");
    const item = await listing(seller.id, { priceMinor });
    const order = await data.createOrder(buyer.id, { itemIds: [item.id], deliveryMethod: "hand_delivery" });
    await data.startPayment(order.id, buyer.id, { method: "mpesa", msisdn: buyerPhone, idempotencyKey: `k-${order.id}` });
    await env.flush();
    return { seller, buyer, item, order };
  }

  it("migrations : modifier un fichier déjà appliqué est refusé (on écrit une nouvelle migration)", async () => {
    const admin = createPool(TEST_URL!.replace(/\/[^/]*$/, "/postgres"));
    const name = `mig_${Date.now()}`;
    await admin.query(`create database ${name}`);
    const scratch = createPool(TEST_URL!.replace(/\/[^/]*$/, `/${name}`));
    const dir = mkdtempSync(join(tmpdir(), "mig-"));
    try {
      writeFileSync(join(dir, "0001_a.sql"), "create table t1 (id int);");
      expect(await applyMigrations(scratch, dir)).toEqual(["0001_a.sql"]);
      expect(await applyMigrations(scratch, dir)).toEqual([]); // rejouable
      writeFileSync(join(dir, "0002_b.sql"), "create table t2 (id int);");
      expect(await applyMigrations(scratch, dir)).toEqual(["0002_b.sql"]);
      writeFileSync(join(dir, "0001_a.sql"), "create table t1 (id int, extra int);");
      await expect(applyMigrations(scratch, dir)).rejects.toThrow(/modifiée après/);
      writeFileSync(join(dir, "0003_bad.sql"), "create table t3 (id int); select no_such_function();");
      writeFileSync(join(dir, "0001_a.sql"), "create table t1 (id int);");
      await expect(applyMigrations(scratch, dir)).rejects.toThrow(/0003_bad/);
      // la migration en échec n'a rien laissé derrière elle (transaction annulée)
      expect((await scratch.query(`select to_regclass('public.t3') as r`)).rows[0].r).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
      await scratch.end();
      await admin.query(`drop database ${name} with (force)`);
      await admin.end();
    }
  });

  it("secrets : le jeton de session et le code SMS ne sont jamais stockés en clair", async () => {
    const u = await signup("0831000001", "Secret");
    const { token } = await data.createSession(u.id);
    const s = (await env.pool.query(`select token_hash from sessions where user_id = $1`, [u.id])).rows[0];
    expect(s.token_hash).toBe(sha256(token));
    expect(s.token_hash).not.toContain(token);
    await data.requestOtp("0831000002");
    const o = (await env.pool.query(`select code_hash from otp_codes where phone = '+243831000002'`)).rows[0];
    expect(o.code_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(o.code_hash).not.toContain("123456");
    // le code de remise n'est pas stocké non plus : seulement son empreinte
    const { order } = await paid("0831000003");
    const sh = (await env.pool.query(`select handover_code_hash from shipments where order_id = $1`, [order.id])).rows[0];
    expect(sh.handover_code_hash).toBe(sha256(deriveHandoverCode(order.id)));
    expect(sh.handover_code_hash).not.toContain(deriveHandoverCode(order.id));
  });

  it("le code SMS envoyé n'est pas renvoyé au client en production-like (devCode seulement avec le fournisseur console)", async () => {
    const r = await data.requestOtp("0831000004");
    expect(r.devCode).toBe("123456"); // fournisseur console + hors production
    expect(env.sms.sent.at(-1)?.text).toContain("123456");
  });

  it("concurrence : 8 acheteurs simultanés sur le même article, un seul l'obtient", async () => {
    const m = (await data.getUser(S("user-marie")))!;
    const item = await listing(m.id);
    const buyers = await Promise.all(Array.from({ length: 8 }, (_, i) => signup(`08320000${String(i).padStart(2, "0")}`, `Acheteur ${i}`)));
    const results = await Promise.allSettled(buyers.map((b) => data.createOrder(b.id, { itemIds: [item.id], deliveryMethod: "hand_delivery" })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const r of results) if (r.status === "rejected") expect(code(r.reason)).toBe("ITEM_UNAVAILABLE");
    expect((await env.pool.query(`select count(*)::int as n from order_items where item_id = $1 and is_open`, [item.id])).rows[0].n).toBe(1);
  });

  it("concurrence : deux commandes qui prennent les mêmes articles dans l'ordre inverse ne provoquent pas d'interblocage", async () => {
    const m = (await data.getUser(S("user-marie")))!;
    const [i1, i2] = [await listing(m.id), await listing(m.id)];
    const a = await signup("0833000001", "Acheteur A");
    const b = await signup("0833000002", "Acheteur B");
    const results = await Promise.allSettled([
      data.createOrder(a.id, { itemIds: [i1.id, i2.id], deliveryMethod: "hand_delivery" }),
      data.createOrder(b.id, { itemIds: [i2.id, i1.id], deliveryMethod: "hand_delivery" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const lost = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(code(lost.reason)).toBe("ITEM_UNAVAILABLE"); // pas « deadlock detected »
  });

  it("concurrence : deux retraits simultanés ne dépensent pas deux fois le même solde", async () => {
    const { order, seller } = await paid("0834000001", 20_000);
    await data.confirmDelivery(order.id, seller.id, deriveHandoverCode(order.id));
    const base = { currency: "USD" as const, method: "mpesa" as const, msisdn: "0810000001", amountMinor: 12_000 };
    const results = await Promise.allSettled([
      data.requestPayout(seller.id, { ...base, idempotencyKey: "retrait-aaaa-1" }),
      data.requestPayout(seller.id, { ...base, idempotencyKey: "retrait-bbbb-2" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const lost = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(code(lost.reason)).toBe("INSUFFICIENT_FUNDS");
    const w = await data.getWallet(seller.id);
    expect(w.balances.find((b) => b.currency === "USD")!.availableMinor).toBeGreaterThanOrEqual(0);
  });

  it("concurrence : la même clé d'idempotence envoyée deux fois en même temps ne crée qu'un retrait", async () => {
    const { order, seller } = await paid("0834000002", 20_000);
    await data.confirmDelivery(order.id, seller.id, deriveHandoverCode(order.id));
    const input = { currency: "USD" as const, method: "mpesa" as const, msisdn: "0810000001", amountMinor: 5_000, idempotencyKey: "meme-cle-1234" };
    const [a, b] = await Promise.all([data.requestPayout(seller.id, input), data.requestPayout(seller.id, input)]);
    expect(a.id).toBe(b.id);
    expect(await data.listPayouts(seller.id)).toHaveLength(1);
  });

  it("concurrence : un webhook reçu deux fois en même temps n'encaisse qu'une fois", async () => {
    const m = (await data.getUser(S("user-marie")))!;
    const buyer = await signup("0835000001", "Acheteur C");
    const item = await listing(m.id);
    const o = await data.createOrder(buyer.id, { itemIds: [item.id], deliveryMethod: "hand_delivery" });
    await data.startPayment(o.id, buyer.id, { method: "mpesa", msisdn: "0835000001", idempotencyKey: "webhook-race-1" });
    const [ev] = await env.pendingEvents();
    const [r1, r2] = await Promise.all([data.handleProviderEvent(ev), data.handleProviderEvent(ev)]);
    expect([r1.duplicate, r2.duplicate].sort()).toEqual([false, true]);
    const holds = (await env.ledger()).filter((e) => e.account === "order_escrow");
    expect(holds).toHaveLength(1);
    expect(holds[0].amountMinor).toBe(-o.totalMinor);
  });

  it("webhook arrivé AVANT l'écriture de notre référence : non consommé, traité au rejeu", async () => {
    const m = (await data.getUser(S("user-marie")))!;
    const buyer = await signup("0835000002", "Acheteur D");
    const item = await listing(m.id);
    const o = await data.createOrder(buyer.id, { itemIds: [item.id], deliveryMethod: "hand_delivery" });
    const ev = { eventId: "evt-precoce", type: "collection.succeeded" as const, providerRef: "ref-pas-encore-connue" };
    expect(await data.handleProviderEvent(ev)).toEqual({ duplicate: false, matched: false });
    expect((await env.pool.query(`select count(*)::int as n from webhook_events`)).rows[0].n).toBe(0); // pas consommé
    await data.startPayment(o.id, buyer.id, { method: "mpesa", msisdn: "0835000002", idempotencyKey: "precoce-1" });
    await env.pool.query(`update payments set provider_ref = 'ref-pas-encore-connue' where order_id = $1`, [o.id]);
    expect((await data.handleProviderEvent(ev)).matched).toBe(true);
    expect((await data.getOrder(o.id, buyer.id)).status).toBe("paid");
  });

  it("rattrapage : un paiement dont le webhook s'est perdu est résolu en interrogeant le fournisseur", async () => {
    const m = (await data.getUser(S("user-marie")))!;
    const buyer = await signup("0836000001", "Acheteur E");
    const item = await listing(m.id);
    const o = await data.createOrder(buyer.id, { itemIds: [item.id], deliveryMethod: "hand_delivery" });
    await data.startPayment(o.id, buyer.id, { method: "mpesa", msisdn: "0836000001", idempotencyKey: "perdu-1234" });
    env.advance(3 * 60_000); // le webhook n'est jamais arrivé (on ne vide pas la file)
    expect(await data.reconcilePendingPayments()).toBe(1);
    expect((await data.getOrder(o.id, buyer.id)).status).toBe("paid");
    await env.flush(); // le vrai webhook arrive enfin : sans effet
    expect((await env.ledger()).filter((e) => e.account === "order_escrow")).toHaveLength(1);
  });

  it("rattrapage : une demande jamais confirmée par le fournisseur est abandonnée", async () => {
    const m = (await data.getUser(S("user-marie")))!;
    const buyer = await signup("0836000002", "Acheteur F");
    const item = await listing(m.id);
    const o = await data.createOrder(buyer.id, { itemIds: [item.id], deliveryMethod: "hand_delivery" });
    await env.pool.query(
      `insert into payments (order_id, provider, method, msisdn, amount_minor, currency, status, idempotency_key, created_at) values ($1,'fake','mpesa','+243836000002',$2,'USD','initiated','orphelin-123',$3)`,
      [o.id, o.totalMinor, new Date(env.now() - 10 * 60_000)]);
    expect(await data.reconcilePendingPayments()).toBe(1);
    expect((await env.pool.query(`select status, failure_code from payments where idempotency_key = 'orphelin-123'`)).rows[0]).toEqual({ status: "failed", failure_code: "PROVIDER_TIMEOUT" });
  });

  it("paramètres : les frais se changent en base, une valeur invalide est ignorée", async () => {
    const m = (await data.getUser(S("user-marie")))!;
    const buyer = await signup("0837000001", "Acheteur G");
    await env.pool.query(`update settings set value = '{"pct_bps":1000,"fixed_minor":{"USD":50,"CDF":100000}}' where key = 'buyer_protection'`);
    const item = await listing(m.id, { priceMinor: 10_000 });
    expect((await data.createOrder(buyer.id, { itemIds: [item.id], deliveryMethod: "hand_delivery" })).protectionFeeMinor).toBe(1000); // 10 %
    await env.pool.query(`update settings set value = '"abc"' where key = 'max_item_value_usd_minor'`);
    const e = await rejects(listing(m.id, { priceMinor: 100_001 }));
    expect(e.details?.priceMinor).toMatch(/maximum/); // valeur invalide : le plafond par défaut s'applique toujours
  });

  it("photos : le type vient du CONTENU, une fausse image est refusée, la lecture renvoie les octets", async () => {
    const m = (await data.getUser(S("user-marie")))!;
    const base = { title: "Photo test", description: "", categoryId: S("cat-robes"), condition: "good", priceMinor: 100, currency: "USD" };
    const svg = `data:image/jpeg;base64,${Buffer.from("<svg onload=alert(1)>").toString("base64")}`;
    expect(code(await rejects(data.createDraft(m.id, { ...base, photos: [svg] })))).toBe("VALIDATION");
    const png = await data.createDraft(m.id, { ...base, photos: [`data:image/jpeg;base64,${PNG_B64}`] }); // annoncée « jpeg », c'est un PNG
    expect(png.photos[0]).toMatch(/^\/api\/v1\/photos\/[0-9a-f-]{36}$/);
    const blob = await data.getPhoto(png.photos[0].split("/").pop()!);
    expect(blob?.mime).toBe("image/png");
    expect(blob?.bytes.length).toBeGreaterThan(20);
    expect(await data.getPhoto("pas-un-uuid")).toBeNull();
    const big = `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(460_000)]).toString("base64")}`;
    expect(code(await rejects(data.createDraft(m.id, { ...base, photos: [big] })))).toBe("VALIDATION");
  });

  it("données invalides : erreur de validation propre, jamais une erreur serveur", async () => {
    const m = (await data.getUser(S("user-marie")))!;
    const base = { title: "Titre ok", description: "", categoryId: S("cat-robes"), condition: "good", priceMinor: 100, currency: "USD", photos: [PHOTO] };
    expect(code(await rejects(data.createDraft(m.id, { ...base, categoryId: "00000000-0000-4000-8000-000000000999" })))).toBe("VALIDATION"); // catégorie inconnue
    expect(code(await rejects(data.createDraft(m.id, { ...base, condition: "cassé" })))).toBe("VALIDATION"); // état hors liste
    expect(code(await rejects(data.createDraft(m.id, { ...base, priceMinor: -5 })))).toBe("VALIDATION"); // prix négatif
    expect(code(await rejects(data.createDraft(m.id, { ...base, currency: "EUR" })))).toBe("VALIDATION"); // devise inconnue
  });

  it("refus par défaut : même avec des droits de lecture accordés, un rôle soumis à la RLS ne voit aucune ligne", async () => {
    const tables = (await env.pool.query(`select relname, relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and relname <> 'schema_migrations'`)).rows;
    expect(tables.length).toBeGreaterThanOrEqual(33);
    expect(tables.filter((t) => !t.relrowsecurity).map((t) => t.relname)).toEqual([]); // toutes les tables ont la RLS
    await paid("0838000001"); // il existe maintenant des lignes sensibles
    const c = await env.pool.connect();
    try {
      await c.query(`do $$ begin if not exists (select 1 from pg_roles where rolname = 'anon_test') then create role anon_test nologin; end if; end $$`);
      await c.query(`grant select on profiles, orders, payments, ledger_entries, sessions, otp_codes to anon_test`); // simule les droits par défaut de Supabase
      await c.query(`set role anon_test`);
      for (const t of ["profiles", "orders", "payments", "ledger_entries", "sessions", "otp_codes"]) {
        expect((await c.query(`select count(*)::int as n from ${t}`)).rows[0].n, t).toBe(0);
      }
      await c.query(`reset role`);
    } finally {
      await c.query(`reset role`).catch(() => undefined);
      c.release();
    }
  });
});

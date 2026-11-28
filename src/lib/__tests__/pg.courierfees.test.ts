import { afterAll, describe, expect, it } from "vitest";
import { FEES } from "../fees";
import { seedId as S } from "../data/ids";
import type { AppError } from "../types";
import { endTestPool, makePgEnv, TEST_URL } from "./pg-env";

const suite = TEST_URL ? describe : describe.skip;
afterAll(endTestPool);

// agent G : propriétés propres à PostgreSQL (concurrence, contraintes, réglage en base).
suite("PostgreSQL : frais de livraison par coursier", () => {
  async function releasedPlatformOrders(n: number) {
    const env = await makePgEnv();
    const data = env.data;
    await data.setCourierFeeMode(S("user-admin-1"), "platform");
    const seller = (await data.getUser(S("user-marie")))!;
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const phone = `08210004${String(10 + i).padStart(2, "0")}`;
      await data.requestOtp(phone);
      const buyer = (await data.verifyOtp(phone, "123456", `Acheteur Règlement ${i}`)).user;
      const d = await data.createDraft(seller.id, { title: `Robe règlement ${i}`, description: "", categoryId: S("cat-robes"), condition: "good", priceMinor: 2500, currency: "USD", areaId: S("area-com-gombe"), photos: ["data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ"] });
      const item = await data.publishItem(seller.id, d.id);
      const o = await data.createOrder(buyer.id, { itemIds: [item.id], deliveryMethod: "courier", deliveryAreaId: S("area-com-limete"), deliveryLandmark: "Avenue de la Paix, portail bleu" });
      await data.startPayment(o.id, buyer.id, { method: "mpesa", msisdn: "0821111111", idempotencyKey: `k-${o.id}` });
      await env.flush();
      await data.shipOrder(o.id, seller.id, { courierName: "Papy Moto", courierPhone: "0899000111" });
      await data.markInTransit(o.id, seller.id);
      await data.confirmReceived(o.id, buyer.id);
      ids.push(o.id);
    }
    env.advance(FEES.claimWindowMs + 1000);
    expect(await data.releaseDeliveredOrders()).toBe(n);
    return { env, data, ids };
  }

  it("règlements simultanés de la même commande : un seul passe, les autres reçoivent un 409 propre ; le grand livre ne compte le règlement qu'une fois", async () => {
    const { env, data, ids } = await releasedPlatformOrders(6);
    let conflicts = 0;
    for (const id of ids) {
      const results = await Promise.allSettled(Array.from({ length: 6 }, () => data.settleCourierFee(S("user-support-1"), id)));
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      for (const r of results) {
        if (r.status === "rejected") {
          expect((r.reason as AppError).code, "jamais d'erreur interne").toBe("INVALID_STATE");
          expect((r.reason as AppError).status).toBe(409);
          conflicts++;
        }
      }
    }
    expect(conflicts).toBe(ids.length * 5);
    const ledger = await env.ledger();
    const sum = (a: string) => ledger.filter((e) => e.account === a).reduce((s, e) => s + e.amountMinor, 0);
    expect(sum("shipping_payable")).toBe(0);
    expect(sum("courier_paid")).toBe(-ids.length * FEES.shippingGrid.sameCity.USD);
    expect(ledger.reduce((s, e) => s + e.amountMinor, 0)).toBe(0);
    const rows = (await env.pool.query(`select count(*)::int as n from courier_settlements`)).rows[0].n;
    expect(rows).toBe(ids.length);
  });

  it("le réglage vit dans la table settings : une valeur écrite en base est lue, une valeur invalide retombe sur « seller »", async () => {
    const env = await makePgEnv();
    expect(await env.data.getCourierFeeMode()).toBe("seller"); // valeur semée
    await env.pool.query(`update settings set value = '"platform"'::jsonb where key = 'courier_fee_mode'`);
    expect(await env.data.getCourierFeeMode()).toBe("platform"); // settingsTtlMs = 0 dans les tests
    await env.pool.query(`update settings set value = '"nimportequoi"'::jsonb where key = 'courier_fee_mode'`);
    expect(await env.data.getCourierFeeMode()).toBe("seller");
  });

  it("le grand livre accepte courier_paid et order_shipping mais refuse toujours un compte inconnu et une transaction déséquilibrée", async () => {
    const env = await makePgEnv();
    const q = (account: string, amount: number, refType = "adjustment", txn = "11111111-1111-4111-8111-111111111111") =>
      env.pool.query(`insert into ledger_entries (txn_id, account, currency, amount_minor, ref_type, ref_id) values ($1,$2,'USD',$3,$4,$1)`, [txn, account, amount, refType]);
    await expect(q("compte_inconnu", 5)).rejects.toThrow();
    await expect(q("courier_paid", -5, "order_shipping")).rejects.toThrow(/unbalanced/); // seule, la ligne déséquilibre la transaction
    const c = await env.pool.connect();
    try {
      await c.query("begin");
      await c.query(`insert into ledger_entries (txn_id, account, currency, amount_minor, ref_type, ref_id) values ('22222222-2222-4222-8222-222222222222','shipping_payable','USD',5,'adjustment','22222222-2222-4222-8222-222222222222'), ('22222222-2222-4222-8222-222222222222','courier_paid','USD',-5,'order_shipping','22222222-2222-4222-8222-222222222222')`);
      await c.query("commit");
    } finally {
      c.release();
    }
  });
});

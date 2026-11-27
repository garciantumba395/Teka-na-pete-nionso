import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deriveHandoverCode } from "../handover";
import { FEES } from "../fees";
import { AppError, type LedgerEntry, type ProviderEvent } from "../types";
import { seedId as S } from "../data/ids";
import type { DataLayer } from "../data/types";

/**
 * SUITE DE CONTRAT de DataLayer. Les MÊMES scénarios s'exécutent contre la couche factice (fake.contract.test.ts)
 * et contre un vrai PostgreSQL (pg.contract.test.ts) : c'est ce qui prouve que l'une remplace l'autre
 * sans changer le comportement visible par les écrans.
 */
export interface ContractEnv {
  data: DataLayer;
  now(): number;
  advance(ms: number): void;
  ledger(): Promise<LedgerEntry[]>;
  pendingEvents(): Promise<ProviderEvent[]>;
  flush(): Promise<void>;
  refunds(): number;
  /** agent C : SMS « envoyés » par le fournisseur factice, et attente des envois en cours (ils ne bloquent jamais la méthode métier). */
  sentSms(): { to: string; text: string }[];
  settleSms(): Promise<void>;
  close?(): Promise<void>;
}

export function defineContract(label: string, factory: () => Promise<ContractEnv>, opts: { skip?: boolean } = {}) {
  const suite = opts.skip ? describe.skip : describe;
  suite(`contrat DataLayer : ${label}`, () => {
    let env: ContractEnv;
    let data: DataLayer;
    const PHOTO = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ";

    beforeEach(async () => {
      env = await factory();
      data = env.data;
    });
    afterEach(async () => {
      await env.close?.();
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
    const code = (e: unknown) => (e as AppError).code;
    async function rejects(p: Promise<unknown>): Promise<AppError> {
      try {
        await p;
      } catch (e) {
        return e as AppError;
      }
      throw new Error("aurait dû échouer");
    }
    /** Somme du grand livre par devise : doit toujours être nulle. */
    const ledgerSum = async (cur: "USD" | "CDF") => (await env.ledger()).filter((e) => e.currency === cur).reduce((s, e) => s + e.amountMinor, 0);
    const account = async (a: string, cur: "USD" | "CDF" = "USD") => (await env.ledger()).filter((e) => e.account === a && e.currency === cur).reduce((s, e) => s + e.amountMinor, 0);

    async function paidOrder(buyerName = "Acheteur", phone = "+243821111111", priceMinor = 2500) {
      const seller = (await data.getUser(S("user-marie")))!;
      const buyer = await signup(phone, buyerName);
      const item = await listing(seller.id, { priceMinor });
      const order = await data.createOrder(buyer.id, { itemIds: [item.id], deliveryMethod: "hand_delivery" });
      await data.startPayment(order.id, buyer.id, { method: "mpesa", msisdn: "0821111111", idempotencyKey: `k-${order.id}` });
      await env.flush();
      return { seller, buyer, item, order };
    }

    describe("authentification par téléphone", () => {
      it("refuse un numéro invalide", async () => {
        expect(code(await rejects(data.requestOtp("12345")))).toBe("PHONE_INVALID");
      });
      it("crée un compte seulement avec un nom, puis connecte un compte existant", async () => {
        await data.requestOtp("0831234567");
        expect(code(await rejects(data.verifyOtp("0831234567", "123456")))).toBe("NAME_REQUIRED");
        const r = await data.verifyOtp("0831234567", "123456", "Nouveau");
        expect(r.isNew).toBe(true);
        await data.requestOtp("+243831234567");
        const again = await data.verifyOtp("831234567", "123456");
        expect(again.isNew).toBe(false);
        expect(again.user.id).toBe(r.user.id);
      });
      it("verrouille après 5 mauvais codes et limite les envois", async () => {
        await data.requestOtp("0831234567");
        for (let i = 0; i < 5; i++) expect(code(await rejects(data.verifyOtp("0831234567", "000000", "X Y")))).toBe("OTP_WRONG");
        expect(code(await rejects(data.verifyOtp("0831234567", "123456", "X Y")))).toBe("OTP_LOCKED");
        await data.requestOtp("0831234567");
        await data.requestOtp("0831234567");
        expect(code(await rejects(data.requestOtp("0831234567")))).toBe("OTP_RATE_LIMIT");
      });
      it("le code expire", async () => {
        await data.requestOtp("0831234567");
        env.advance(6 * 60_000);
        expect(code(await rejects(data.verifyOtp("0831234567", "123456", "X Y")))).toBe("OTP_EXPIRED");
      });
    });

    describe("annonces", () => {
      it("refuse une photo qui n'est pas une image compressée, et au-delà de 20", async () => {
        const m = (await data.getUser(S("user-marie")))!;
        const base = { title: "Robe test", description: "", categoryId: S("cat-robes"), condition: "good", priceMinor: 100, currency: "USD", photos: ["<script>"] };
        expect(code(await rejects(data.createDraft(m.id, base)))).toBe("VALIDATION");
        expect(code(await rejects(data.createDraft(m.id, { ...base, photos: Array(21).fill(PHOTO) })))).toBe("VALIDATION");
      });
      it("applique le plafond de prix et la catégorie à la publication (côté serveur)", async () => {
        const m = (await data.getUser(S("user-marie")))!;
        const e = await rejects(listing(m.id, { priceMinor: 100_001 }));
        expect(e.code).toBe("VALIDATION");
        expect(e.details?.priceMinor).toMatch(/maximum/);
        expect((await rejects(listing(m.id, { categoryId: S("cat-femme") }))).details?.categoryId).toMatch(/n'accepte pas/);
        expect((await rejects(listing(m.id, { photos: [] }))).details?.photos).toMatch(/photo/);
      });
      it("un brouillon n'est visible que de son vendeur ; une annonce publiée l'est de tous", async () => {
        const m = (await data.getUser(S("user-marie")))!;
        const d = await data.createDraft(m.id, { title: "Brouillon", description: "", categoryId: S("cat-robes"), condition: "good", priceMinor: 100, currency: "USD", photos: [PHOTO] });
        expect(await data.getItem(d.id, S("user-patrick"))).toBeNull();
        expect(await data.getItem(d.id, m.id)).not.toBeNull();
        await data.publishItem(m.id, d.id);
        expect(await data.getItem(d.id, S("user-patrick"))).not.toBeNull();
        expect(code(await rejects(data.publishItem(m.id, d.id)))).toBe("INVALID_STATE");
      });
      it("la position de l'annonce est approximative (arrondie)", async () => {
        const m = (await data.getUser(S("user-marie")))!;
        const it = await listing(m.id);
        expect(it.lat).toBe(Math.round(it.lat! * 100) / 100);
      });
      it("recherche : texte sans accents, catégorie parente, rayon", async () => {
        expect((await data.listItems({ q: "ecouteurs" })).map((c) => c.title)).toContain("Écouteurs filaires");
        const femmes = await data.listItems({ categoryId: S("cat-femme") });
        expect(femmes.length).toBeGreaterThan(3);
        const near = await data.listItems({ areaId: S("area-com-gombe"), radiusKm: 3 });
        expect(near.length).toBeGreaterThan(0);
        expect(near.every((c) => c.distanceKm! <= 3)).toBe(true);
        const wider = await data.listItems({ areaId: S("area-com-gombe"), radiusKm: 15 });
        expect(wider.length).toBeGreaterThan(near.length);
      });
    });

    describe("commande et réservation", () => {
      it("deux acheteurs, un seul article : un seul gagne", async () => {
        const m = (await data.getUser(S("user-marie")))!;
        const a = await signup("0821000001", "Acheteur A");
        const b = await signup("0821000002", "Acheteur B");
        const item = await listing(m.id);
        const results = await Promise.allSettled([
          data.createOrder(a.id, { itemIds: [item.id], deliveryMethod: "hand_delivery" }),
          data.createOrder(b.id, { itemIds: [item.id], deliveryMethod: "hand_delivery" }),
        ]);
        expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
        const lost = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
        expect(code(lost.reason)).toBe("ITEM_UNAVAILABLE");
        expect((await data.getItem(item.id))!.status).toBe("reserved");
      });
      it("refuse l'achat de son propre article et les devises mélangées", async () => {
        const m = (await data.getUser(S("user-marie")))!;
        const own = await listing(m.id);
        expect(code(await rejects(data.createOrder(m.id, { itemIds: [own.id], deliveryMethod: "hand_delivery" })))).toBe("SELF_PURCHASE");
        const buyer = await signup("0821000003", "Acheteur C");
        const usd = await listing(m.id);
        const cdf = await listing(m.id, { currency: "CDF", priceMinor: 3_500_000 });
        expect(code(await rejects(data.createOrder(buyer.id, { itemIds: [usd.id, cdf.id], deliveryMethod: "hand_delivery" })))).toBe("MIXED_CURRENCY");
      });
      it("le total = articles + frais de protection, calculé par le serveur", async () => {
        const m = (await data.getUser(S("user-marie")))!;
        const buyer = await signup("0821000004", "Acheteur D");
        const item = await listing(m.id, { priceMinor: 10_000 });
        const o = await data.createOrder(buyer.id, { itemIds: [item.id], deliveryMethod: "hand_delivery" });
        expect(o.protectionFeeMinor).toBe(500);
        expect(o.totalMinor).toBe(10_500);
      });
      it("un tiers ne voit pas la commande", async () => {
        const { order } = await paidOrder();
        const tiers = await signup("0821000009", "Tiers");
        expect(code(await rejects(data.getOrder(order.id, tiers.id)))).toBe("NOT_FOUND");
      });
      it("expire après le délai et libère l'article", async () => {
        const m = (await data.getUser(S("user-marie")))!;
        const buyer = await signup("0821000005", "Acheteur E");
        const item = await listing(m.id);
        const o = await data.createOrder(buyer.id, { itemIds: [item.id], deliveryMethod: "hand_delivery" });
        env.advance(FEES.orderPaymentTtlMs + 1);
        expect((await data.getOrder(o.id, buyer.id)).status).toBe("expired");
        expect((await data.getItem(item.id))!.status).toBe("active");
      });
    });

    describe("paiement et séquestre", () => {
      it("paiement réussi : commande payée, argent mis de côté, code visible de l'acheteur seul", async () => {
        const { order, buyer, seller } = await paidOrder();
        const v = await data.getOrder(order.id, buyer.id);
        expect(v.status).toBe("paid");
        expect(await account("order_escrow")).toBe(-order.totalMinor);
        expect(await account("psp_clearing")).toBe(order.totalMinor);
        expect(await data.getHandoverCode(order.id, buyer.id)).toBe(deriveHandoverCode(order.id));
        expect(code(await rejects(data.getHandoverCode(order.id, seller.id)))).toBe("NOT_FOUND");
        expect(await ledgerSum("USD")).toBe(0);
      });
      it("refus du paiement : la commande reste ouverte, un nouvel essai est possible", async () => {
        const m = (await data.getUser(S("user-marie")))!;
        const buyer = await signup("0821000006", "Acheteur F");
        const item = await listing(m.id);
        const o = await data.createOrder(buyer.id, { itemIds: [item.id], deliveryMethod: "hand_delivery" });
        await data.startPayment(o.id, buyer.id, { method: "mpesa", msisdn: "0821000100", idempotencyKey: "k1" });
        await env.flush();
        const v = await data.getOrder(o.id, buyer.id);
        expect(v.status).toBe("pending_payment");
        expect(v.payment?.status).toBe("failed");
        expect(v.payment?.failureCode).toBe("INSUFFICIENT_FUNDS");
        await data.startPayment(o.id, buyer.id, { method: "mpesa", msisdn: "0821000101", idempotencyKey: "k2" });
        await env.flush();
        expect((await data.getOrder(o.id, buyer.id)).status).toBe("paid");
      });
      it("même clé d'idempotence = même paiement ; un second paiement en attente est refusé", async () => {
        const m = (await data.getUser(S("user-marie")))!;
        const buyer = await signup("0821000007", "Acheteur G");
        const item = await listing(m.id);
        const o = await data.createOrder(buyer.id, { itemIds: [item.id], deliveryMethod: "hand_delivery" });
        const p1 = await data.startPayment(o.id, buyer.id, { method: "orange_money", msisdn: "0821000007", idempotencyKey: "same" });
        const p2 = await data.startPayment(o.id, buyer.id, { method: "orange_money", msisdn: "0821000007", idempotencyKey: "same" });
        expect(p2.id).toBe(p1.id);
        expect(code(await rejects(data.startPayment(o.id, buyer.id, { method: "orange_money", msisdn: "0821000007", idempotencyKey: "autre" })))).toBe("PAYMENT_IN_PROGRESS");
      });
      it("un webhook rejoué ne change rien (même événement, puis nouvel événement sur le même paiement)", async () => {
        const m = (await data.getUser(S("user-marie")))!;
        const buyer = await signup("0821000010", "Acheteur K");
        const item = await listing(m.id);
        const o = await data.createOrder(buyer.id, { itemIds: [item.id], deliveryMethod: "hand_delivery" });
        await data.startPayment(o.id, buyer.id, { method: "mpesa", msisdn: "0821000010", idempotencyKey: "replay" });
        const [ev] = await env.pendingEvents();
        expect((await data.handleProviderEvent(ev)).duplicate).toBe(false);
        const n = (await env.ledger()).length;
        expect(n).toBeGreaterThan(0);
        expect((await data.handleProviderEvent(ev)).duplicate).toBe(true); // même eventId : table webhook_events
        expect((await data.handleProviderEvent({ ...ev, eventId: "autre-id" })).duplicate).toBe(true); // paiement déjà encaissé
        expect((await env.ledger()).length).toBe(n);
        expect(await account("order_escrow")).toBe(-o.totalMinor); // encaissé une seule fois
      });
      it("paiement tardif après expiration : remboursé automatiquement, l'argent n'est jamais gardé", async () => {
        const m = (await data.getUser(S("user-marie")))!;
        const buyer = await signup("0821000008", "Acheteur H");
        const item = await listing(m.id);
        const o = await data.createOrder(buyer.id, { itemIds: [item.id], deliveryMethod: "hand_delivery" });
        await data.startPayment(o.id, buyer.id, { method: "mpesa", msisdn: "0821000008", idempotencyKey: "late" });
        env.advance(FEES.orderPaymentTtlMs + 1);
        await env.flush();
        const v = await data.getOrder(o.id, buyer.id);
        expect(v.status).toBe("expired");
        expect(v.payment?.status).toBe("refunded");
        expect(await account("order_escrow")).toBe(0);
        expect(await ledgerSum("USD")).toBe(0);
        expect(env.refunds()).toBe(1);
        expect((await data.getItem(item.id))!.status).toBe("active");
      });
      it("annulation après paiement : remboursement intégral et article libéré", async () => {
        const { order, buyer, item } = await paidOrder("Acheteur I", "+243821222222");
        const v = await data.cancelOrder(order.id, buyer.id);
        expect(v.status).toBe("cancelled");
        expect(await account("order_escrow")).toBe(0);
        expect(await account("psp_clearing")).toBe(0);
        expect((await data.getItem(item.id))!.status).toBe("active");
        expect(v.payment?.status).toBe("refunded");
      });
    });

    describe("remise en main propre", () => {
      it("le bon code libère l'argent au vendeur : commande terminée, article vendu, frais pour la plateforme", async () => {
        const { order, seller, buyer, item } = await paidOrder();
        const v = await data.confirmDelivery(order.id, seller.id, deriveHandoverCode(order.id));
        expect(v.status).toBe("completed");
        expect((await data.getItem(item.id))!.status).toBe("sold");
        expect(await account("order_escrow")).toBe(0);
        expect(await account("seller_available")).toBe(-order.itemsMinor);
        expect(await account("platform_revenue")).toBe(-order.protectionFeeMinor);
        expect(await ledgerSum("USD")).toBe(0);
        expect((await data.getWallet(seller.id)).balances.find((b) => b.currency === "USD")?.availableMinor).toBeGreaterThanOrEqual(order.itemsMinor);
        expect(code(await rejects(data.cancelOrder(order.id, buyer.id)))).toBe("INVALID_STATE");
      });
      it("5 mauvais codes verrouillent la remise, même avec le bon code ensuite", async () => {
        const { order, seller } = await paidOrder();
        for (let i = 4; i >= 1; i--) {
          const e = await rejects(data.confirmDelivery(order.id, seller.id, "000000"));
          expect(e.code).toBe("CODE_WRONG");
          expect(e.message).toContain(String(i));
        }
        expect(code(await rejects(data.confirmDelivery(order.id, seller.id, "000000")))).toBe("CODE_LOCKED");
        expect(code(await rejects(data.confirmDelivery(order.id, seller.id, deriveHandoverCode(order.id))))).toBe("CODE_LOCKED");
        env.advance(FEES.handoverLockMs + 1);
        expect((await data.confirmDelivery(order.id, seller.id, deriveHandoverCode(order.id))).status).toBe("completed");
      });
      it("seul le vendeur saisit le code ; l'acheteur ne peut pas se l'auto-valider", async () => {
        const { order, buyer } = await paidOrder();
        expect(code(await rejects(data.confirmDelivery(order.id, buyer.id, deriveHandoverCode(order.id))))).toBe("NOT_FOUND");
      });
    });

    describe("portefeuille et retraits", () => {
      async function richSeller() {
        const { order, seller } = await paidOrder("Acheteur J", "+243821333333", 20_000);
        await data.confirmDelivery(order.id, seller.id, deriveHandoverCode(order.id));
        return seller;
      }
      it("refuse un retrait supérieur au solde ou sous le minimum", async () => {
        const s = await richSeller();
        const base = { currency: "USD" as const, method: "mpesa" as const, msisdn: "0810000001" };
        expect(code(await rejects(data.requestPayout(s.id, { ...base, amountMinor: 999_999, idempotencyKey: "a" })))).toBe("INSUFFICIENT_FUNDS");
        expect(code(await rejects(data.requestPayout(s.id, { ...base, amountMinor: 100, idempotencyKey: "b" })))).toBe("BELOW_MINIMUM");
      });
      it("retrait réussi : solde réduit du montant et des frais, grand livre équilibré", async () => {
        const s = await richSeller();
        const before = (await data.getWallet(s.id)).balances.find((b) => b.currency === "USD")!.availableMinor;
        const p = await data.requestPayout(s.id, { currency: "USD", method: "mpesa", msisdn: "0810000001", amountMinor: 10_000, idempotencyKey: "ok" });
        expect(p.feeMinor).toBe(100);
        expect((await data.getWallet(s.id)).balances.find((b) => b.currency === "USD")!.availableMinor).toBe(before - 10_100);
        await env.flush();
        expect((await data.listPayouts(s.id))[0].status).toBe("paid");
        expect(await ledgerSum("USD")).toBe(0);
      });
      it("même clé d'idempotence : un seul retrait", async () => {
        const s = await richSeller();
        const input = { currency: "USD" as const, method: "mpesa" as const, msisdn: "0810000001", amountMinor: 5_000, idempotencyKey: "once" };
        const a = await data.requestPayout(s.id, input);
        const b = await data.requestPayout(s.id, input);
        expect(b.id).toBe(a.id);
        expect(await data.listPayouts(s.id)).toHaveLength(1);
      });
      it("retrait refusé par l'opérateur : le vendeur est recrédité intégralement", async () => {
        const s = await richSeller();
        const before = (await data.getWallet(s.id)).balances.find((b) => b.currency === "USD")!.availableMinor;
        await data.requestPayout(s.id, { currency: "USD", method: "mpesa", msisdn: "0810000100", amountMinor: 10_000, idempotencyKey: "bad" });
        await env.flush();
        const w = await data.getWallet(s.id);
        expect((await data.listPayouts(s.id))[0].status).toBe("failed");
        expect(w.balances.find((b) => b.currency === "USD")!.availableMinor).toBe(before);
        expect(await ledgerSum("USD")).toBe(0);
      });
    });

    describe("sessions", () => {
      it("un jeton ouvre une session, se révoque, et ne vaut rien une fois expiré", async () => {
        const u = await signup("0831111111", "Session Un");
        const { token, expiresAt } = await data.createSession(u.id);
        expect(token.length).toBeGreaterThan(30);
        expect(expiresAt).toBeGreaterThan(env.now());
        expect((await data.getSessionUser(token))?.id).toBe(u.id);
        expect(await data.getSessionUser("jeton-inconnu")).toBeNull();
        await data.deleteSession(token);
        expect(await data.getSessionUser(token)).toBeNull();
        const again = await data.createSession(u.id);
        env.advance(31 * 86_400_000);
        expect(await data.getSessionUser(again.token)).toBeNull();
      });
      it("« se déconnecter partout » révoque toutes les sessions du membre, et seulement les siennes", async () => {
        const a = await signup("0831111112", "Membre A");
        const b = await signup("0831111113", "Membre B");
        const a1 = await data.createSession(a.id);
        const a2 = await data.createSession(a.id);
        const b1 = await data.createSession(b.id);
        await data.deleteAllSessions(a.id);
        expect(await data.getSessionUser(a1.token)).toBeNull();
        expect(await data.getSessionUser(a2.token)).toBeNull();
        expect((await data.getSessionUser(b1.token))?.id).toBe(b.id);
      });
    });

    describe("limitation de débit", () => {
      it("laisse passer N appels par fenêtre, bloque ensuite avec un délai d'attente, puis repart", async () => {
        const k = "test:cle";
        for (let i = 0; i < 3; i++) expect((await data.rateLimit(k, 3, 60)).allowed).toBe(true);
        const blocked = await data.rateLimit(k, 3, 60);
        expect(blocked.allowed).toBe(false);
        expect(blocked.retryAfterSec).toBeGreaterThan(0);
        expect(blocked.retryAfterSec).toBeLessThanOrEqual(60);
        expect((await data.rateLimit("autre-cle", 3, 60)).allowed).toBe(true); // les clés sont indépendantes
        env.advance(61_000);
        expect((await data.rateLimit(k, 3, 60)).allowed).toBe(true);
      });
    });

    describe("suppression de compte", () => {
      it("refuse tant qu'une commande est ouverte", async () => {
        const m = (await data.getUser(S("user-marie")))!;
        const buyer = await signup("0831111114", "Acheteur Z");
        const item = await listing(m.id);
        await data.createOrder(buyer.id, { itemIds: [item.id], deliveryMethod: "hand_delivery" });
        expect(code(await rejects(data.deleteAccount(buyer.id)))).toBe("ACCOUNT_HAS_OPEN_ORDERS");
        expect(code(await rejects(data.deleteAccount(m.id)))).toBe("ACCOUNT_HAS_OPEN_ORDERS");
      });
      it("refuse tant qu'il reste de l'argent dans le portefeuille", async () => {
        const { seller, order } = await paidOrder("Acheteur Y", "+243821444444");
        await data.confirmDelivery(order.id, seller.id, deriveHandoverCode(order.id));
        expect(code(await rejects(data.deleteAccount(seller.id)))).toBe("ACCOUNT_HAS_FUNDS");
      });
      it("anonymise le profil, retire les annonces, révoque les sessions, et libère le numéro", async () => {
        const u = await signup("0831111115", "A Supprimer");
        const item = await listing(u.id);
        const { token } = await data.createSession(u.id);
        await data.deleteAccount(u.id);
        expect(await data.getUser(u.id)).toBeNull();
        expect(await data.getPublicProfile(u.id)).toBeNull();
        expect(await data.getSessionUser(token)).toBeNull();
        expect(await data.getItem(item.id, "autre-membre")).toBeNull();
        expect(await data.listItems({ q: "Robe test" }).then((l) => l.some((c) => c.id === item.id))).toBe(false);
        await data.requestOtp("0831111115");
        const again = await data.verifyOtp("0831111115", "123456", "Nouveau Compte");
        expect(again.isNew).toBe(true);
        expect(again.user.id).not.toBe(u.id);
      });
    });

    describe("entretien", () => {
      it("purge les codes, sessions et compteurs expirés", async () => {
        await data.requestOtp("0831111116");
        const u = await signup("0831111117", "Purge");
        await data.createSession(u.id);
        await data.rateLimit("purge:cle", 1, 10);
        env.advance(40 * 86_400_000);
        const r = await data.purgeExpired();
        expect(r.otp).toBeGreaterThanOrEqual(1);
        expect(r.sessions).toBeGreaterThanOrEqual(1);
        expect(r.rateLimits).toBeGreaterThanOrEqual(1);
      });
      it("le rapprochement ne casse rien quand il n'y a rien à rattraper", async () => {
        expect(await data.reconcilePendingPayments()).toBe(0);
      });
    });

    describe("identifiants invalides : jamais d'erreur serveur", () => {
      it("un texte qui n'est pas un identifiant est « introuvable », pas une panne", async () => {
        const u = await signup("0831111118", "Id Invalide");
        expect(await data.getItem("inexistant", u.id)).toBeNull();
        expect(await data.getUser("inexistant")).toBeNull();
        expect(await data.getPublicProfile("inexistant")).toBeNull();
        expect(code(await rejects(data.getOrder("inexistant", u.id)))).toBe("NOT_FOUND");
        expect(code(await rejects(data.createOrder(u.id, { itemIds: ["inexistant"], deliveryMethod: "hand_delivery" })))).toBe("NOT_FOUND");
        expect(await data.listItems({ categoryId: "inexistant" })).toEqual([]);
        expect(await data.listItems({ sellerId: "inexistant" })).toEqual([]);
        expect(await data.listAreas("inexistant")).toEqual([]);
      });
    });

    describe("autorisations : un second utilisateur n'obtient rien", () => {
      it("ne peut ni voir, ni payer, ni annuler, ni valider, ni lire le code d'une commande qui n'est pas la sienne", async () => {
        const { order, buyer, seller } = await paidOrder("Acheteur X", "+243821555555");
        const tiers = await signup("0831111119", "Tiers");
        expect(code(await rejects(data.getOrder(order.id, tiers.id)))).toBe("NOT_FOUND");
        expect(code(await rejects(data.getPayment(order.id, tiers.id)))).toBe("NOT_FOUND");
        expect(code(await rejects(data.getHandoverCode(order.id, tiers.id)))).toBe("NOT_FOUND");
        expect(code(await rejects(data.cancelOrder(order.id, tiers.id)))).toBe("NOT_FOUND");
        expect(code(await rejects(data.confirmDelivery(order.id, tiers.id, deriveHandoverCode(order.id))))).toBe("NOT_FOUND");
        expect(code(await rejects(data.acceptOrder(order.id, tiers.id)))).toBe("NOT_FOUND");
        expect(code(await rejects(data.startPayment(order.id, tiers.id, { method: "mpesa", msisdn: "0831111119", idempotencyKey: "intrus-1" })))).toBe("NOT_FOUND");
        expect((await data.listMyOrders(tiers.id)).length).toBe(0);
        expect((await data.getWallet(tiers.id)).balances).toEqual([]);
        expect(await data.listPayouts(tiers.id)).toEqual([]);
        // et la commande est intacte
        expect((await data.getOrder(order.id, buyer.id)).status).toBe("paid");
        expect((await data.getOrder(order.id, seller.id)).status).toBe("paid");
      });
      it("une clé d'idempotence ne peut pas être réutilisée par un autre membre", async () => {
        const { seller, order } = await paidOrder("Acheteur W", "+243821666666", 20_000);
        await data.confirmDelivery(order.id, seller.id, deriveHandoverCode(order.id));
        const input = { currency: "USD" as const, method: "mpesa" as const, msisdn: "0810000001", amountMinor: 5_000, idempotencyKey: "cle-partagee" };
        await data.requestPayout(seller.id, input);
        const autre = await signup("0831111120", "Autre Vendeur");
        expect(code(await rejects(data.requestPayout(autre.id, input)))).toBe("IDEMPOTENCY_CONFLICT");
      });
    });

    describe("messagerie", () => {
      async function duo() {
        const seller = await signup("0811000091", "Vendeuse Chat");
        const buyer = await signup("0821000092", "Acheteur Chat");
        const item = await listing(seller.id);
        return { seller, buyer, item };
      }
      it("ouvrir une conversation est idempotent, écrire est réservé aux deux parties", async () => {
        const { seller, buyer, item } = await duo();
        const a = await data.startConversation(buyer.id, item.id);
        const b = await data.startConversation(buyer.id, item.id);
        expect(a.created).toBe(true);
        expect(b).toEqual({ id: a.id, created: false });
        await data.sendMessage(a.id, buyer.id, "Bonjour, il est encore disponible ?");
        const reply = await data.sendMessage(a.id, seller.id, "Oui, à Gombe.");
        expect(reply.mine).toBe(true);
        const asBuyer = await data.getConversation(a.id, buyer.id);
        expect(asBuyer.messages.map((m) => [m.mine, m.body])).toEqual([[true, "Bonjour, il est encore disponible ?"], [false, "Oui, à Gombe."]]);
        expect(asBuyer.counterpart.id).toBe(seller.id);
      });
      it("on ne s'écrit pas à soi-même ; une annonce inconnue ou en brouillon est introuvable", async () => {
        const { seller, buyer, item } = await duo();
        expect(code(await rejects(data.startConversation(seller.id, item.id)))).toBe("OWN_ITEM");
        expect(code(await rejects(data.startConversation(buyer.id, S("item-inconnu"))))).toBe("NOT_FOUND");
        const draft = await data.createDraft(seller.id, { title: "Brouillon", description: "", categoryId: S("cat-robes"), condition: "good", priceMinor: 1000, currency: "USD", areaId: S("area-com-gombe"), photos: [PHOTO] });
        expect(code(await rejects(data.startConversation(buyer.id, draft.id)))).toBe("NOT_FOUND");
      });
      it("un tiers ne lit ni n'écrit dans la conversation (404 partout)", async () => {
        const { buyer, item } = await duo();
        const tiers = await signup("0831000093", "Tiers Curieux");
        const c = await data.startConversation(buyer.id, item.id);
        await data.sendMessage(c.id, buyer.id, "Message privé");
        expect(code(await rejects(data.getConversation(c.id, tiers.id)))).toBe("NOT_FOUND");
        expect(code(await rejects(data.sendMessage(c.id, tiers.id, "Intrus")))).toBe("NOT_FOUND");
        expect(await data.listConversations(tiers.id)).toEqual([]);
        expect((await data.getConversation(c.id, buyer.id)).messages.length).toBe(1);
      });
      it("messages vides ou trop longs refusés ; numéro et lien signalés mais remis", async () => {
        const { buyer, item } = await duo();
        const c = await data.startConversation(buyer.id, item.id);
        expect(code(await rejects(data.sendMessage(c.id, buyer.id, "   ")))).toBe("VALIDATION");
        expect(code(await rejects(data.sendMessage(c.id, buyer.id, "x".repeat(2001))))).toBe("VALIDATION");
        const ok = await data.sendMessage(c.id, buyer.id, "x".repeat(2000));
        expect(ok.flagged).toBe(false);
        const num = await data.sendMessage(c.id, buyer.id, "Appelle-moi au 082 123 45 67");
        const lien = await data.sendMessage(c.id, buyer.id, "Paie ici https://exemple.com/pay");
        expect(num.flagged).toBe(true);
        expect(lien.flagged).toBe(true);
        expect((await data.getConversation(c.id, buyer.id)).messages.length).toBe(3);
      });
      it("non lus : comptés pour le destinataire, remis à zéro à la lecture ; liste triée par dernier message", async () => {
        const { seller, buyer, item } = await duo();
        const item2 = await listing(seller.id, { title: "Sac test" });
        const c1 = await data.startConversation(buyer.id, item.id);
        const c2 = await data.startConversation(buyer.id, item2.id);
        await data.sendMessage(c1.id, buyer.id, "Premier");
        env.advance(1000);
        await data.sendMessage(c2.id, buyer.id, "Second");
        env.advance(1000);
        await data.sendMessage(c2.id, buyer.id, "Troisième");
        const inbox = await data.listConversations(seller.id);
        expect(inbox.map((x) => [x.id, x.unread])).toEqual([[c2.id, 2], [c1.id, 1]]);
        expect(inbox[0].lastMessage).toBe("Troisième");
        await data.getConversation(c2.id, seller.id);
        expect((await data.listConversations(seller.id)).map((x) => x.unread)).toEqual([0, 1]);
        expect((await data.listConversations(buyer.id)).every((x) => x.unread === 0)).toBe(true);
      });
      it("le compte supprimé de l'interlocuteur : conversation lisible, écriture refusée", async () => {
        const { seller, buyer, item } = await duo();
        const c = await data.startConversation(buyer.id, item.id);
        await data.sendMessage(c.id, buyer.id, "Avant la suppression");
        await data.deleteAccount(buyer.id);
        const view = await data.getConversation(c.id, seller.id);
        expect(view.counterpart.displayName).toBe("Membre supprimé");
        expect(code(await rejects(data.sendMessage(c.id, seller.id, "Tu es là ?")))).toBe("MEMBER_DELETED");
      });
    });

    describe("litiges et arbitrage", () => {
      const staff = () => S("user-support-1");
      it("ouvrir un litige gèle le séquestre : plus d'annulation ni de remise, ni de retrait", async () => {
        const { seller, buyer, order } = await paidOrder("Acheteur L1", "+243821000101", 10_000);
        const d = await data.openDispute(order.id, buyer.id, { reason: "not_as_described", description: "La robe est beaucoup trop petite." });
        expect(d.status).toBe("open");
        expect(d.viewerRole).toBe("buyer");
        expect((await data.getOrder(order.id, seller.id)).status).toBe("disputed");
        expect((await data.getOrder(order.id, seller.id)).dispute?.id).toBe(d.id);
        expect(code(await rejects(data.cancelOrder(order.id, buyer.id)))).toBe("INVALID_STATE");
        expect(code(await rejects(data.confirmDelivery(order.id, seller.id, deriveHandoverCode(order.id))))).toBe("INVALID_STATE");
        expect(code(await rejects(data.openDispute(order.id, seller.id, { reason: "other", description: "Contestation du vendeur." })))).toBe("DISPUTE_EXISTS");
        expect(await account("order_escrow")).toBe(-Math.round(10_000 + 500) );
        expect(await ledgerSum("USD")).toBe(0);
      });
      it("remboursement par l'assistance : acheteur remboursé en totalité, article remis en vente, grand livre équilibré", async () => {
        const { seller, buyer, item, order } = await paidOrder("Acheteur L2", "+243821000102", 10_000);
        const d = await data.openDispute(order.id, seller.id, { reason: "other", description: "L'acheteur refuse de venir au rendez-vous." });
        await data.addDisputeNote(d.id, buyer.id, "Je n'ai jamais reçu de message du vendeur.");
        const done = await data.resolveDispute(staff(), d.id, "refund_buyer", "Remboursement : pas de remise.");
        expect(done.status).toBe("resolved_refund");
        expect(done.viewerRole).toBe("staff");
        expect(done.notes.map((n) => [n.staff, n.note])).toEqual([[false, "Je n'ai jamais reçu de message du vendeur."], [true, "Remboursement : pas de remise."]]);
        expect((await data.getOrder(order.id, buyer.id)).status).toBe("refunded");
        expect((await data.getItem(item.id))!.status).toBe("active");
        expect(await account("order_escrow")).toBe(0);
        expect(await account("seller_available")).toBe(0);
        expect(await ledgerSum("USD")).toBe(0);
        expect(env.refunds()).toBe(1);
        expect(code(await rejects(data.resolveDispute(staff(), d.id, "release_seller")))).toBe("INVALID_STATE");
        expect(code(await rejects(data.addDisputeNote(d.id, buyer.id, "Trop tard")))).toBe("INVALID_STATE");
      });
      it("paiement du vendeur par l'assistance : argent libéré, commande terminée", async () => {
        const { seller, buyer, item, order } = await paidOrder("Acheteur L3", "+243821000103", 10_000);
        const d = await data.openDispute(order.id, buyer.id, { reason: "not_received", description: "Le vendeur ne s'est pas présenté." });
        await data.resolveDispute(staff(), d.id, "release_seller");
        expect((await data.getOrder(order.id, buyer.id)).status).toBe("completed");
        expect((await data.getItem(item.id))!.status).toBe("sold");
        expect((await data.getWallet(seller.id)).balances.find((b) => b.currency === "USD")?.availableMinor).toBe(10_000);
        expect(await account("order_escrow")).toBe(0);
        expect(await ledgerSum("USD")).toBe(0);
        expect(env.refunds()).toBe(0);
      });
      it("seule l'assistance tranche ; un tiers ne voit rien (404) ; un membre ne peut pas se servir de l'accès assistance", async () => {
        const { buyer, order } = await paidOrder("Acheteur L4", "+243821000104", 10_000);
        const d = await data.openDispute(order.id, buyer.id, { reason: "damaged", description: "Écran fissuré à la remise." });
        const tiers = await signup("0831000105", "Tiers Litige");
        expect(code(await rejects(data.getDisputeById(d.id, tiers.id)))).toBe("NOT_FOUND");
        expect(code(await rejects(data.getOrderDispute(order.id, tiers.id)))).toBe("NOT_FOUND");
        expect(code(await rejects(data.addDisputeNote(d.id, tiers.id, "Intrus")))).toBe("NOT_FOUND");
        expect(code(await rejects(data.resolveDispute(tiers.id, d.id, "refund_buyer")))).toBe("NOT_FOUND");
        expect(code(await rejects(data.resolveDispute(buyer.id, d.id, "refund_buyer")))).toBe("NOT_FOUND");
        expect(code(await rejects(data.listOpenDisputes(buyer.id)))).toBe("NOT_FOUND");
        expect((await data.listOpenDisputes(staff())).map((x) => x.id)).toContain(d.id);
        expect((await data.getOrder(order.id, buyer.id)).status).toBe("disputed");
      });
      it("validations : description trop courte, motif inconnu, commande non payée ou déjà remise", async () => {
        const { buyer, seller, order } = await paidOrder("Acheteur L5", "+243821000106", 10_000);
        expect(code(await rejects(data.openDispute(order.id, buyer.id, { reason: "other", description: "court" })))).toBe("VALIDATION");
        expect(code(await rejects(data.openDispute(order.id, buyer.id, { reason: "inconnu" as never, description: "Une description assez longue." })))).toBe("VALIDATION");
        await data.confirmDelivery(order.id, seller.id, deriveHandoverCode(order.id));
        expect(code(await rejects(data.openDispute(order.id, buyer.id, { reason: "other", description: "Une description assez longue." })))).toBe("INVALID_STATE");
        const item2 = await listing(seller.id);
        const unpaid = await data.createOrder(buyer.id, { itemIds: [item2.id], deliveryMethod: "hand_delivery" });
        expect(code(await rejects(data.openDispute(unpaid.id, buyer.id, { reason: "other", description: "Une description assez longue." })))).toBe("INVALID_STATE");
      });
      it("commande payée jamais remise au-delà du délai : remboursée automatiquement, sauf si un litige est ouvert", async () => {
        const a = await paidOrder("Acheteur A1", "+243821000107", 10_000);
        const b = await paidOrder("Acheteur A2", "+243821000108", 10_000);
        await data.openDispute(b.order.id, b.buyer.id, { reason: "other", description: "Litige ouvert avant le délai." });
        env.advance(FEES.unhandedOrderMs - 60_000);
        expect(await data.expireStalePaidOrders()).toBe(0);
        env.advance(120_000);
        expect(await data.expireStalePaidOrders()).toBe(1);
        expect((await data.getOrder(a.order.id, a.buyer.id)).status).toBe("cancelled");
        expect((await data.getItem(a.item.id))!.status).toBe("active");
        expect((await data.getOrder(b.order.id, b.buyer.id)).status).toBe("disputed");
        expect(await data.expireStalePaidOrders()).toBe(0);
        expect(env.refunds()).toBe(1);
        expect(await ledgerSum("USD")).toBe(0);
      });
    });

    describe("avis", () => {
      it("un avis par membre et par commande terminée ; la note moyenne suit ; refusé avant la fin", async () => {
        const { seller, buyer, order } = await paidOrder("Acheteur R1", "+243821000111", 5_000);
        expect(code(await rejects(data.createReview(order.id, buyer.id, { rating: 5, comment: "" })))).toBe("INVALID_STATE");
        await data.confirmDelivery(order.id, seller.id, deriveHandoverCode(order.id));
        expect((await data.getOrder(order.id, buyer.id)).actions).toContain("review");
        const before = (await data.getUser(seller.id))!;
        const r = await data.createReview(order.id, buyer.id, { rating: 4, comment: "  Vendeuse ponctuelle.  " });
        expect(r.comment).toBe("Vendeuse ponctuelle.");
        const after = (await data.getUser(seller.id))!;
        expect(after.ratingCount).toBe(before.ratingCount + 1);
        const expected = Math.round((Math.round((before.ratingAvg ?? 0) * 100) * before.ratingCount + 400) / (before.ratingCount + 1)) / 100;
        expect(Number(after.ratingAvg)).toBe(expected);
        expect(code(await rejects(data.createReview(order.id, buyer.id, { rating: 5, comment: "" })))).toBe("REVIEW_EXISTS");
        expect((await data.getOrder(order.id, buyer.id)).actions).not.toContain("review");
        const back = await data.createReview(order.id, seller.id, { rating: 5, comment: "" });
        expect(back.rating).toBe(5);
        expect((await data.listReviews(seller.id))[0].comment).toBe("Vendeuse ponctuelle.");
        expect((await data.getMyReview(order.id, buyer.id))?.rating).toBe(4);
      });
      it("note hors bornes, commentaire trop long, tiers : refusés", async () => {
        const { seller, buyer, order } = await paidOrder("Acheteur R2", "+243821000112", 5_000);
        await data.confirmDelivery(order.id, seller.id, deriveHandoverCode(order.id));
        for (const rating of [0, 6, 2.5, -1]) expect(code(await rejects(data.createReview(order.id, buyer.id, { rating, comment: "" }))), `note ${rating}`).toBe("VALIDATION");
        expect(code(await rejects(data.createReview(order.id, buyer.id, { rating: 3, comment: "x".repeat(501) })))).toBe("VALIDATION");
        const tiers = await signup("0831000113", "Tiers Avis");
        expect(code(await rejects(data.createReview(order.id, tiers.id, { rating: 1, comment: "" })))).toBe("NOT_FOUND");
        expect(code(await rejects(data.getMyReview(order.id, tiers.id)))).toBe("NOT_FOUND");
        expect((await data.getUser(seller.id))!.ratingCount).toBe(31); // aucun avis refusé n'a été compté (31 = valeur de démonstration)
      });
    });

    describe("signalement et modération", () => {
      const moderator = () => S("user-support-2");
      it("signaler est idempotent et refuse sa propre annonce, sa propre personne et une cible inconnue", async () => {
        const seller = await signup("0811000121", "Vendeur Signalé");
        const reporter = await signup("0821000122", "Signaleur");
        const item = await listing(seller.id);
        const a = await data.createReport(reporter.id, { targetType: "item", targetId: item.id, reason: "scam", details: "Demande un paiement hors appli." });
        const b = await data.createReport(reporter.id, { targetType: "item", targetId: item.id, reason: "scam", details: "" });
        expect(a.created).toBe(true);
        expect(b).toEqual({ id: a.id, created: false });
        expect(code(await rejects(data.createReport(seller.id, { targetType: "item", targetId: item.id, reason: "other", details: "" })))).toBe("OWN_TARGET");
        expect(code(await rejects(data.createReport(seller.id, { targetType: "user", targetId: seller.id, reason: "other", details: "" })))).toBe("OWN_TARGET");
        expect(code(await rejects(data.createReport(reporter.id, { targetType: "item", targetId: S("item-inconnu"), reason: "other", details: "" })))).toBe("NOT_FOUND");
        expect(code(await rejects(data.createReport(reporter.id, { targetType: "user", targetId: S("membre-inconnu"), reason: "other", details: "" })))).toBe("NOT_FOUND");
      });
      it("la modération masque une annonce ou classe sans suite ; un membre ordinaire n'a pas accès", async () => {
        const seller = await signup("0811000123", "Vendeur Fautif");
        const reporter = await signup("0821000124", "Signaleur Deux");
        const item = await listing(seller.id);
        const r = await data.createReport(reporter.id, { targetType: "item", targetId: item.id, reason: "prohibited", details: "" });
        expect(code(await rejects(data.listReports(reporter.id)))).toBe("NOT_FOUND");
        expect(code(await rejects(data.handleReport(reporter.id, r.id, "hide_item")))).toBe("NOT_FOUND");
        const open = await data.listReports(moderator());
        expect(open.find((x) => x.id === r.id)?.targetLabel).toBe("Robe test");
        const done = await data.handleReport(moderator(), r.id, "hide_item");
        expect(done.status).toBe("actioned");
        expect((await data.getItem(item.id, reporter.id))).toBeNull();
        expect(code(await rejects(data.handleReport(moderator(), r.id, "dismiss")))).toBe("INVALID_STATE");
        const r2 = await data.createReport(reporter.id, { targetType: "user", targetId: seller.id, reason: "harassment", details: "" });
        expect(code(await rejects(data.handleReport(moderator(), r2.id, "hide_item")))).toBe("VALIDATION");
        expect((await data.handleReport(moderator(), r2.id, "dismiss")).status).toBe("dismissed");
        expect((await data.listReports(moderator(), "dismissed")).length).toBe(1);
      });
      it("suspension : sessions coupées, compte marqué suspendu pendant 7 jours puis libéré", async () => {
        const seller = await signup("0811000125", "Vendeur Suspendu");
        const reporter = await signup("0821000126", "Signaleur Trois");
        const sess = await data.createSession(seller.id);
        const r = await data.createReport(reporter.id, { targetType: "user", targetId: seller.id, reason: "scam", details: "" });
        await data.handleReport(moderator(), r.id, "suspend_user");
        expect(await data.getSessionUser(sess.token)).toBeNull();
        const u = (await data.getUser(seller.id))!;
        expect(u.suspendedUntil).toBe(env.now() + 7 * 86_400_000);
        env.advance(7 * 86_400_000 + 1000);
        expect((await data.getUser(seller.id))!.suspendedUntil ?? null).toBeNull();
      });
    });

    describe("filtres de recherche", () => {
      it("marque (sans accent ni casse), taille exacte, état : combinables", async () => {
        const seller = await signup("0811000131", "Vendeur Filtres");
        const a = await listing(seller.id, { title: "Robe filtre A", brand: "Zéphyr", sizeLabel: "M", condition: "new" });
        const b = await listing(seller.id, { title: "Robe filtre B", brand: "Autre", sizeLabel: "L", condition: "good" });
        const ids = async (q: Record<string, unknown>) => (await data.listItems({ q: "filtre", ...q })).map((x) => x.id).sort();
        expect(await ids({ brand: "zephyr" })).toEqual([a.id]);
        expect(await ids({ sizeLabel: "l" })).toEqual([b.id]);
        expect(await ids({ conditions: ["new"] })).toEqual([a.id]);
        expect(await ids({ conditions: ["new", "good"] })).toEqual([a.id, b.id].sort());
        expect(await ids({ brand: "zephyr", sizeLabel: "L" })).toEqual([]);
        expect(await ids({ brand: "100%_" })).toEqual([]);
      });
    });

    // ---- agent C : notifications
    describe("notifications", () => {
      /** SMS de notification seulement : les codes de connexion (inscription des acteurs du test) passent aussi par le fournisseur en PostgreSQL. */
      const notifSms = () => env.sentSms().filter((s) => !/ton code/.test(s.text));
      const kinds = async (id: string) => (await data.listNotifications(id)).items.map((n) => n.kind).sort();
      const marie = () => S("user-marie");
      const moderator = () => S("user-support-2");
      const staff = () => S("user-support-1");
      async function duo(a = "0811000191", b = "0821000192") {
        const seller = await signup(a, "Vendeuse Notif");
        const buyer = await signup(b, "Acheteur Notif");
        const item = await listing(seller.id);
        return { seller, buyer, item };
      }

      it("message : une seule notification non lue par conversation, regroupée, jamais pour l'auteur", async () => {
        const { seller, buyer, item } = await duo();
        const conv = await data.startConversation(buyer.id, item.id);
        expect(await kinds(seller.id)).toEqual([]); // ouvrir une conversation ne prévient personne
        await data.sendMessage(conv.id, buyer.id, "Bonjour, il est disponible ?");
        await data.sendMessage(conv.id, buyer.id, "Je peux passer demain.");
        const l = await data.listNotifications(seller.id);
        expect(l.unreadCount).toBe(1);
        expect(l.items).toHaveLength(1);
        expect(l.items[0].kind).toBe("message_received");
        expect(l.items[0].payload).toMatchObject({ conversationId: conv.id, count: 2, senderName: "Acheteur Notif" });
        expect(await kinds(buyer.id)).toEqual([]); // l'auteur n'est jamais prévenu de son propre message
        await data.sendMessage(conv.id, seller.id, "Oui, à Gombe.");
        expect(await kinds(buyer.id)).toEqual(["message_received"]);
        expect((await data.listNotifications(seller.id)).items).toHaveLength(1);
        // ouvrir la conversation lit sa notification ; le message suivant en crée une nouvelle
        await data.getConversation(conv.id, seller.id);
        expect((await data.listNotifications(seller.id)).unreadCount).toBe(0);
        await data.sendMessage(conv.id, buyer.id, "Parfait, merci.");
        const again = await data.listNotifications(seller.id);
        expect(again.unreadCount).toBe(1);
        expect(again.items).toHaveLength(2);
        expect(again.items[0].read).toBe(false); // non lues d'abord
        expect(again.items[0].payload.count).toBe(1);
      });

      it("commande payée : le vendeur est prévenu une seule fois, même si l'événement du PSP est rejoué ; pas l'acheteur", async () => {
        const seller = (await data.getUser(marie()))!;
        const buyer = await signup("+243821000301", "Acheteur P1");
        const item = await listing(seller.id);
        const order = await data.createOrder(buyer.id, { itemIds: [item.id], deliveryMethod: "hand_delivery" });
        expect(await kinds(seller.id)).toEqual([]); // réservé mais pas encore payé
        await data.startPayment(order.id, buyer.id, { method: "mpesa", msisdn: "0821111111", idempotencyKey: `k-${order.id}` });
        const [ev] = await env.pendingEvents();
        await env.flush();
        expect(await kinds(seller.id)).toEqual(["order_paid"]);
        expect((await data.listNotifications(seller.id)).items[0].payload).toMatchObject({ orderId: order.id, role: "seller", itemTitle: "Robe test" });
        expect(await kinds(buyer.id)).toEqual([]);
        expect((await data.handleProviderEvent(ev)).duplicate).toBe(true);
        expect((await data.handleProviderEvent({ ...ev, eventId: "autre-evt" })).duplicate).toBe(true);
        expect(await kinds(seller.id)).toEqual(["order_paid"]);
      });

      it("remise confirmée : l'acheteur est prévenu (pas le vendeur, auteur) ; avis : la cible seulement", async () => {
        const { seller, buyer, order } = await paidOrder("Acheteur P2", "+243821000302");
        await data.confirmDelivery(order.id, seller.id, deriveHandoverCode(order.id));
        expect(await kinds(buyer.id)).toEqual(["order_completed"]);
        expect((await data.listNotifications(buyer.id)).items[0].payload).toMatchObject({ role: "buyer", orderId: order.id });
        expect(await kinds(seller.id)).toEqual(["order_paid"]);
        await data.createReview(order.id, buyer.id, { rating: 4, comment: "Très bien." });
        expect(await kinds(seller.id)).toEqual(["order_paid", "review_received"]);
        expect((await data.listNotifications(seller.id)).items.find((n) => n.kind === "review_received")!.payload.rating).toBe(4);
        expect(await kinds(buyer.id)).toEqual(["order_completed"]);
      });

      it("annulation : seule l'autre partie est prévenue ; expiration : les deux, une seule fois", async () => {
        const { seller, buyer, item } = await duo("0811000193", "0821000194");
        const o1 = await data.createOrder(buyer.id, { itemIds: [item.id], deliveryMethod: "hand_delivery" });
        await data.cancelOrder(o1.id, buyer.id);
        expect(await kinds(seller.id)).toEqual(["order_cancelled"]);
        expect(await kinds(buyer.id)).toEqual([]);
        const o2 = await data.createOrder(buyer.id, { itemIds: [item.id], deliveryMethod: "hand_delivery" });
        env.advance(FEES.orderPaymentTtlMs + 1);
        expect(await data.expireUnpaidOrders()).toBe(1);
        expect(await data.expireUnpaidOrders()).toBe(0);
        expect(await kinds(seller.id)).toEqual(["order_cancelled", "order_expired"]);
        expect(await kinds(buyer.id)).toEqual(["order_expired"]);
        expect((await data.listNotifications(buyer.id)).items[0].payload).toMatchObject({ orderId: o2.id, role: "buyer" });
      });

      it("commande payée annulée par le vendeur : l'acheteur est prévenu et remboursé ; jamais d'auto-notification", async () => {
        const { seller, buyer, order } = await paidOrder("Acheteur P3", "+243821000303");
        await data.cancelOrder(order.id, seller.id);
        const n = (await data.listNotifications(buyer.id)).items;
        expect(n.map((x) => x.kind)).toEqual(["order_cancelled"]);
        expect(n[0].payload).toMatchObject({ role: "buyer", refunded: true });
        expect((await kinds(seller.id)).includes("order_cancelled")).toBe(false);
      });

      it("commande payée jamais remise, remboursée automatiquement : les deux parties sont prévenues", async () => {
        const { seller, buyer, order } = await paidOrder("Acheteur P4", "+243821000304");
        env.advance(FEES.unhandedOrderMs + 1000);
        expect(await data.expireStalePaidOrders()).toBe(1);
        expect(await data.expireStalePaidOrders()).toBe(0);
        expect((await data.listNotifications(buyer.id)).items.map((n) => [n.kind, n.payload.auto])).toEqual([["order_cancelled", true]]);
        expect((await kinds(seller.id)).filter((k) => k === "order_cancelled")).toHaveLength(1);
        void order;
      });

      it("litige : ouverture (l'autre partie), messages (l'autre partie ; assistance : les deux), résolution (les deux, pas l'assistance)", async () => {
        const { seller, buyer, order } = await paidOrder("Acheteur L9", "+243821000309", 10_000);
        const d = await data.openDispute(order.id, buyer.id, { reason: "not_received", description: "Le vendeur ne s'est pas présenté." });
        expect((await kinds(seller.id)).filter((k) => k === "dispute_opened")).toHaveLength(1);
        expect(await kinds(buyer.id)).toEqual([]);
        await data.addDisputeNote(d.id, seller.id, "J'étais bien au rendez-vous.");
        expect(await kinds(buyer.id)).toEqual(["dispute_message"]);
        expect((await kinds(seller.id)).includes("dispute_message")).toBe(false);
        await data.addDisputeNote(d.id, staff(), "Pouvez-vous envoyer une preuve ?");
        expect((await kinds(buyer.id)).filter((k) => k === "dispute_message")).toHaveLength(2);
        expect((await kinds(seller.id)).filter((k) => k === "dispute_message")).toHaveLength(1);
        expect(await kinds(staff())).toEqual([]);
        await data.resolveDispute(staff(), d.id, "refund_buyer", "Remboursement.");
        for (const id of [buyer.id, seller.id]) {
          const r = (await data.listNotifications(id)).items.filter((n) => n.kind === "dispute_resolved");
          expect(r).toHaveLength(1);
          expect(r[0].payload).toMatchObject({ disputeId: d.id, orderId: order.id, outcome: "refund_buyer" });
        }
        expect(await kinds(staff())).toEqual([]);
      });

      it("signalement traité : le signaleur est remercié sans détail ; suspension : le membre suspendu est prévenu", async () => {
        const reporter = await signup("0821000195", "Signaleur N");
        const target = await signup("0811000196", "Vendeur Signalé");
        const it2 = await listing(target.id);
        const r1 = await data.createReport(reporter.id, { targetType: "user", targetId: target.id, reason: "scam", details: "Détail confidentiel du signalement" });
        expect(await kinds(reporter.id)).toEqual([]);
        await data.handleReport(moderator(), r1.id, "suspend_user");
        const mine = (await data.listNotifications(reporter.id)).items;
        expect(mine.map((n) => n.kind)).toEqual(["report_handled"]);
        expect(mine[0].payload).toEqual({}); // aucun détail sur la décision
        const sus = (await data.listNotifications(target.id)).items;
        expect(sus.map((n) => n.kind)).toEqual(["suspension"]);
        expect(sus[0].payload.until).toBe(env.now() + 7 * 86_400_000);
        const r2 = await data.createReport(reporter.id, { targetType: "item", targetId: it2.id, reason: "other", details: "" });
        await data.handleReport(moderator(), r2.id, "dismiss");
        expect(await kinds(reporter.id)).toEqual(["report_handled", "report_handled"]);
        expect(await kinds(moderator())).toEqual([]);
      });

      it("lecture : marquer lue est idempotent, tout marquer comme lu, non lues d'abord", async () => {
        const seller = await signup("0811000197", "Vendeuse Lecture");
        const buyer = await signup("0821000198", "Acheteur Lecture");
        const a = await listing(seller.id, { title: "Robe A" });
        const b = await listing(seller.id, { title: "Robe B" });
        const ca = await data.startConversation(buyer.id, a.id);
        const cb = await data.startConversation(buyer.id, b.id);
        await data.sendMessage(ca.id, buyer.id, "Question A");
        env.advance(1000);
        await data.sendMessage(cb.id, buyer.id, "Question B");
        const l = await data.listNotifications(seller.id);
        expect(l.items.map((n) => n.payload.itemTitle)).toEqual(["Robe B", "Robe A"]); // plus récente d'abord
        await data.markNotificationRead(seller.id, l.items[0].id);
        await data.markNotificationRead(seller.id, l.items[0].id); // idempotent
        expect(await data.countUnreadNotifications(seller.id)).toBe(1);
        const after = await data.listNotifications(seller.id);
        expect(after.items.map((n) => n.read)).toEqual([false, true]); // non lues d'abord
        expect(after.unreadCount).toBe(1);
        expect(await data.markAllNotificationsRead(seller.id)).toBe(1);
        expect(await data.markAllNotificationsRead(seller.id)).toBe(0);
        expect(await data.countUnreadNotifications(seller.id)).toBe(0);
      });

      it("isolation : un membre ne voit ni ne modifie les notifications d'un autre (404, liste vide)", async () => {
        const { seller, buyer, item } = await duo("0811000199", "0821000200");
        const conv = await data.startConversation(buyer.id, item.id);
        await data.sendMessage(conv.id, buyer.id, "Bonjour");
        const tiers = await signup("0831000201", "Tiers Notif");
        const id = (await data.listNotifications(seller.id)).items[0].id;
        expect(code(await rejects(data.markNotificationRead(tiers.id, id)))).toBe("NOT_FOUND");
        expect(code(await rejects(data.markNotificationRead(buyer.id, id)))).toBe("NOT_FOUND");
        expect(code(await rejects(data.markNotificationRead(seller.id, "00000000-0000-4000-8000-000000000000")))).toBe("NOT_FOUND");
        expect(code(await rejects(data.markNotificationRead(seller.id, "pas-un-identifiant")))).toBe("NOT_FOUND");
        expect((await data.listNotifications(tiers.id))).toEqual({ items: [], unreadCount: 0 });
        expect(await data.markAllNotificationsRead(tiers.id)).toBe(0);
        expect((await data.listNotifications(seller.id)).unreadCount).toBe(1); // intacte
      });

      it("SMS : commande payée (vendeur) et litige ouvert ou résolu, texte court sans donnée sensible ; rien pour messages, avis, annulation", async () => {
        const seller = (await data.getUser(marie()))!;
        const { buyer, order } = await paidOrder("Acheteur S1", "+243821000311", 12_345);
        await env.settleSms();
        expect(notifSms().map((s) => s.to)).toEqual([seller.phone]);
        const code6 = deriveHandoverCode(order.id);
        const d = await data.openDispute(order.id, buyer.id, { reason: "damaged", description: "Écran fissuré à la remise." });
        await env.settleSms();
        expect(notifSms().map((s) => s.to)).toEqual([seller.phone, seller.phone]);
        await data.resolveDispute(staff(), d.id, "release_seller", "Paiement du vendeur.");
        await env.settleSms();
        expect(notifSms().map((s) => s.to).sort()).toEqual([seller.phone, seller.phone, seller.phone, (await data.getUser(buyer.id))!.phone].sort());
        for (const s of notifSms()) {
          expect(s.text.length).toBeLessThanOrEqual(160);
          expect(s.text).not.toContain(code6);
          expect(s.text).not.toMatch(/\d/); // ni montant, ni code, ni numéro
          expect(s.text).not.toMatch(/Robe test|Acheteur S1|Marie/);
        }
        // pas de SMS pour un message, un avis ni une annulation
        const before = notifSms().length;
        const conv = await data.startConversation(buyer.id, (await listing(seller.id)).id);
        await data.sendMessage(conv.id, buyer.id, "Bonjour");
        await data.createReview(order.id, buyer.id, { rating: 5, comment: "" });
        const o2 = await data.createOrder(buyer.id, { itemIds: [(await listing(seller.id)).id], deliveryMethod: "hand_delivery" });
        await data.cancelOrder(o2.id, buyer.id);
        await env.settleSms();
        expect(notifSms()).toHaveLength(before);
      });

      it("préférences SMS : par catégorie ; désactivés, plus de SMS mais la notification interne reste ; les valeurs invalides sont ignorées", async () => {
        const seller = (await data.getUser(marie()))!;
        expect(await data.getNotificationPreferences(seller.id)).toEqual({ orders: true, disputes: true });
        expect(await data.updateNotificationPreferences(seller.id, { orders: false })).toEqual({ orders: false, disputes: true });
        expect(await data.getNotificationPreferences(seller.id)).toEqual({ orders: false, disputes: true });
        const { buyer, order } = await paidOrder("Acheteur S2", "+243821000312");
        await env.settleSms();
        expect(notifSms()).toHaveLength(0);
        expect(await kinds(seller.id)).toEqual(["order_paid"]);
        // les litiges restent activés
        await data.openDispute(order.id, buyer.id, { reason: "other", description: "Un autre problème à signaler." });
        await env.settleSms();
        expect(notifSms()).toHaveLength(1);
        // couper les litiges aussi, puis réactiver les commandes
        expect(await data.updateNotificationPreferences(seller.id, { disputes: false })).toEqual({ orders: false, disputes: false });
        expect(await data.updateNotificationPreferences(seller.id, { orders: true })).toEqual({ orders: true, disputes: false });
        await paidOrder("Acheteur S3", "+243821000313");
        await env.settleSms();
        expect(notifSms()).toHaveLength(2);
        // les préférences d'un membre n'affectent pas celles d'un autre ; compte inconnu : 404
        const autre = await signup("0831000202", "Autre Pref");
        expect(await data.getNotificationPreferences(autre.id)).toEqual({ orders: true, disputes: true });
        expect(code(await rejects(data.getNotificationPreferences(S("user-inconnu"))))).toBe("NOT_FOUND");
      });

      it("SMS : plafond quotidien par numéro (les notifications internes continuent), puis reprise le lendemain", async () => {
        const seller = (await data.getUser(marie()))!;
        for (let i = 0; i < 6; i++) await paidOrder(`Acheteur Q${i}`, `+24382100033${i}`);
        await env.settleSms();
        expect(notifSms()).toHaveLength(5);
        expect((await kinds(seller.id)).filter((k) => k === "order_paid")).toHaveLength(6);
        env.advance(86_400_000 + 1000);
        await paidOrder("Acheteur Q9", "+243821000339");
        await env.settleSms();
        expect(notifSms()).toHaveLength(6);
      });

      it("un échec d'envoi SMS ne casse jamais l'événement métier", async () => {
        const seller = (await data.getUser(marie()))!;
        // On fait échouer le fournisseur SMS le temps de l'événement.
        const provider = (data as unknown as { __sms: { send(to: string, text: string): Promise<void> } }).__sms;
        const original = provider.send.bind(provider);
        provider.send = async (to, text) => { if (/ton code/.test(text)) return original(to, text); throw new Error("fournisseur indisponible"); }; // les codes de connexion passent encore (inscriptions du test)
        try {
          const { order } = await paidOrder("Acheteur S4", "+243821000314");
          await env.settleSms();
          expect((await data.getOrder(order.id, seller.id)).status).toBe("paid");
          expect(await kinds(seller.id)).toEqual(["order_paid"]);
        } finally {
          provider.send = original;
        }
      });

      it("membre supprimé : ses notifications disparaissent et il n'en reçoit plus", async () => {
        const { seller, buyer, order } = await paidOrder("Acheteur D1", "+243821000321");
        await data.confirmDelivery(order.id, seller.id, deriveHandoverCode(order.id));
        expect(await kinds(buyer.id)).toEqual(["order_completed"]);
        await data.deleteAccount(buyer.id);
        expect(await data.listNotifications(buyer.id)).toEqual({ items: [], unreadCount: 0 });
        await data.createReview(order.id, seller.id, { rating: 5, comment: "Acheteur ponctuel." }); // la cible est supprimée : aucune erreur
        expect(await data.listNotifications(buyer.id)).toEqual({ items: [], unreadCount: 0 });
        await env.settleSms();
        expect(notifSms().filter((s) => s.to === "+243821000321")).toEqual([]);
      });

      it("rétention : seules les notifications LUES depuis plus de 90 jours sont supprimées", async () => {
        const seller = await signup("0811000203", "Vendeuse Purge");
        const buyer = await signup("0821000204", "Acheteur Purge");
        const a = await listing(seller.id, { title: "Robe PA" });
        const b = await listing(seller.id, { title: "Robe PB" });
        const ca = await data.startConversation(buyer.id, a.id);
        const cb = await data.startConversation(buyer.id, b.id);
        await data.sendMessage(ca.id, buyer.id, "A");
        await data.sendMessage(cb.id, buyer.id, "B");
        await data.getConversation(ca.id, seller.id); // A lue maintenant, B reste non lue
        env.advance(89 * 86_400_000);
        expect(await data.purgeOldNotifications()).toBe(0);
        env.advance(2 * 86_400_000);
        expect(await data.purgeOldNotifications()).toBe(1);
        const left = await data.listNotifications(seller.id);
        expect(left.items.map((n) => n.payload.itemTitle)).toEqual(["Robe PB"]); // la non lue est conservée, quel que soit son âge
        expect(await data.purgeOldNotifications()).toBe(0);
      });
    });
    // ---- fin agent C : notifications
  });
}

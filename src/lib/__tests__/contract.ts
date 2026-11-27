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
      it("annulation du VENDEUR après paiement : remboursement intégral et article libéré (l'acheteur, lui, ne peut plus annuler seul)", async () => {
        const { order, buyer, seller, item } = await paidOrder("Acheteur I", "+243821222222");
        const refused = await rejects(data.cancelOrder(order.id, buyer.id));
        expect(refused.code).toBe("CANCEL_REQUEST_REQUIRED");
        expect(refused.status).toBe(409);
        expect((await data.getOrder(order.id, buyer.id)).status).toBe("paid");
        expect(await account("order_escrow")).toBe(-order.totalMinor);
        const v = await data.cancelOrder(order.id, seller.id);
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

    // ---- agent A : annulation encadrée
    describe("annulation encadrée après paiement", () => {
      it("avant paiement : annulation libre pour l'acheteur comme pour le vendeur, sans demande", async () => {
        const seller = (await data.getUser(S("user-marie")))!;
        const buyer = await signup("+243821700001", "Acheteur C0");
        const a = await data.createOrder(buyer.id, { itemIds: [(await listing(seller.id)).id], deliveryMethod: "hand_delivery" });
        expect((await data.getOrder(a.id, buyer.id)).actions).not.toContain("request_cancel");
        expect((await data.cancelOrder(a.id, buyer.id)).status).toBe("cancelled");
        const b = await data.createOrder(buyer.id, { itemIds: [(await listing(seller.id)).id], deliveryMethod: "hand_delivery" });
        expect((await data.cancelOrder(b.id, seller.id)).status).toBe("cancelled");
      });
      it("l'acheteur demande, le vendeur voit la demande et les bonnes actions apparaissent des deux côtés", async () => {
        const { order, buyer, seller } = await paidOrder("Acheteur C1", "+243821700101");
        const before = await data.getOrder(order.id, buyer.id);
        expect(before.cancelRequest).toBeNull();
        expect(before.actions).toContain("request_cancel");
        expect(before.actions).not.toContain("cancel");
        const v = await data.requestCancellation(order.id, buyer.id);
        expect(v.cancelRequest?.status).toBe("pending");
        expect(v.cancelRequest?.requestedAt).toBe(env.now());
        expect(v.cancelRequest?.expiresAt).toBe(env.now() + FEES.cancelRequestTtlMs);
        expect(v.actions).toContain("withdraw_cancel");
        expect(v.actions).not.toContain("request_cancel");
        expect(v.status).toBe("paid");
        const sv = await data.getOrder(order.id, seller.id);
        expect(sv.cancelRequest?.status).toBe("pending");
        expect(sv.actions).toEqual(expect.arrayContaining(["accept_cancel", "decline_cancel", "cancel", "confirm_delivery"]));
        expect(await account("order_escrow")).toBe(-order.totalMinor); // rien ne bouge tant que le vendeur n'a pas accepté
      });
      it("une seconde demande identique (double clic) est refusée sans doublon", async () => {
        const { order, buyer } = await paidOrder("Acheteur C2", "+243821700102");
        await data.requestCancellation(order.id, buyer.id);
        expect(code(await rejects(data.requestCancellation(order.id, buyer.id)))).toBe("CANCEL_REQUEST_EXISTS");
        expect((await data.getOrder(order.id, buyer.id)).cancelRequest?.status).toBe("pending");
      });
      it("acceptation : remboursement intégral, commande annulée, article remis en vente, grand livre équilibré", async () => {
        const { order, buyer, seller, item } = await paidOrder("Acheteur C3", "+243821700103", 10_000);
        await data.requestCancellation(order.id, buyer.id);
        const v = await data.acceptCancellation(order.id, seller.id);
        expect(v.status).toBe("cancelled");
        expect(v.cancelRequest?.status).toBe("accepted");
        expect(v.payment?.status).toBe("refunded");
        expect(await account("order_escrow")).toBe(0);
        expect(await account("psp_clearing")).toBe(0);
        expect(await account("seller_available")).toBe(0);
        expect(await account("platform_revenue")).toBe(0);
        expect(await ledgerSum("USD")).toBe(0);
        expect(env.refunds()).toBe(1);
        expect((await data.getItem(item.id))!.status).toBe("active");
        const bv = await data.getOrder(order.id, buyer.id);
        expect(bv.status).toBe("cancelled");
        expect(bv.cancelRequest?.status).toBe("accepted");
        expect(bv.actions).toEqual([]);
        // plus rien à faire : ni seconde acceptation, ni nouvelle demande
        expect(code(await rejects(data.acceptCancellation(order.id, seller.id)))).toBe("INVALID_STATE");
        expect(code(await rejects(data.requestCancellation(order.id, buyer.id)))).toBe("INVALID_STATE");
        expect(env.refunds()).toBe(1);
      });
      it("refus : la commande reste payée, pas de nouvelle demande, l'acheteur peut ouvrir un litige que l'assistance tranche", async () => {
        const { order, buyer, seller } = await paidOrder("Acheteur C4", "+243821700104", 10_000);
        await data.requestCancellation(order.id, buyer.id);
        const v = await data.declineCancellation(order.id, seller.id);
        expect(v.status).toBe("paid");
        expect(v.cancelRequest?.status).toBe("declined");
        expect(v.actions).not.toContain("accept_cancel");
        const bv = await data.getOrder(order.id, buyer.id);
        expect(bv.actions).not.toContain("request_cancel");
        expect(bv.actions).not.toContain("withdraw_cancel");
        expect(bv.actions).toContain("issue");
        expect(code(await rejects(data.requestCancellation(order.id, buyer.id)))).toBe("CANCEL_REQUEST_REFUSED");
        expect(code(await rejects(data.cancelOrder(order.id, buyer.id)))).toBe("CANCEL_REQUEST_REQUIRED");
        expect(await account("order_escrow")).toBe(-order.totalMinor);
        const d = await data.openDispute(order.id, buyer.id, { reason: "other", description: "Le vendeur refuse d'annuler la vente." });
        expect(d.status).toBe("open");
        await data.resolveDispute(S("user-support-1"), d.id, "refund_buyer");
        expect((await data.getOrder(order.id, buyer.id)).status).toBe("refunded");
        expect(await account("order_escrow")).toBe(0);
        expect(await ledgerSum("USD")).toBe(0);
      });
      it("retrait : l'acheteur retire sa demande, le vendeur ne peut plus l'accepter, l'acheteur peut en refaire une", async () => {
        const { order, buyer, seller } = await paidOrder("Acheteur C5", "+243821700105");
        await data.requestCancellation(order.id, buyer.id);
        const v = await data.withdrawCancellation(order.id, buyer.id);
        expect(v.cancelRequest).toBeNull();
        expect(v.actions).toContain("request_cancel");
        expect((await data.getOrder(order.id, seller.id)).cancelRequest).toBeNull();
        expect(code(await rejects(data.acceptCancellation(order.id, seller.id)))).toBe("CANCEL_REQUEST_NONE");
        expect(code(await rejects(data.declineCancellation(order.id, seller.id)))).toBe("CANCEL_REQUEST_NONE");
        expect(code(await rejects(data.withdrawCancellation(order.id, buyer.id)))).toBe("CANCEL_REQUEST_NONE");
        expect((await data.requestCancellation(order.id, buyer.id)).cancelRequest?.status).toBe("pending");
      });
      it("expiration : au-delà du délai (3 jours par défaut), la demande vaut refus, sans mouvement d'argent, et ne peut plus être acceptée", async () => {
        expect(FEES.cancelRequestTtlMs).toBe(3 * 86_400_000);
        const { order, buyer, seller } = await paidOrder("Acheteur C6", "+243821700106", 10_000);
        await data.requestCancellation(order.id, buyer.id);
        env.advance(FEES.cancelRequestTtlMs - 60_000);
        expect((await data.getOrder(order.id, seller.id)).cancelRequest?.status).toBe("pending");
        env.advance(120_000);
        const sv = await data.getOrder(order.id, seller.id);
        expect(sv.cancelRequest?.status).toBe("expired");
        expect(sv.actions).not.toContain("accept_cancel");
        expect(sv.status).toBe("paid");
        const bv = await data.getOrder(order.id, buyer.id);
        expect(bv.cancelRequest?.status).toBe("expired");
        expect(bv.actions).not.toContain("request_cancel");
        expect(bv.actions).not.toContain("withdraw_cancel");
        expect(code(await rejects(data.acceptCancellation(order.id, seller.id)))).toBe("CANCEL_REQUEST_EXPIRED");
        expect(code(await rejects(data.declineCancellation(order.id, seller.id)))).toBe("CANCEL_REQUEST_EXPIRED");
        expect(code(await rejects(data.withdrawCancellation(order.id, buyer.id)))).toBe("CANCEL_REQUEST_EXPIRED");
        expect(code(await rejects(data.requestCancellation(order.id, buyer.id)))).toBe("CANCEL_REQUEST_REFUSED");
        expect(await account("order_escrow")).toBe(-order.totalMinor);
        expect(env.refunds()).toBe(0);
        // le litige reste ouvert à l'acheteur
        expect((await data.openDispute(order.id, buyer.id, { reason: "other", description: "Demande restée sans réponse." })).status).toBe("open");
      });
      it("remise par code pendant une demande : le code vaut acceptation, la demande est close et l'argent va au vendeur", async () => {
        const { order, buyer, seller } = await paidOrder("Acheteur C7", "+243821700107", 10_000);
        await data.requestCancellation(order.id, buyer.id);
        const v = await data.confirmDelivery(order.id, seller.id, deriveHandoverCode(order.id));
        expect(v.status).toBe("completed");
        expect(v.cancelRequest).toBeNull();
        expect((await data.getOrder(order.id, buyer.id)).cancelRequest).toBeNull();
        expect(await account("order_escrow")).toBe(0);
        expect(await account("seller_available")).toBe(-order.itemsMinor);
        expect(await ledgerSum("USD")).toBe(0);
        expect(code(await rejects(data.acceptCancellation(order.id, seller.id)))).toBe("INVALID_STATE");
        expect(code(await rejects(data.withdrawCancellation(order.id, buyer.id)))).toBe("INVALID_STATE");
      });
      it("le vendeur peut toujours annuler seul pendant une demande : remboursement intégral, demande close", async () => {
        const { order, buyer, seller, item } = await paidOrder("Acheteur C8", "+243821700108");
        await data.requestCancellation(order.id, buyer.id);
        const v = await data.cancelOrder(order.id, seller.id);
        expect(v.status).toBe("cancelled");
        expect(v.cancelRequest).toBeNull();
        expect(await account("order_escrow")).toBe(0);
        expect(await ledgerSum("USD")).toBe(0);
        expect((await data.getItem(item.id))!.status).toBe("active");
        expect(env.refunds()).toBe(1);
      });
      it("droits : l'acheteur ne répond pas à sa propre demande, le vendeur n'en fait pas, un tiers n'obtient que des 404", async () => {
        const { order, buyer, seller } = await paidOrder("Acheteur C9", "+243821700109");
        const tiers = await signup("0831111188", "Tiers C");
        expect(code(await rejects(data.requestCancellation(order.id, seller.id)))).toBe("NOT_FOUND");
        await data.requestCancellation(order.id, buyer.id);
        expect(code(await rejects(data.acceptCancellation(order.id, buyer.id)))).toBe("NOT_FOUND");
        expect(code(await rejects(data.declineCancellation(order.id, buyer.id)))).toBe("NOT_FOUND");
        expect(code(await rejects(data.withdrawCancellation(order.id, seller.id)))).toBe("NOT_FOUND");
        expect(code(await rejects(data.requestCancellation(order.id, tiers.id)))).toBe("NOT_FOUND");
        expect(code(await rejects(data.withdrawCancellation(order.id, tiers.id)))).toBe("NOT_FOUND");
        expect(code(await rejects(data.acceptCancellation(order.id, tiers.id)))).toBe("NOT_FOUND");
        expect(code(await rejects(data.declineCancellation(order.id, tiers.id)))).toBe("NOT_FOUND");
        expect(code(await rejects(data.acceptCancellation("00000000-0000-4000-8000-000000000000", seller.id)))).toBe("NOT_FOUND");
        expect((await data.getOrder(order.id, seller.id)).cancelRequest?.status).toBe("pending");
        expect(await account("order_escrow")).toBe(-order.totalMinor);
      });
      it("états incompatibles : pas de demande avant paiement, après remise, ni pendant un litige", async () => {
        const seller = (await data.getUser(S("user-marie")))!;
        const buyer = await signup("+243821700110", "Acheteur C10");
        const unpaid = await data.createOrder(buyer.id, { itemIds: [(await listing(seller.id)).id], deliveryMethod: "hand_delivery" });
        expect(code(await rejects(data.requestCancellation(unpaid.id, buyer.id)))).toBe("INVALID_STATE");
        const d = await paidOrder("Acheteur C11", "+243821700111");
        await data.openDispute(d.order.id, d.buyer.id, { reason: "other", description: "Litige ouvert avant toute demande." });
        expect(code(await rejects(data.requestCancellation(d.order.id, d.buyer.id)))).toBe("INVALID_STATE");
        const e = await paidOrder("Acheteur C12", "+243821700112");
        await data.confirmDelivery(e.order.id, e.seller.id, deriveHandoverCode(e.order.id));
        expect(code(await rejects(data.requestCancellation(e.order.id, e.buyer.id)))).toBe("INVALID_STATE");
        expect((await data.getOrder(e.order.id, e.buyer.id)).actions).not.toContain("request_cancel");
      });
      it("commande jamais remise au-delà du délai général : remboursement automatique malgré une demande en attente", async () => {
        const { order, buyer } = await paidOrder("Acheteur C13", "+243821700113", 10_000);
        await data.requestCancellation(order.id, buyer.id);
        env.advance(FEES.unhandedOrderMs + 1000);
        expect(await data.expireStalePaidOrders()).toBe(1);
        const v = await data.getOrder(order.id, buyer.id);
        expect(v.status).toBe("cancelled");
        expect(v.cancelRequest).toBeNull();
        expect(await ledgerSum("USD")).toBe(0);
      });
    });
    // ---- fin agent A

    // ---- agent E : articles interdits
    describe("articles interdits à la publication", () => {
      const draftOf = (sellerId: string, over: Record<string, unknown>) =>
        data.createDraft(sellerId, { title: "Robe test", description: "", categoryId: S("cat-robes"), condition: "good", priceMinor: 2500, currency: "USD", areaId: S("area-com-gombe"), photos: [PHOTO], ...over });

      it("une annonce interdite est refusée en 422 avec le champ et le message de la règle ; elle reste en brouillon", async () => {
        const seller = await signup("0811000141", "Vendeur Interdit");
        const d = await draftOf(seller.id, { title: "Vends pistolet 9mm" });
        const e = await rejects(data.publishItem(seller.id, d.id));
        expect(code(e)).toBe("PROHIBITED_ITEM");
        expect(e.status).toBe(422);
        expect(Object.keys(e.details ?? {})).toEqual(["title"]);
        expect(e.message).toBe(e.details!.title);
        // brouillon intact : visible de son vendeur seulement, pas dans les résultats de recherche
        const mine = await data.getItem(d.id, seller.id);
        expect(mine?.title).toBe("Vends pistolet 9mm");
        expect(mine?.status).toBe("draft");
        expect(await data.getItem(d.id, null)).toBeNull();
        expect((await data.listItems({ q: "pistolet" })).some((x) => x.id === d.id)).toBe(false);
        // un second essai donne le même refus (pas d'état à moitié publié)
        expect(code(await rejects(data.publishItem(seller.id, d.id)))).toBe("PROHIBITED_ITEM");
      });
      it("la description et la marque sont contrôlées ; le refus ne divulgue ni le mot trouvé ni la liste", async () => {
        const seller = await signup("0811000142", "Vendeur Interdit Deux");
        const d = await draftOf(seller.id, { description: "Je vends aussi de la Cocaïne" });
        const e = await rejects(data.publishItem(seller.id, d.id));
        expect(Object.keys(e.details ?? {})).toEqual(["description"]);
        expect(JSON.stringify([e.message, e.details]).toLowerCase()).not.toMatch(/coca/);
        const d2 = await draftOf(seller.id, { brand: "Kalachnikov" });
        expect(Object.keys((await rejects(data.publishItem(seller.id, d2.id))).details ?? {})).toEqual(["brand"]);
      });
      it("contournements par casse, accents, espaces et lettres espacées : refusés", async () => {
        const seller = await signup("0811000143", "Vendeur Contourne");
        for (const title of ["ARME à FEU", "a  r  m  e   a   feu", "C O C A Ï N E", "t.r.a.m.a.d.o.l"]) {
          const d = await draftOf(seller.id, { title });
          expect(code(await rejects(data.publishItem(seller.id, d.id))), title).toBe("PROHIBITED_ITEM");
        }
      });
      it("les mots proches mais légitimes sont acceptés (limites de mots, exceptions)", async () => {
        const seller = await signup("0811000144", "Vendeur Légitime");
        for (const title of ["Alarme maison", "Bracelet charme", "Pistolet à colle", "Robe ivoire", "Téléphone non volé"]) {
          const a = await listing(seller.id, { title });
          expect(a.status).toBe("active");
        }
        const withDesc = await listing(seller.id, { title: "Veste", description: "Couleur ivoire, achetée en Côte d'Ivoire, très bon état." });
        expect(withDesc.status).toBe("active");
      });
      it("aucun contournement pour le personnel : un modérateur ou le support ne publie pas non plus pour un vendeur, et la règle vaut pour tous", async () => {
        const staff = S("user-support-2");
        const d = await draftOf(staff, { title: "Munitions calibre 12" });
        expect(code(await rejects(data.publishItem(staff, d.id)))).toBe("PROHIBITED_ITEM");
      });
      it("les annonces déjà publiées ne sont pas rétro-analysées", async () => {
        const seller = await signup("0811000145", "Vendeur Ancien");
        const ok = await listing(seller.id, { title: "Montre ordinaire" });
        expect((await data.getItem(ok.id, null))?.status).toBe("active");
        expect((await data.listItems({ q: "montre ordinaire" })).some((x) => x.id === ok.id)).toBe(true);
      });
      it("la liste publique des règles ne contient jamais de mots-clés", async () => {
        const rules = await data.listProhibitedRules();
        expect(rules.length).toBeGreaterThanOrEqual(10);
        for (const r of rules) {
          expect(Object.keys(r).sort()).toEqual(["id", "label", "message"]);
          expect(r.label.length).toBeGreaterThan(0);
        }
        expect(JSON.stringify(rules).toLowerCase()).not.toMatch(/kalachnikov|cocaine|tramadol/);
      });
    });
    // ---- fin agent E
  });
}

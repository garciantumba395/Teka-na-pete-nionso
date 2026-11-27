import { beforeEach, describe, expect, it } from "vitest";
import { createFakeData, type FakeData } from "../data/fake";
import { deriveHandoverCode } from "../handover";
import { FEES } from "../fees";
import { AppError } from "../types";

let t = 1_700_000_000_000;
let data: FakeData;
const PHOTO = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ";

beforeEach(() => {
  t = 1_700_000_000_000;
  data = createFakeData({ now: () => t, autoComplete: false });
});

async function signup(phone: string, name: string) {
  await data.requestOtp(phone);
  return (await data.verifyOtp(phone, "123456", name)).user;
}
async function listing(sellerId: string, over: Record<string, unknown> = {}) {
  const d = await data.createDraft(sellerId, {
    title: "Robe test", description: "", categoryId: "cat-robes", condition: "good", priceMinor: 2500, currency: "USD", areaId: "area-com-gombe", photos: [PHOTO], ...over,
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
const ledgerSum = (cur: "USD" | "CDF") => data.__ledger().filter((e) => e.currency === cur).reduce((s, e) => s + e.amountMinor, 0);
const account = (a: string, cur: "USD" | "CDF" = "USD") => data.__ledger().filter((e) => e.account === a && e.currency === cur).reduce((s, e) => s + e.amountMinor, 0);

async function paidOrder(buyerName = "Acheteur", phone = "+243821111111", priceMinor = 2500) {
  const seller = (await data.getUser("user-marie"))!;
  const buyer = await signup(phone, buyerName);
  const item = await listing(seller.id, { priceMinor });
  const order = await data.createOrder(buyer.id, { itemIds: [item.id], deliveryMethod: "hand_delivery" });
  await data.startPayment(order.id, buyer.id, { method: "mpesa", msisdn: "0821111111", idempotencyKey: `k-${order.id}` });
  await data.__flush();
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
    t += 6 * 60_000;
    expect(code(await rejects(data.verifyOtp("0831234567", "123456", "X Y")))).toBe("OTP_EXPIRED");
  });
});

describe("annonces", () => {
  it("refuse une photo qui n'est pas une image compressée, et au-delà de 20", async () => {
    const m = (await data.getUser("user-marie"))!;
    const base = { title: "Robe test", description: "", categoryId: "cat-robes", condition: "good", priceMinor: 100, currency: "USD", photos: ["<script>"] };
    expect(code(await rejects(data.createDraft(m.id, base)))).toBe("VALIDATION");
    expect(code(await rejects(data.createDraft(m.id, { ...base, photos: Array(21).fill(PHOTO) })))).toBe("VALIDATION");
  });
  it("applique le plafond de prix et la catégorie à la publication (côté serveur)", async () => {
    const m = (await data.getUser("user-marie"))!;
    const e = await rejects(listing(m.id, { priceMinor: 100_001 }));
    expect(e.code).toBe("VALIDATION");
    expect(e.details?.priceMinor).toMatch(/maximum/);
    expect((await rejects(listing(m.id, { categoryId: "cat-femme" }))).details?.categoryId).toMatch(/n'accepte pas/);
    expect((await rejects(listing(m.id, { photos: [] }))).details?.photos).toMatch(/photo/);
  });
  it("un brouillon n'est visible que de son vendeur ; une annonce publiée l'est de tous", async () => {
    const m = (await data.getUser("user-marie"))!;
    const d = await data.createDraft(m.id, { title: "Brouillon", description: "", categoryId: "cat-robes", condition: "good", priceMinor: 100, currency: "USD", photos: [PHOTO] });
    expect(await data.getItem(d.id, "user-patrick")).toBeNull();
    expect(await data.getItem(d.id, m.id)).not.toBeNull();
    await data.publishItem(m.id, d.id);
    expect(await data.getItem(d.id, "user-patrick")).not.toBeNull();
    expect(code(await rejects(data.publishItem(m.id, d.id)))).toBe("INVALID_STATE");
  });
  it("la position de l'annonce est approximative (arrondie)", async () => {
    const m = (await data.getUser("user-marie"))!;
    const it = await listing(m.id);
    expect(it.lat).toBe(Math.round(it.lat! * 100) / 100);
  });
  it("recherche : texte sans accents, catégorie parente, rayon", async () => {
    expect((await data.listItems({ q: "ecouteurs" })).map((c) => c.title)).toContain("Écouteurs filaires");
    const femmes = await data.listItems({ categoryId: "cat-femme" });
    expect(femmes.length).toBeGreaterThan(3);
    const near = await data.listItems({ areaId: "area-com-gombe", radiusKm: 3 });
    expect(near.length).toBeGreaterThan(0);
    expect(near.every((c) => c.distanceKm! <= 3)).toBe(true);
    const wider = await data.listItems({ areaId: "area-com-gombe", radiusKm: 15 });
    expect(wider.length).toBeGreaterThan(near.length);
  });
});

describe("commande et réservation", () => {
  it("deux acheteurs, un seul article : un seul gagne", async () => {
    const m = (await data.getUser("user-marie"))!;
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
    const m = (await data.getUser("user-marie"))!;
    const own = await listing(m.id);
    expect(code(await rejects(data.createOrder(m.id, { itemIds: [own.id], deliveryMethod: "hand_delivery" })))).toBe("SELF_PURCHASE");
    const buyer = await signup("0821000003", "Acheteur C");
    const usd = await listing(m.id);
    const cdf = await listing(m.id, { currency: "CDF", priceMinor: 3_500_000 });
    expect(code(await rejects(data.createOrder(buyer.id, { itemIds: [usd.id, cdf.id], deliveryMethod: "hand_delivery" })))).toBe("MIXED_CURRENCY");
  });
  it("le total = articles + frais de protection, calculé par le serveur", async () => {
    const m = (await data.getUser("user-marie"))!;
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
    const m = (await data.getUser("user-marie"))!;
    const buyer = await signup("0821000005", "Acheteur E");
    const item = await listing(m.id);
    const o = await data.createOrder(buyer.id, { itemIds: [item.id], deliveryMethod: "hand_delivery" });
    t += FEES.orderPaymentTtlMs + 1;
    expect((await data.getOrder(o.id, buyer.id)).status).toBe("expired");
    expect((await data.getItem(item.id))!.status).toBe("active");
  });
});

describe("paiement et séquestre", () => {
  it("paiement réussi : commande payée, argent mis de côté, code visible de l'acheteur seul", async () => {
    const { order, buyer, seller } = await paidOrder();
    const v = await data.getOrder(order.id, buyer.id);
    expect(v.status).toBe("paid");
    expect(account("order_escrow")).toBe(-order.totalMinor);
    expect(account("psp_clearing")).toBe(order.totalMinor);
    expect(await data.getHandoverCode(order.id, buyer.id)).toBe(deriveHandoverCode(order.id));
    expect(code(await rejects(data.getHandoverCode(order.id, seller.id)))).toBe("NOT_FOUND");
    expect(ledgerSum("USD")).toBe(0);
  });
  it("refus du paiement : la commande reste ouverte, un nouvel essai est possible", async () => {
    const m = (await data.getUser("user-marie"))!;
    const buyer = await signup("0821000006", "Acheteur F");
    const item = await listing(m.id);
    const o = await data.createOrder(buyer.id, { itemIds: [item.id], deliveryMethod: "hand_delivery" });
    await data.startPayment(o.id, buyer.id, { method: "mpesa", msisdn: "0821000100", idempotencyKey: "k1" });
    await data.__flush();
    const v = await data.getOrder(o.id, buyer.id);
    expect(v.status).toBe("pending_payment");
    expect(v.payment?.status).toBe("failed");
    expect(v.payment?.failureCode).toBe("INSUFFICIENT_FUNDS");
    await data.startPayment(o.id, buyer.id, { method: "mpesa", msisdn: "0821000101", idempotencyKey: "k2" });
    await data.__flush();
    expect((await data.getOrder(o.id, buyer.id)).status).toBe("paid");
  });
  it("même clé d'idempotence = même paiement ; un second paiement en attente est refusé", async () => {
    const m = (await data.getUser("user-marie"))!;
    const buyer = await signup("0821000007", "Acheteur G");
    const item = await listing(m.id);
    const o = await data.createOrder(buyer.id, { itemIds: [item.id], deliveryMethod: "hand_delivery" });
    const p1 = await data.startPayment(o.id, buyer.id, { method: "orange_money", msisdn: "0821000007", idempotencyKey: "same" });
    const p2 = await data.startPayment(o.id, buyer.id, { method: "orange_money", msisdn: "0821000007", idempotencyKey: "same" });
    expect(p2.id).toBe(p1.id);
    expect(code(await rejects(data.startPayment(o.id, buyer.id, { method: "orange_money", msisdn: "0821000007", idempotencyKey: "autre" })))).toBe("PAYMENT_IN_PROGRESS");
  });
  it("un webhook rejoué ne change rien (même événement, puis nouvel événement sur le même paiement)", async () => {
    const m = (await data.getUser("user-marie"))!;
    const buyer = await signup("0821000010", "Acheteur K");
    const item = await listing(m.id);
    const o = await data.createOrder(buyer.id, { itemIds: [item.id], deliveryMethod: "hand_delivery" });
    await data.startPayment(o.id, buyer.id, { method: "mpesa", msisdn: "0821000010", idempotencyKey: "replay" });
    const [ev] = data.__pendingEvents();
    expect((await data.handleProviderEvent(ev)).duplicate).toBe(false);
    const n = data.__ledger().length;
    expect(n).toBeGreaterThan(0);
    expect((await data.handleProviderEvent(ev)).duplicate).toBe(true); // même eventId : table webhook_events
    expect((await data.handleProviderEvent({ ...ev, eventId: "autre-id" })).duplicate).toBe(true); // paiement déjà encaissé
    expect(data.__ledger().length).toBe(n);
    expect(account("order_escrow")).toBe(-o.totalMinor); // encaissé une seule fois
  });
  it("paiement tardif après expiration : remboursé automatiquement, l'argent n'est jamais gardé", async () => {
    const m = (await data.getUser("user-marie"))!;
    const buyer = await signup("0821000008", "Acheteur H");
    const item = await listing(m.id);
    const o = await data.createOrder(buyer.id, { itemIds: [item.id], deliveryMethod: "hand_delivery" });
    await data.startPayment(o.id, buyer.id, { method: "mpesa", msisdn: "0821000008", idempotencyKey: "late" });
    t += FEES.orderPaymentTtlMs + 1;
    await data.__flush();
    const v = await data.getOrder(o.id, buyer.id);
    expect(v.status).toBe("expired");
    expect(v.payment?.status).toBe("refunded");
    expect(account("order_escrow")).toBe(0);
    expect(ledgerSum("USD")).toBe(0);
    expect(data.__provider.refunds).toHaveLength(1);
    expect((await data.getItem(item.id))!.status).toBe("active");
  });
  it("annulation après paiement : remboursement intégral et article libéré", async () => {
    const { order, buyer, item } = await paidOrder("Acheteur I", "+243821222222");
    const v = await data.cancelOrder(order.id, buyer.id);
    expect(v.status).toBe("cancelled");
    expect(account("order_escrow")).toBe(0);
    expect(account("psp_clearing")).toBe(0);
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
    expect(account("order_escrow")).toBe(0);
    expect(account("seller_available")).toBe(-order.itemsMinor);
    expect(account("platform_revenue")).toBe(-order.protectionFeeMinor);
    expect(ledgerSum("USD")).toBe(0);
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
    t += FEES.handoverLockMs + 1;
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
    await data.__flush();
    expect((await data.listPayouts(s.id))[0].status).toBe("paid");
    expect(ledgerSum("USD")).toBe(0);
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
    await data.__flush();
    const w = await data.getWallet(s.id);
    expect((await data.listPayouts(s.id))[0].status).toBe("failed");
    expect(w.balances.find((b) => b.currency === "USD")!.availableMinor).toBe(before);
    expect(ledgerSum("USD")).toBe(0);
  });
});

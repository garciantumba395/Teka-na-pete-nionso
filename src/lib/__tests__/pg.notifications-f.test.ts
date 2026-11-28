import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { FEES } from "../fees";
import { seedId as S } from "../data/ids";
import { endTestPool, makePgEnv, TEST_URL, type PgEnv } from "./pg-env";

const suite = TEST_URL ? describe : describe.skip;
const PHOTO = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ";

afterAll(endTestPool);

// agent F : propriétés des nouvelles notifications qui ne se prouvent que sur la vraie base (transaction, index uniques, concurrence).
suite("PostgreSQL : notifications ajoutées (annulation, coursier, preuves, modération)", () => {
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
  async function paidOrder(phone: string, method: "hand_delivery" | "courier" = "hand_delivery") {
    const seller = (await data.getUser(S("user-marie")))!;
    const buyer = await signup(phone, "Acheteur Atomique F");
    const d = await data.createDraft(seller.id, { title: "Robe test", description: "", categoryId: S("cat-robes"), condition: "good", priceMinor: 2500, currency: "USD", areaId: S("area-com-gombe"), photos: [PHOTO] });
    const item = await data.publishItem(seller.id, d.id);
    const order = await data.createOrder(buyer.id, method === "courier"
      ? { itemIds: [item.id], deliveryMethod: "courier", deliveryAreaId: S("area-com-limete"), deliveryLandmark: "Avenue de la Paix, portail bleu" }
      : { itemIds: [item.id], deliveryMethod: "hand_delivery" });
    await data.startPayment(order.id, buyer.id, { method: "mpesa", msisdn: "0821111111", idempotencyKey: `k-${order.id}` });
    await env.flush();
    return { seller, buyer, order };
  }
  const count = async (kind: string) => (await env.pool.query(`select count(*)::int as n from notifications where kind = $1`, [kind])).rows[0].n as number;

  it("la notification de demande d'annulation est écrite DANS la transaction : si elle échoue, la demande est annulée et aucun SMS ne part", async () => {
    const { order, buyer } = await paidOrder("+243821900201");
    await env.pool.query(`alter table notifications add constraint test_refuse_cancel check (kind <> 'cancel_requested')`);
    try {
      await expect(data.requestCancellation(order.id, buyer.id)).rejects.toBeTruthy();
      expect((await env.pool.query(`select count(*)::int as n from order_cancel_requests where order_id = $1`, [order.id])).rows[0].n).toBe(0);
      await env.settleSms();
      expect(env.sms.sent.filter((s) => /demande l'annulation/.test(s.text))).toEqual([]);
    } finally {
      await env.pool.query(`alter table notifications drop constraint test_refuse_cancel`);
    }
    await data.requestCancellation(order.id, buyer.id); // la contrainte levée, tout fonctionne
    expect(await count("cancel_requested")).toBe(1);
  });

  it("la notification « colis remis au coursier » est écrite DANS la transaction : si elle échoue, le colis n'est pas marqué remis", async () => {
    const { order, seller } = await paidOrder("+243821900202", "courier");
    await env.pool.query(`alter table notifications add constraint test_refuse_handed check (kind <> 'parcel_handed')`);
    try {
      await expect(data.shipOrder(order.id, seller.id, { courierName: "Papy Moto", courierPhone: "0899000111" })).rejects.toBeTruthy();
      expect((await data.getOrder(order.id, seller.id)).status).toBe("paid");
    } finally {
      await env.pool.query(`alter table notifications drop constraint test_refuse_handed`);
    }
  });

  it("deux exécutions simultanées de la tâche d'expiration : une seule notification par membre et par demande", async () => {
    const { order, buyer } = await paidOrder("+243821900203");
    await data.requestCancellation(order.id, buyer.id);
    env.advance(FEES.cancelRequestTtlMs + 60_000);
    for (let round = 0; round < 5; round++) {
      await Promise.all([data.notifyExpiredCancelRequests(), data.notifyExpiredCancelRequests(), data.notifyExpiredCancelRequests()]);
    }
    expect(await count("cancel_expired")).toBe(2); // acheteur + vendeur, une fois chacun
  });

  it("deux exécutions simultanées de la libération automatique : une seule libération, une notification par partie", async () => {
    const { order, buyer, seller } = await paidOrder("+243821900204", "courier");
    await data.shipOrder(order.id, seller.id, { courierName: "Papy Moto", courierPhone: "0899000111" });
    await data.confirmReceived(order.id, buyer.id);
    env.advance(FEES.claimWindowMs + 60_000);
    const r = await Promise.all([data.releaseDeliveredOrders(), data.releaseDeliveredOrders(), data.releaseDeliveredOrders()]);
    expect(r.reduce((a, b) => a + b, 0)).toBe(1);
    expect(await count("order_auto_released")).toBe(2);
  });

  it("deux rappels de fenêtre simultanés : un seul rappel", async () => {
    const { order, buyer, seller } = await paidOrder("+243821900205", "courier");
    await data.shipOrder(order.id, seller.id, { courierName: "Papy Moto", courierPhone: "0899000111" });
    await data.confirmReceived(order.id, buyer.id);
    env.advance(FEES.claimWindowMs - 2 * 3_600_000);
    await Promise.all([data.remindClaimWindows(), data.remindClaimWindows(), data.remindClaimWindows()]);
    expect(await count("claim_reminder")).toBe(1);
  });
});

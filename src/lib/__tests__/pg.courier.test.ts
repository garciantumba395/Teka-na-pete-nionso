import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { seedId as S } from "../data/ids";
import { FEES } from "../fees";
import { endTestPool, makePgEnv, TEST_URL, type PgEnv } from "./pg-env";

// PostgreSQL : verrouillage de ligne et garde-fous de la livraison par coursier (agent D).
const suite = TEST_URL ? describe : describe.skip;
const PHOTO = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ";

afterAll(endTestPool);

suite("PostgreSQL : livraison par coursier", () => {
  let env: PgEnv;
  let data: PgEnv["data"];
  beforeEach(async () => {
    env = await makePgEnv();
    data = env.data;
  });

  async function receivedOrder(phone: string) {
    const seller = (await data.getUser(S("user-marie")))!;
    await data.requestOtp(phone);
    const buyer = (await data.verifyOtp(phone, "123456", "Acheteur")).user;
    const d = await data.createDraft(seller.id, { title: "Robe test", description: "", categoryId: S("cat-robes"), condition: "good", priceMinor: 10_000, currency: "USD", areaId: S("area-com-gombe"), photos: [PHOTO] });
    const item = await data.publishItem(seller.id, d.id);
    const order = await data.createOrder(buyer.id, { itemIds: [item.id], deliveryMethod: "courier", deliveryAreaId: S("area-com-limete"), deliveryLandmark: "Près du marché" });
    await data.startPayment(order.id, buyer.id, { method: "mpesa", msisdn: phone, idempotencyKey: `k-${order.id}` });
    await env.flush();
    await data.shipOrder(order.id, seller.id, { courierName: "Papy Moto", courierPhone: "0899000111" });
    await data.confirmReceived(order.id, buyer.id);
    return { seller, buyer, order };
  }

  it("deux exécutions simultanées de la libération automatique : une seule libération, grand livre équilibré", async () => {
    const { order } = await receivedOrder("0838100001");
    env.advance(FEES.claimWindowMs + 1000);
    const runs = await Promise.all([data.releaseDeliveredOrders(), data.releaseDeliveredOrders(), data.releaseDeliveredOrders()]);
    expect(runs.reduce((a, b) => a + b, 0)).toBe(1);
    const entries = (await env.pool.query(`select account, sum(amount_minor)::int as s from ledger_entries where ref_type = 'order' and ref_id = $1 group by account`, [order.id])).rows;
    expect(entries.find((e) => e.account === "seller_available")?.s).toBe(-10_000);
    const total = (await env.pool.query(`select coalesce(sum(amount_minor), 0)::int as s from ledger_entries`)).rows[0].s;
    expect(total).toBe(0);
    expect((await env.pool.query(`select count(*)::int as n from shipment_events where order_id = $1 and kind = 'auto_released'`, [order.id])).rows[0].n).toBe(1);
  });

  it("acceptation de l'acheteur et libération automatique en même temps : une seule libération", async () => {
    const { buyer, order } = await receivedOrder("0838100002");
    env.advance(FEES.claimWindowMs + 1000);
    const [a, b] = await Promise.allSettled([data.acceptOrder(order.id, buyer.id), data.releaseDeliveredOrders()]);
    expect([a.status, b.status].filter((s) => s === "fulfilled").length).toBeGreaterThanOrEqual(1);
    const releases = (await env.pool.query(`select count(*)::int as n from ledger_entries where ref_type = 'order' and ref_id = $1 and account = 'seller_available'`, [order.id])).rows[0].n;
    expect(releases).toBe(1);
  });

  it("litige et libération automatique en même temps : jamais les deux", async () => {
    const { buyer, order } = await receivedOrder("0838100003");
    env.advance(FEES.claimWindowMs - 1000); // fenêtre encore ouverte pour le litige
    const [d] = await Promise.allSettled([
      data.openDispute(order.id, buyer.id, { reason: "damaged", description: "Le colis est arrivé écrasé." }),
      data.releaseDeliveredOrders(),
    ]);
    expect(d.status).toBe("fulfilled");
    const status = (await env.pool.query(`select status from orders where id = $1`, [order.id])).rows[0].status;
    expect(status).toBe("disputed");
    expect((await env.pool.query(`select count(*)::int as n from ledger_entries where ref_type = 'order' and ref_id = $1 and account = 'seller_available'`, [order.id])).rows[0].n).toBe(0);
  });

  it("la base refuse une valeur de confirmation inconnue et le seul trigger de transitions reste en vigueur", async () => {
    const { order } = await receivedOrder("0838100004");
    await expect(env.pool.query(`update shipments set delivered_confirmed_by = 'magie' where order_id = $1`, [order.id])).rejects.toThrow();
    await expect(env.pool.query(`update orders set status = 'paid' where id = $1`, [order.id])).rejects.toThrow(/invalid order transition/);
    await expect(env.pool.query(`insert into shipment_events (shipment_id, order_id, kind) select id, order_id, 'inconnu' from shipments where order_id = $1`, [order.id])).rejects.toThrow();
  });

  it("les paramètres de la table settings surchargent la grille, le délai de réclamation et le délai colis perdu", async () => {
    await env.pool.query(`insert into settings (key, value) values ('shipping_grid', $1), ('claim_window_hours', '1'), ('courier_stale_days', '2') on conflict (key) do update set value = excluded.value`,
      [JSON.stringify({ sameCity: { USD: 777 } })]);
    const seller = (await data.getUser(S("user-marie")))!;
    await data.requestOtp("0838100005");
    const buyer = (await data.verifyOtp("0838100005", "123456", "Acheteur")).user;
    const d = await data.createDraft(seller.id, { title: "Robe test", description: "", categoryId: S("cat-robes"), condition: "good", priceMinor: 10_000, currency: "USD", areaId: S("area-com-gombe"), photos: [PHOTO] });
    const item = await data.publishItem(seller.id, d.id);
    expect((await data.quoteShipping(item.id, S("area-com-limete"))).shippingMinor).toBe(777);
    expect((await data.quoteShipping(item.id, S("area-com-gombe"))).shippingMinor).toBe(FEES.shippingGrid.sameCommune.USD); // clé absente : valeur par défaut
    const order = await data.createOrder(buyer.id, { itemIds: [item.id], deliveryMethod: "courier", deliveryAreaId: S("area-com-limete"), deliveryLandmark: "Près du marché" });
    await data.startPayment(order.id, buyer.id, { method: "mpesa", msisdn: "0838100005", idempotencyKey: `k-${order.id}` });
    await env.flush();
    await data.shipOrder(order.id, seller.id, { courierName: "Papy Moto", courierPhone: "0899000111" });
    const rec = await data.confirmReceived(order.id, buyer.id);
    expect(rec.autoReleaseAt).toBe(env.now() + 3_600_000);
    env.advance(3_600_000);
    expect(await data.releaseDeliveredOrders()).toBe(1);
  });
});

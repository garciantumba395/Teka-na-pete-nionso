import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { seedId as S } from "../data/ids";
import { endTestPool, makePgEnv, TEST_URL, type PgEnv } from "./pg-env";

const suite = TEST_URL ? describe : describe.skip;
const PHOTO = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ";

afterAll(endTestPool);

// agent C : comportements des notifications qui ne se prouvent que sur la vraie base (transaction, index uniques, concurrence).
suite("PostgreSQL : notifications", () => {
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
  async function listing(sellerId: string) {
    const d = await data.createDraft(sellerId, { title: "Robe test", description: "", categoryId: S("cat-robes"), condition: "good", priceMinor: 2500, currency: "USD", areaId: S("area-com-gombe"), photos: [PHOTO] });
    return data.publishItem(sellerId, d.id);
  }
  const rows = async (userId: string) => (await env.pool.query(`select * from notifications where user_id = $1 order by created_at`, [userId])).rows;

  it("huit messages simultanés : une seule ligne non lue pour la conversation, compteur exact", async () => {
    const seller = await signup("0811000401", "Vendeuse Concurrence");
    const buyer = await signup("0821000402", "Acheteur Concurrence");
    const conv = await data.startConversation(buyer.id, (await listing(seller.id)).id);
    await Promise.all(Array.from({ length: 8 }, (_, i) => data.sendMessage(conv.id, buyer.id, `message ${i}`)));
    const r = await rows(seller.id);
    expect(r).toHaveLength(1);
    expect(r[0].payload.count).toBe(8);
    expect(r[0].group_key).toBe(`conv:${conv.id}`);
  });

  it("la clé d'événement est unique par membre en base (garde-fou même hors du code applicatif)", async () => {
    const m = await signup("0811000403", "Membre Cle");
    const ins = () => env.pool.query(`insert into notifications (user_id, kind, payload, event_key) values ($1, 'order_paid', '{}', 'order_paid:x')`, [m.id]);
    await ins();
    await expect(ins()).rejects.toMatchObject({ code: "23505" });
  });

  it("la notification est écrite DANS la transaction de l'événement : si elle échoue, l'événement est annulé et aucun SMS ne part", async () => {
    const seller = (await data.getUser(S("user-marie")))!;
    const buyer = await signup("+243821000411", "Acheteur Atomique");
    const item = await listing(seller.id);
    const order = await data.createOrder(buyer.id, { itemIds: [item.id], deliveryMethod: "hand_delivery" });
    await data.startPayment(order.id, buyer.id, { method: "mpesa", msisdn: "0821111111", idempotencyKey: `k-${order.id}` });
    const [ev] = await env.pendingEvents();
    await env.pool.query(`alter table notifications add constraint test_refuse_paid check (kind <> 'order_paid')`);
    try {
      await expect(env.flush()).rejects.toBeTruthy();
      expect((await data.getOrder(order.id, buyer.id)).status).toBe("pending_payment"); // l'encaissement a été annulé avec la notification
      expect((await env.ledger()).length).toBe(0);
      await env.settleSms();
      expect(env.sms.sent.filter((s) => !/ton code/.test(s.text))).toEqual([]);
    } finally {
      await env.pool.query(`alter table notifications drop constraint test_refuse_paid`);
    }
    // l'événement n'a pas été consommé : rejoué, il aboutit, avec UNE notification
    expect((await data.handleProviderEvent(ev)).duplicate).toBe(false);
    expect((await rows(seller.id)).filter((n) => n.kind === "order_paid")).toHaveLength(1);
    expect((await data.getOrder(order.id, buyer.id)).status).toBe("paid");
  });

  it("le SMS part après la validation et marque le canal dans la notification", async () => {
    const seller = (await data.getUser(S("user-marie")))!;
    const buyer = await signup("+243821000412", "Acheteur Canal");
    const order = await data.createOrder(buyer.id, { itemIds: [(await listing(seller.id)).id], deliveryMethod: "hand_delivery" });
    await data.startPayment(order.id, buyer.id, { method: "mpesa", msisdn: "0821111111", idempotencyKey: `k-${order.id}` });
    await env.flush();
    await env.settleSms();
    const r = (await rows(seller.id)).filter((n) => n.kind === "order_paid");
    expect(r).toHaveLength(1);
    expect(r[0].channels_sent).toEqual(["sms"]);
  });

  it("la charge utile ne contient ni numéro, ni code de remise, ni montant", async () => {
    const seller = (await data.getUser(S("user-marie")))!;
    const buyer = await signup("+243821000413", "Acheteur Charge");
    const order = await data.createOrder(buyer.id, { itemIds: [(await listing(seller.id)).id], deliveryMethod: "hand_delivery" });
    await data.startPayment(order.id, buyer.id, { method: "mpesa", msisdn: "0821111111", idempotencyKey: `k-${order.id}` });
    await env.flush();
    const all = JSON.stringify((await env.pool.query(`select payload from notifications`)).rows);
    expect(all).not.toMatch(/\+243|0821111111|2500|2 500/);
  });
});

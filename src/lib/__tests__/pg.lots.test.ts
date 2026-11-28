import { afterAll, describe, expect, it } from "vitest";
import { seedId as S } from "../data/ids";
import type { AppError, Order } from "../types";
import { endTestPool, makePgEnv, TEST_URL } from "./pg-env";

const suite = TEST_URL ? describe : describe.skip;
afterAll(endTestPool);

// ---- agent J : lots. Concurrence sur un même lot : la réservation est tout ou rien.
suite("PostgreSQL : lots sous concurrence", () => {
  async function setup() {
    const env = await makePgEnv();
    const data = env.data;
    const buyers: { id: string }[] = [];
    for (const [phone, name] of [["0821000601", "Acheteur Course A"], ["0821000602", "Acheteur Course B"]] as const) {
      await data.requestOtp(phone);
      buyers.push((await data.verifyOtp(phone, "123456", name)).user);
    }
    const seller = S("user-marie");
    const make = async (n: number, tag: string) => {
      const out = [];
      for (let i = 0; i < n; i++) {
        const d = await data.createDraft(seller, { title: `Lot ${tag} ${i}`, description: "", categoryId: S("cat-robes"), condition: "good", priceMinor: 1500, currency: "USD", areaId: S("area-com-gombe"), photos: ["data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ"] });
        out.push(await data.publishItem(seller, d.id));
      }
      return out;
    };
    return { env, data, buyers, make };
  }
  const openItems = async (pool: import("../data/pg/pool").Pool, ids: string[]) =>
    (await pool.query(`select item_id, order_id from order_items where is_open and item_id = any($1::uuid[])`, [ids])).rows as { item_id: string; order_id: string }[];

  it("deux acheteurs visent le même lot (même ordre, ordre inverse) : un seul gagne, l'autre ne garde AUCUN article", async () => {
    const { env, data, buyers, make } = await setup();
    let aWins = 0, bWins = 0;
    for (let round = 0; round < 30; round++) {
      const items = await make(5, `r${round}`);
      const ids = items.map((i) => i.id);
      const results = await Promise.allSettled([
        data.createOrder(buyers[0].id, { itemIds: ids, deliveryMethod: "hand_delivery" }),
        data.createOrder(buyers[1].id, { itemIds: [...ids].reverse(), deliveryMethod: "hand_delivery" }),
      ]);
      const won = results.filter((r): r is PromiseFulfilledResult<Order> => r.status === "fulfilled");
      const lost = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      expect(won, `tour ${round}`).toHaveLength(1);
      expect((lost[0].reason as AppError).code).toBe("ITEM_UNAVAILABLE");
      if (results[0].status === "fulfilled") aWins++; else bWins++;
      const open = await openItems(env.pool, ids);
      expect(open, "les 5 articles appartiennent tous à la commande gagnante").toHaveLength(5);
      expect(new Set(open.map((r) => r.order_id))).toEqual(new Set([won[0].value.id]));
      for (const i of items) expect((await data.getItem(i.id))!.status).toBe("reserved");
    }
    expect(aWins + bWins).toBe(30);
  });

  it("deux lots qui se chevauchent seulement en partie : le perdant ne retient aucun des articles non partagés", async () => {
    const { env, data, buyers, make } = await setup();
    for (let round = 0; round < 30; round++) {
      const items = await make(5, `p${round}`);
      const [a1, a2, shared, b1, b2] = items.map((i) => i.id);
      const results = await Promise.allSettled([
        data.createOrder(buyers[0].id, { itemIds: [a1, a2, shared], deliveryMethod: "hand_delivery" }),
        data.createOrder(buyers[1].id, { itemIds: [shared, b1, b2], deliveryMethod: "hand_delivery" }),
      ]);
      expect(results.filter((r) => r.status === "fulfilled"), `tour ${round}`).toHaveLength(1);
      const aWon = results[0].status === "fulfilled";
      const open = await openItems(env.pool, [a1, a2, shared, b1, b2]);
      expect(open).toHaveLength(3);
      const free = aWon ? [b1, b2] : [a1, a2];
      for (const id of free) expect((await data.getItem(id))!.status, `article non partagé du perdant (tour ${round})`).toBe("active");
      const reserved = (await env.pool.query(`select count(*)::int as n from items where id = any($1::uuid[]) and status = 'reserved'`, [[a1, a2, shared, b1, b2]])).rows[0].n;
      expect(reserved).toBe(3);
    }
  });

  it("21 ajouts simultanés au panier : le plafond de 20 tient", async () => {
    const { data, buyers, make } = await setup();
    const items = await make(21, "panier");
    const results = await Promise.allSettled(items.map((i) => data.addToCart(buyers[0].id, i.id)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(20);
    const ko = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(ko).toHaveLength(1);
    expect((ko[0].reason as AppError).code).toBe("CART_FULL");
    expect((await data.getCart(buyers[0].id)).count).toBe(20);
  });

  it("le même article ajouté deux fois en même temps : un seul ajout, l'autre reçoit ALREADY_IN_CART", async () => {
    const { data, buyers, make } = await setup();
    for (let round = 0; round < 15; round++) {
      const [it] = await make(1, `dup${round}`);
      const results = await Promise.allSettled([data.addToCart(buyers[1].id, it.id), data.addToCart(buyers[1].id, it.id)]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason as AppError).code).toBe("ALREADY_IN_CART");
    }
  });
});

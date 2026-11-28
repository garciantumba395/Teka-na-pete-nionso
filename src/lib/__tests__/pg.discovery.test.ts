import { afterAll, describe, expect, it } from "vitest";
import { seedId as S } from "../data/ids";
import type { AppError } from "../types";
import { endTestPool, makePgEnv, TEST_URL } from "./pg-env";

const suite = TEST_URL ? describe : describe.skip;
const PHOTO = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ";

afterAll(endTestPool);

// agent H : propriétés propres à la base (concurrence et contraintes) des favoris et des suivis.
suite("PostgreSQL : favoris et suivis", () => {
  async function setup() {
    const env = await makePgEnv();
    const data = env.data;
    const signup = async (phone: string, name: string) => {
      await data.requestOtp(phone);
      return (await data.verifyOtp(phone, "123456", name)).user;
    };
    return { env, data, signup };
  }

  it("plafond de 10 marques tenu sous concurrence : des ajouts simultanés ne le dépassent jamais", async () => {
    const { data, signup, env } = await setup();
    const me = await signup("0821000501", "Suiveuse Course");
    for (let round = 0; round < 6; round++) {
      await env.pool.query(`delete from member_follows where user_id = $1`, [me.id]);
      for (let i = 0; i < 8; i++) await data.addFollow(me.id, "brand", `Base ${round} ${i}`);
      const results = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => data.addFollow(me.id, "brand", `Course ${round} ${i}`)));
      const ok = results.filter((r) => r.status === "fulfilled").length;
      const ko = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      expect(ok).toBe(2);
      expect(ko.every((r) => (r.reason as AppError).code === "FOLLOW_LIMIT")).toBe(true);
      expect((await data.getFollows(me.id)).brands).toHaveLength(10);
    }
  });

  it("deux mises en favori simultanées du même couple : une seule ligne, aucune erreur interne", async () => {
    const { data, signup, env } = await setup();
    const seller = await signup("0811000502", "Vendeur Course");
    const fan = await signup("0821000503", "Fan Course");
    const d = await data.createDraft(seller.id, { title: "Robe course", description: "", categoryId: S("cat-robes"), condition: "good", priceMinor: 2500, currency: "USD", areaId: S("area-com-gombe"), photos: [PHOTO] });
    const item = await data.publishItem(seller.id, d.id);
    const results = await Promise.all(Array.from({ length: 8 }, () => data.addFavourite(fan.id, item.id)));
    expect(results.every((r) => r.favouriteCount === 1)).toBe(true);
    expect((await env.pool.query(`select count(*)::int as n from favourites where item_id = $1`, [item.id])).rows[0].n).toBe(1);
  });

  it("contrainte d'unicité des suivis et RLS de la table", async () => {
    const { signup, env } = await setup();
    const me = await signup("0821000504", "Suiveuse Contrainte");
    await env.pool.query(`insert into member_follows (user_id, kind, value_key, label) values ($1, 'brand', 'nike', 'Nike')`, [me.id]);
    await expect(env.pool.query(`insert into member_follows (user_id, kind, value_key, label) values ($1, 'brand', 'nike', 'NIKE')`, [me.id])).rejects.toMatchObject({ code: "23505" });
    await expect(env.pool.query(`insert into member_follows (user_id, kind, value_key, label) values ($1, 'color', 'rouge', 'Rouge')`, [me.id])).rejects.toMatchObject({ code: "23514" });
    const rls = await env.pool.query(`select relrowsecurity from pg_class where relname = 'member_follows'`);
    expect(rls.rows[0].relrowsecurity).toBe(true);
  });
});

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { seedId as S } from "../data/ids";
import { seedProhibitedRules } from "../data/pg/prohibited";
import { DEFAULT_RULES } from "../prohibited";
import type { AppError } from "../types";
import { endTestPool, makePgEnv, TEST_URL, type PgEnv } from "./pg-env";

const suite = TEST_URL ? describe : describe.skip;
const PHOTO = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ";
afterAll(endTestPool);

suite("PostgreSQL : table des articles interdits", () => {
  let env: PgEnv;
  beforeEach(async () => {
    env = await makePgEnv(); // TTL du cache à 0 : un changement en base est vu tout de suite
  });
  async function seller() {
    await env.data.requestOtp("0811000151");
    return (await env.data.verifyOtp("0811000151", "123456", "Vendeur Règles")).user;
  }
  const draft = (id: string, title: string) =>
    env.data.createDraft(id, { title, description: "", categoryId: S("cat-robes"), condition: "good", priceMinor: 2500, currency: "USD", areaId: null, photos: [PHOTO] });
  const publishCode = async (id: string, itemId: string) => {
    try {
      await env.data.publishItem(id, itemId);
      return "ok";
    } catch (e) {
      return (e as AppError).code;
    }
  };

  it("la donnée de référence insère le jeu par défaut, une seule fois, sans écraser les modifications", async () => {
    const n = (await env.pool.query("select count(*)::int as n from prohibited_rules")).rows[0].n;
    expect(n).toBe(DEFAULT_RULES.length);
    await env.pool.query("update prohibited_rules set message = 'Message modifié par l''équipe.' where id = 'drogues'");
    await seedProhibitedRules(env.pool);
    expect((await env.pool.query("select count(*)::int as n from prohibited_rules")).rows[0].n).toBe(DEFAULT_RULES.length);
    expect((await env.pool.query("select message from prohibited_rules where id = 'drogues'")).rows[0].message).toBe("Message modifié par l'équipe.");
  });

  it("une règle ajoutée, désactivée ou modifiée en base s'applique sans redéployer", async () => {
    const u = await seller();
    await env.pool.query("insert into prohibited_rules (id, label, message, keywords, sort_order) values ('test-regle', 'Règle de test', 'Cet article de test est refusé.', '{brouette magique}', 99)");
    const d = await draft(u.id, "Brouette magique à vendre");
    const e = await env.data.publishItem(u.id, d.id).catch((x: AppError) => x);
    expect((e as AppError).code).toBe("PROHIBITED_ITEM");
    expect((e as AppError).message).toBe("Cet article de test est refusé.");
    expect((await env.data.listProhibitedRules()).some((r) => r.id === "test-regle")).toBe(true);
    await env.pool.query("update prohibited_rules set active = false where id = 'test-regle'");
    expect(await publishCode(u.id, d.id)).toBe("ok");
  });

  it("une table vide retombe sur le jeu par défaut du code (jamais d'absence de contrôle)", async () => {
    const u = await seller();
    await env.pool.query("delete from prohibited_rules");
    expect((await env.data.listProhibitedRules()).length).toBe(DEFAULT_RULES.length);
    const d = await draft(u.id, "Vends pistolet");
    expect(await publishCode(u.id, d.id)).toBe("PROHIBITED_ITEM");
  });

  it("la table est protégée comme les autres : RLS activée, rien pour les rôles d'API publique", async () => {
    const r = await env.pool.query("select relrowsecurity from pg_class where relname = 'prohibited_rules'");
    expect(r.rows[0].relrowsecurity).toBe(true);
  });
});

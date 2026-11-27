import { compileRules, DEFAULT_RULES, type CompiledRules, type ProhibitedRule } from "../../prohibited";
import type { Pool } from "./pool";

/** Lecture des règles d'articles interdits avec un cache court : on les modifie en base, sans redéployer (comme settings.ts). */
export function createProhibitedLoader(pool: Pool, now: () => number, ttlMs = 30_000) {
  let cache: { at: number; rules: CompiledRules; list: ProhibitedRule[] } | null = null;
  async function load() {
    const t = now();
    if (cache && t - cache.at < ttlMs) return cache;
    const r = await pool.query<{ id: string; label: string; message: string; keywords: string[]; except_phrases: string[] }>(
      "select id, label, message, keywords, except_phrases from prohibited_rules where active order by sort_order, id",
    );
    // Table vide : on retombe sur le jeu par défaut du code plutôt que de ne rien contrôler.
    const list: ProhibitedRule[] = r.rows.length
      ? r.rows.map((x) => ({ id: x.id, label: x.label, message: x.message, keywords: x.keywords, except: x.except_phrases }))
      : DEFAULT_RULES;
    cache = { at: t, rules: compileRules(list), list };
    return cache;
  }
  return {
    compiled: async () => (await load()).rules,
    list: async () => (await load()).list,
  };
}

/** Insère le jeu de règles par défaut. Idempotent : ne touche jamais à une règle déjà en base (les modifications de l'équipe sont conservées). */
export async function seedProhibitedRules(pool: Pool): Promise<void> {
  let order = 0;
  for (const r of DEFAULT_RULES) {
    await pool.query(
      `insert into prohibited_rules (id, label, message, keywords, except_phrases, sort_order) values ($1,$2,$3,$4,$5,$6) on conflict (id) do nothing`,
      [r.id, r.label, r.message, r.keywords, r.except ?? [], order++],
    );
  }
}

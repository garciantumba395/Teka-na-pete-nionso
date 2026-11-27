import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Pool } from "./pool";

const LOCK_KEY = 727274;

/**
 * Applique les migrations SQL de `dir` dans l'ordre alphabétique, chacune dans sa transaction.
 * - un verrou consultatif empêche deux exécutions simultanées ;
 * - la somme de contrôle de chaque fichier appliqué est conservée : modifier après coup une migration déjà
 *   appliquée est une erreur (on écrit une nouvelle migration, on n'édite pas l'ancienne).
 * À lancer avec une connexion DIRECTE (pas le pooler en mode transaction).
 */
export async function applyMigrations(pool: Pool, dir: string, log: (m: string) => void = () => undefined): Promise<string[]> {
  const applied: string[] = [];
  const c = await pool.connect();
  try {
    await c.query("select pg_advisory_lock($1)", [LOCK_KEY]);
    await c.query(
      "create table if not exists schema_migrations (name text primary key, checksum text not null, applied_at timestamptz not null default now())",
    );
    const done = new Map<string, string>((await c.query("select name, checksum from schema_migrations")).rows.map((r) => [r.name, r.checksum]));
    const files = readdirSync(dir).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
    for (const f of files) {
      const sql = readFileSync(join(dir, f), "utf8");
      const sum = createHash("sha256").update(sql).digest("hex");
      const prev = done.get(f);
      if (prev) {
        if (prev !== sum) throw new Error(`La migration ${f} a été modifiée après avoir été appliquée. Crée une nouvelle migration.`);
        continue;
      }
      try {
        await c.query("begin");
        await c.query(sql);
        await c.query("insert into schema_migrations (name, checksum) values ($1, $2)", [f, sum]);
        await c.query("commit");
      } catch (e) {
        await c.query("rollback").catch(() => undefined);
        throw new Error(`Échec de la migration ${f} : ${(e as Error).message}`);
      }
      applied.push(f);
      log(`migration appliquée : ${f}`);
    }
  } finally {
    await c.query("select pg_advisory_unlock($1)", [LOCK_KEY]).catch(() => undefined);
    c.release();
  }
  return applied;
}

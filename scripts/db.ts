/* Commandes base de données.
 *   npm run db:migrate        applique les migrations (db/migrations)
 *   npm run db:seed           charge les données de référence (zones, catégories, paramètres)
 *   npm run db:seed-demo      charge de FAUSSES données de démonstration (refusé en production)
 *   npm run db:status         liste les migrations appliquées
 * DATABASE_URL doit pointer vers une connexion DIRECTE à PostgreSQL (pas le pooler en mode transaction).
 */
import { join } from "node:path";
import { createPool } from "../src/lib/data/pg/pool";
import { applyMigrations } from "../src/lib/data/pg/migrate";
import { seedDemo, seedReference } from "../src/lib/data/pg/seed";

async function main() {
  const cmd = process.argv[2];
  const pool = createPool();
  try {
    if (cmd === "migrate") {
      const done = await applyMigrations(pool, join(__dirname, "..", "db", "migrations"), console.log);
      console.log(done.length ? `${done.length} migration(s) appliquée(s).` : "Base déjà à jour.");
    } else if (cmd === "seed") {
      await seedReference(pool);
      console.log("Données de référence chargées.");
    } else if (cmd === "seed-demo") {
      await seedReference(pool);
      await seedDemo(pool);
      console.log("Données de démonstration chargées.");
    } else if (cmd === "status") {
      const r = await pool.query("select name, applied_at from schema_migrations order by name");
      for (const row of r.rows) console.log(`${row.name}  ${row.applied_at.toISOString()}`);
    } else {
      console.error("Commande inconnue. Utilise : migrate | seed | seed-demo | status");
      process.exitCode = 2;
    }
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

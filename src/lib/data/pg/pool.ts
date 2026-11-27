import pg from "pg";

// bigint (montants en unités mineures, toujours < 2^53) et numeric (coordonnées) reviennent en nombres, pas en chaînes.
pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1700, (v) => parseFloat(v));

export type Pool = pg.Pool;
export type Client = pg.PoolClient;
export type Queryable = pg.Pool | pg.PoolClient;

export function createPool(url: string | undefined = process.env.DATABASE_URL): Pool {
  if (!url) throw new Error("DATABASE_URL manquante : voir .env.example.");
  const ca = process.env.DATABASE_CA_CERT;
  return new pg.Pool({
    connectionString: url,
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    // Certificat de l'hébergeur fourni explicitement : vérification complète, jamais « rejectUnauthorized: false ».
    ssl: ca ? { ca, rejectUnauthorized: true } : undefined,
  });
}

/** Transaction : COMMIT si la fonction réussit, ROLLBACK si elle lève. */
export async function withTx<T>(pool: Pool, fn: (c: Client) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("begin");
    const r = await fn(c);
    await c.query("commit");
    return r;
  } catch (e) {
    await c.query("rollback").catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}

/** Code SQLSTATE d'une erreur PostgreSQL (ex. 23505 = violation d'unicité). */
export function pgCode(e: unknown): string | undefined {
  return typeof e === "object" && e !== null && "code" in e ? String((e as { code: unknown }).code) : undefined;
}

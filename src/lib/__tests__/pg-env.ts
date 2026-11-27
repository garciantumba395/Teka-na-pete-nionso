import { join } from "node:path";
import { createPgData, type PgOptions } from "../data/pg/data";
import { applyMigrations } from "../data/pg/migrate";
import { createPool, type Pool } from "../data/pg/pool";
import { seedDemo, seedReference } from "../data/pg/seed";
import { FakeMobileMoneyProvider } from "../payments/fake-provider";
import { ConsoleSmsProvider } from "../sms/provider";
import type { LedgerEntry } from "../types";
import type { ContractEnv } from "./contract";

process.env.SMS_CONSOLE_QUIET = "1";

/** Base PostgreSQL de TEST : jamais DATABASE_URL (qui peut pointer ailleurs), toujours DATABASE_URL_TEST. */
export const TEST_URL = process.env.DATABASE_URL_TEST;
export const MIGRATIONS = join(__dirname, "..", "..", "..", "db", "migrations");

let pool: Pool | null = null;
export async function testPool(): Promise<Pool> {
  if (!TEST_URL) throw new Error("DATABASE_URL_TEST manquante");
  if (!pool) {
    pool = createPool(TEST_URL);
    await applyMigrations(pool, MIGRATIONS);
  }
  return pool;
}
export async function endTestPool() {
  await pool?.end();
  pool = null;
}

/** Vide toutes les tables du domaine puis recharge les données de référence et de démonstration. */
export async function resetDb(p: Pool, t0: number) {
  const tables = (await p.query(`select tablename from pg_tables where schemaname = 'public' and tablename <> 'schema_migrations'`)).rows.map((r) => `"${r.tablename}"`);
  await p.query(`truncate table ${tables.join(", ")} restart identity cascade`);
  await seedReference(p);
  await seedDemo(p, t0);
}

export interface PgEnv extends ContractEnv {
  pool: Pool;
  provider: FakeMobileMoneyProvider;
  sms: ConsoleSmsProvider;
  data: ReturnType<typeof createPgData>;
}

export async function makePgEnv(overrides: Partial<PgOptions> = {}): Promise<PgEnv> {
  const p = await testPool();
  let t = 1_700_000_000_000;
  await resetDb(p, t);
  const provider = new FakeMobileMoneyProvider();
  const sms = new ConsoleSmsProvider();
  const data = createPgData(p, { now: () => t, autoComplete: false, otpCode: "123456", provider, sms, settingsTtlMs: 0, ...overrides });
  return {
    pool: p, provider, sms, data,
    now: () => t,
    advance: (ms) => { t += ms; },
    ledger: async () =>
      (await p.query(`select id, txn_id, account, user_id, currency, amount_minor, ref_type, ref_id, created_at from ledger_entries`)).rows.map(
        (r): LedgerEntry => ({ id: r.id, txnId: r.txn_id, account: r.account, userId: r.user_id, currency: r.currency, amountMinor: r.amount_minor, refType: r.ref_type, refId: r.ref_id, createdAt: r.created_at.getTime() })),
    pendingEvents: async () => data.__pendingEvents(),
    flush: () => data.__flush(),
    refunds: () => provider.refunds.length,
  };
}

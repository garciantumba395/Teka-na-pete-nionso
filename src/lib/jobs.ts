import { timingSafeEqual } from "node:crypto";
import { getData } from "./data";
import { AppError } from "./types";

/**
 * Tâches planifiées, déclenchées par un ordonnanceur externe (Vercel Cron, Inngest, cron système) qui appelle
 * /api/internal/jobs/<nom> avec « Authorization: Bearer <CRON_SECRET> ».
 * Sans CRON_SECRET configuré, les routes sont FERMÉES (503) : jamais ouvertes par défaut.
 */
export const JOBS = {
  expire_unpaid_orders: async () => ({ expired: await getData().expireUnpaidOrders() }),
  refund_unhanded_orders: async () => ({ refunded: await getData().expireStalePaidOrders() }),
  reconcile_pending_payments: async () => ({ resolved: await getData().reconcilePendingPayments() }),
  purge_expired: async () => getData().purgeExpired(),
} as const;

export type JobName = keyof typeof JOBS;

export function authorizeJob(authorization: string | null, secret: string | undefined = process.env.CRON_SECRET): void {
  if (!secret) throw new AppError("JOBS_DISABLED", "Les tâches planifiées ne sont pas configurées (CRON_SECRET manquant).", 503);
  const given = Buffer.from((authorization ?? "").replace(/^Bearer /i, ""));
  const expected = Buffer.from(secret);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new AppError("UNAUTHORIZED", "Accès refusé.", 401);
}

export async function runJob(name: string): Promise<unknown> {
  if (name === "all") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(JOBS) as JobName[]) out[k] = await JOBS[k]();
    return out;
  }
  if (!(name in JOBS)) throw new AppError("NOT_FOUND", "Tâche inconnue.", 404);
  return JOBS[name as JobName]();
}

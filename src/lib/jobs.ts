import { timingSafeEqual } from "node:crypto";
import { getData } from "./data";
import { AppError } from "./types";

/**
 * Tâches planifiées, déclenchées par un ordonnanceur externe (Vercel Cron, Inngest, cron système) qui appelle
 * /api/internal/jobs/<nom> avec « Authorization: Bearer <CRON_SECRET> ».
 * Sans CRON_SECRET configuré, les routes sont FERMÉES (503) : jamais ouvertes par défaut.
 */
export interface JobOptions {
  /** Horloge simulée (ms). Réservée aux tests : refusée en production (voir resolveAsOf). */
  at?: number;
}

export const JOBS = {
  expire_unpaid_orders: async () => ({ expired: await getData().expireUnpaidOrders() }),
  refund_unhanded_orders: async () => ({ refunded: await getData().expireStalePaidOrders() }),
  reconcile_pending_payments: async () => ({ resolved: await getData().reconcilePendingPayments() }),
  purge_expired: async () => getData().purgeExpired(),
  // ---- agent D : livraison par coursier
  /** Libère au vendeur les commandes livrées dont la fenêtre de réclamation est close et sans litige. */
  release_delivered_orders: async (o?: JobOptions) => ({ released: await getData().releaseDeliveredOrders(o) }),
  /** Rembourse les colis restés « remis au coursier » trop longtemps sans livraison. */
  refund_stale_courier_orders: async (o?: JobOptions) => ({ refunded: await getData().refundStaleCourierOrders(o) }),
  /** Supprime les notifications lues depuis plus de 90 jours (quotidienne). */
  purge_old_notifications: async () => ({ purged: await getData().purgeOldNotifications() }),
} as const;

/** Lit le paramètre de test `asOf` (millisecondes). Jamais accepté en production : on ne triche pas avec l'horloge des délais d'argent. */
export function resolveAsOf(raw: string | null, env: string | undefined = process.env.NODE_ENV): JobOptions | undefined {
  if (raw === null || raw === "") return undefined;
  if (env === "production") throw new AppError("BAD_REQUEST", "Paramètre non pris en charge.", 400);
  const at = Number(raw);
  if (!Number.isFinite(at) || at <= 0) throw new AppError("BAD_REQUEST", "Paramètre invalide.", 400);
  return { at };
}

export type JobName = keyof typeof JOBS;

export function authorizeJob(authorization: string | null, secret: string | undefined = process.env.CRON_SECRET): void {
  if (!secret) throw new AppError("JOBS_DISABLED", "Les tâches planifiées ne sont pas configurées (CRON_SECRET manquant).", 503);
  const given = Buffer.from((authorization ?? "").replace(/^Bearer /i, ""));
  const expected = Buffer.from(secret);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new AppError("UNAUTHORIZED", "Accès refusé.", 401);
}

export async function runJob(name: string, opts?: JobOptions): Promise<unknown> {
  if (name === "all") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(JOBS) as JobName[]) out[k] = await JOBS[k](opts);
    return out;
  }
  if (!(name in JOBS)) throw new AppError("NOT_FOUND", "Tâche inconnue.", 404);
  return JOBS[name as JobName](opts);
}

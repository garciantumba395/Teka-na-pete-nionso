import { FEES, type FeeConfig } from "../../fees";
import type { Currency } from "../../types";
import type { Pool } from "./pool";

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;
const money = (v: unknown, base: Record<Currency, number>): Record<Currency, number> => {
  const o = (v ?? {}) as Record<string, unknown>;
  return { USD: isNum(o.USD) ? o.USD : base.USD, CDF: isNum(o.CDF) ? o.CDF : base.CDF };
};

/** Construit la configuration depuis la table `settings`. Une valeur absente ou invalide garde sa valeur par défaut. */
export function feesFromSettings(rows: { key: string; value: unknown }[]): FeeConfig {
  const m = new Map(rows.map((r) => [r.key, r.value] as const));
  const bp = (m.get("buyer_protection") ?? {}) as Record<string, unknown>;
  const pf = (m.get("payout_fee") ?? {}) as Record<string, unknown>;
  const sg = (m.get("shipping_grid") ?? {}) as Record<string, unknown>;
  const num = (k: string, d: number) => (isNum(m.get(k)) ? (m.get(k) as number) : d);
  return {
    buyerProtection: {
      pctBps: isNum(bp.pct_bps) ? bp.pct_bps : FEES.buyerProtection.pctBps,
      fixedMinor: money(bp.fixed_minor, FEES.buyerProtection.fixedMinor),
    },
    payout: { pctBps: isNum(pf.pct_bps) ? pf.pct_bps : FEES.payout.pctBps, minMinor: money(pf.min_minor, FEES.payout.minMinor) },
    maxItemValueUsdMinor: num("max_item_value_usd_minor", FEES.maxItemValueUsdMinor),
    orderPaymentTtlMs: num("order_payment_ttl_minutes", FEES.orderPaymentTtlMs / 60_000) * 60_000,
    handoverMaxAttempts: num("handover_max_attempts", FEES.handoverMaxAttempts),
    handoverLockMs: num("handover_lock_minutes", FEES.handoverLockMs / 60_000) * 60_000,
    maxPhotos: num("max_photos", FEES.maxPhotos),
    claimWindowMs: num("claim_window_hours", FEES.claimWindowMs / 3_600_000) * 3_600_000,
    unhandedOrderMs: num("unhanded_order_days", FEES.unhandedOrderMs / 86_400_000) * 86_400_000,
    shippingGrid: {
      sameCommune: money(sg.sameCommune, FEES.shippingGrid.sameCommune),
      sameCity: money(sg.sameCity, FEES.shippingGrid.sameCity),
      otherCity: money(sg.otherCity, FEES.shippingGrid.otherCity),
    },
    courierStaleMs: num("courier_stale_days", FEES.courierStaleMs / 86_400_000) * 86_400_000,
  };
}

/** Lecture des paramètres avec un cache court : les frais se changent en base, sans redéployer. */
export function createSettingsLoader(pool: Pool, now: () => number, ttlMs = 30_000) {
  let cache: { at: number; cfg: FeeConfig } | null = null;
  return async function get(): Promise<FeeConfig> {
    const t = now();
    if (cache && t - cache.at < ttlMs) return cache.cfg;
    const r = await pool.query<{ key: string; value: unknown }>("select key, value from settings");
    cache = { at: t, cfg: feesFromSettings(r.rows) };
    return cache.cfg;
  };
}

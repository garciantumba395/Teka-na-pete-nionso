import type { Currency } from "./types";

export interface FeeConfig {
  buyerProtection: { pctBps: number; fixedMinor: Record<Currency, number> };
  payout: { pctBps: number; minMinor: Record<Currency, number> };
  maxItemValueUsdMinor: number;
  orderPaymentTtlMs: number;
  handoverMaxAttempts: number;
  handoverLockMs: number;
  maxPhotos: number;
  claimWindowMs: number;
  /** Commande payée mais jamais remise : au-delà, remboursement automatique de l'acheteur. */
  unhandedOrderMs: number;
}

// VALEURS PAR DÉFAUT = PLACEHOLDERS : elles ne viennent PAS de Vinted (non lues) et ne sont pas décidées.
// Avec la couche PostgreSQL, la table `settings` fait foi et surcharge ces valeurs (voir data/pg/settings.ts).
export const FEES: FeeConfig = {
  buyerProtection: { pctBps: 500, fixedMinor: { USD: 50, CDF: 100_000 } }, // 5 %, minimum 0,50 $ / 1 000 FC
  payout: { pctBps: 100, minMinor: { USD: 500, CDF: 1_000_000 } },
  maxItemValueUsdMinor: 100_000, // 1 000 USD, plafond à décider pour la RDC
  orderPaymentTtlMs: 15 * 60 * 1000,
  handoverMaxAttempts: 5,
  handoverLockMs: 15 * 60 * 1000,
  maxPhotos: 20,
  claimWindowMs: 48 * 3600 * 1000,
  unhandedOrderMs: 7 * 86_400_000, // PLACEHOLDER : 7 jours
};

export function protectionFee(itemsMinor: number, currency: Currency, cfg: FeeConfig = FEES): number {
  const pct = Math.round((itemsMinor * cfg.buyerProtection.pctBps) / 10_000);
  return Math.max(pct, cfg.buyerProtection.fixedMinor[currency]);
}

export function payoutFee(amountMinor: number, cfg: FeeConfig = FEES): number {
  return Math.round((amountMinor * cfg.payout.pctBps) / 10_000);
}

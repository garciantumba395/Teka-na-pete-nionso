import type { Currency } from "./types";

// PLACEHOLDERS : ces valeurs ne viennent PAS de Vinted (non lues) et ne sont pas décidées.
// En production elles viennent de la table `settings` (clés buyer_protection, payout_*).
export const FEES = {
  buyerProtection: {
    pctBps: 500, // 5 %
    fixedMinor: { USD: 50, CDF: 100_000 } as Record<Currency, number>,
  },
  payout: { pctBps: 100, minMinor: { USD: 500, CDF: 1_000_000 } as Record<Currency, number> },
  maxItemValueUsdMinor: 100_000, // 1 000 USD, plafond à décider pour la RDC
  orderPaymentTtlMs: 15 * 60 * 1000,
  handoverMaxAttempts: 5,
  handoverLockMs: 15 * 60 * 1000,
  maxPhotos: 20,
  claimWindowMs: 48 * 3600 * 1000,
} as const;

export function protectionFee(itemsMinor: number, currency: Currency): number {
  const pct = Math.round((itemsMinor * FEES.buyerProtection.pctBps) / 10_000);
  return Math.max(pct, FEES.buyerProtection.fixedMinor[currency]);
}

export function payoutFee(amountMinor: number): number {
  return Math.round((amountMinor * FEES.payout.pctBps) / 10_000);
}

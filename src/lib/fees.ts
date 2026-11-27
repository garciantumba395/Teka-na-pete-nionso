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
  /** Grille de livraison par coursier, selon la distance entre la commune de l'article et celle de l'acheteur. */
  shippingGrid: Record<ShippingZone, Record<Currency, number>>;
  /** Colis resté « remis au coursier » sans livraison au-delà de ce délai : remboursement automatique. */
  courierStaleMs: number;
}

export type ShippingZone = "sameCommune" | "sameCity" | "otherCity";

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
  // PLACEHOLDERS : à fixer avec les coursiers partenaires. Montants en unités mineures (cents / centimes de franc).
  shippingGrid: {
    sameCommune: { USD: 200, CDF: 500_000 },
    sameCity: { USD: 400, CDF: 1_000_000 },
    otherCity: { USD: 1200, CDF: 3_000_000 },
  },
  courierStaleMs: 10 * 86_400_000, // PLACEHOLDER : 10 jours
};

/** Zone de tarification : même commune, même ville (même parent), ou autre ville. Origine ou destination inconnue : « même ville ». */
export function shippingZone(
  originAreaId: string | null | undefined,
  destAreaId: string | null | undefined,
  areas: { id: string; parentId: string | null }[],
): ShippingZone {
  if (!originAreaId || !destAreaId) return "sameCity";
  if (originAreaId === destAreaId) return "sameCommune";
  const parent = (id: string) => areas.find((a) => a.id === id)?.parentId ?? null;
  return parent(originAreaId) !== null && parent(originAreaId) === parent(destAreaId) ? "sameCity" : "otherCity";
}

export function shippingFee(zone: ShippingZone, currency: Currency, cfg: FeeConfig = FEES): number {
  return cfg.shippingGrid[zone][currency];
}

export function protectionFee(itemsMinor: number, currency: Currency, cfg: FeeConfig = FEES): number {
  const pct = Math.round((itemsMinor * cfg.buyerProtection.pctBps) / 10_000);
  return Math.max(pct, cfg.buyerProtection.fixedMinor[currency]);
}

export function payoutFee(amountMinor: number, cfg: FeeConfig = FEES): number {
  return Math.round((amountMinor * cfg.payout.pctBps) / 10_000);
}

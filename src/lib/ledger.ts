import type { CourierFeeMode } from "./fees";
import type { Currency, LedgerAccount, LedgerEntry } from "./types";
import { AppError } from "./types";

// Grand livre en partie double. Débit positif, crédit négatif. Somme nulle par transaction et par devise.
// Mêmes écritures que le tableau « Grand livre » de replica/architecture.md.

export type NewEntry = Omit<LedgerEntry, "id" | "createdAt">;

interface Ctx {
  txnId: string;
  currency: Currency;
  refType: LedgerEntry["refType"];
  refId: string;
}

function e(ctx: Ctx, account: LedgerAccount, amountMinor: number, userId: string | null = null, refType: LedgerEntry["refType"] = ctx.refType): NewEntry | null {
  if (amountMinor === 0) return null; // le schéma interdit les lignes à zéro
  return { txnId: ctx.txnId, account, userId, currency: ctx.currency, amountMinor, refType, refId: ctx.refId };
}

const compact = (xs: (NewEntry | null)[]): NewEntry[] => xs.filter((x): x is NewEntry => x !== null);

/** Paiement encaissé : l'argent est chez le PSP, mis de côté pour la commande. */
export function holdEntries(ctx: Ctx, totalMinor: number): NewEntry[] {
  return compact([e(ctx, "psp_clearing", totalMinor), e(ctx, "order_escrow", -totalMinor)]);
}

/**
 * Libération au vendeur : T = articles I + livraison S + frais F.
 * Mode « seller » (défaut) : S est versé au vendeur (ligne séparée, ref_type `order_shipping`), qui règle le coursier lui-même.
 * Mode « platform » : S reste sur `shipping_payable` jusqu'au règlement du coursier par la plateforme (courierSettleEntries).
 */
export function releaseEntries(
  ctx: Ctx,
  p: { sellerId: string; itemsMinor: number; shippingMinor: number; feeMinor: number; courierFeeMode?: CourierFeeMode },
): NewEntry[] {
  const total = p.itemsMinor + p.shippingMinor + p.feeMinor;
  const toSeller = (p.courierFeeMode ?? "seller") === "seller";
  return compact([
    e(ctx, "order_escrow", total),
    e(ctx, "seller_available", -p.itemsMinor, p.sellerId),
    toSeller ? e(ctx, "seller_available", -p.shippingMinor, p.sellerId, "order_shipping") : e(ctx, "shipping_payable", -p.shippingMinor),
    e(ctx, "platform_revenue", -p.feeMinor),
  ]);
}

/** Règlement du coursier par la plateforme (mode « platform ») : solde `shipping_payable` de la commande vers `courier_paid`. */
export function courierSettleEntries(ctx: Ctx, shippingMinor: number): NewEntry[] {
  return compact([e(ctx, "shipping_payable", shippingMinor), e(ctx, "courier_paid", -shippingMinor)]);
}

/** Remboursement intégral à l'acheteur. */
export function refundEntries(ctx: Ctx, totalMinor: number): NewEntry[] {
  return compact([e(ctx, "order_escrow", totalMinor), e(ctx, "psp_clearing", -totalMinor)]);
}

/** Demande de retrait de A, frais P à la charge du vendeur. */
export function payoutRequestEntries(ctx: Ctx, p: { userId: string; amountMinor: number; feeMinor: number }): NewEntry[] {
  return compact([
    e(ctx, "seller_available", p.amountMinor + p.feeMinor, p.userId),
    e(ctx, "payout_pending", -p.amountMinor, p.userId),
    e(ctx, "psp_fees", -p.feeMinor),
  ]);
}

export function payoutPaidEntries(ctx: Ctx, p: { userId: string; amountMinor: number }): NewEntry[] {
  return compact([e(ctx, "payout_pending", p.amountMinor, p.userId), e(ctx, "psp_clearing", -p.amountMinor)]);
}

/** Retrait échoué : on recrédite le vendeur (montant + frais). */
export function payoutFailedEntries(ctx: Ctx, p: { userId: string; amountMinor: number; feeMinor: number }): NewEntry[] {
  return compact([
    e(ctx, "payout_pending", p.amountMinor, p.userId),
    e(ctx, "seller_available", -(p.amountMinor + p.feeMinor), p.userId),
    e(ctx, "psp_fees", p.feeMinor),
  ]);
}

/** Lève si la transaction n'est pas équilibrée (par devise). Équivalent du trigger ledger_check_balanced. */
export function assertBalanced(entries: NewEntry[]): void {
  const sums = new Map<string, number>();
  for (const x of entries) {
    const k = `${x.txnId}|${x.currency}`;
    sums.set(k, (sums.get(k) ?? 0) + x.amountMinor);
  }
  for (const [k, s] of sums) {
    if (s !== 0) throw new AppError("LEDGER_UNBALANCED", `Transaction ${k} déséquilibrée de ${s}`, 500);
  }
}

/** Solde disponible d'un vendeur = -(somme des lignes seller_available). */
export function sellerAvailable(entries: LedgerEntry[], userId: string, currency: Currency): number {
  return -entries
    .filter((x) => x.userId === userId && x.account === "seller_available" && x.currency === currency)
    .reduce((s, x) => s + x.amountMinor, 0);
}

export function sellerPending(entries: LedgerEntry[], userId: string, currency: Currency): number {
  return -entries
    .filter((x) => x.userId === userId && x.account === "payout_pending" && x.currency === currency)
    .reduce((s, x) => s + x.amountMinor, 0);
}

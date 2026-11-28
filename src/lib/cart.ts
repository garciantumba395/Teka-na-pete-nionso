// ---- agent J : lots (panier d'un même vendeur)
// Règles COMMUNES aux deux couches de données (factice et PostgreSQL) : un seul endroit, donc le même comportement.
import { FEES, protectionFee, type FeeConfig } from "./fees";
import { toUsdMinor } from "./money";
import { AppError, type CartLine, type CartLot, type CartView, type Currency, type ItemStatus } from "./types";

export const CART_MAX_ITEMS = 20;

export interface LotItem {
  id: string;
  title: string;
  sellerId: string;
  currency: Currency;
  priceMinor: number;
  status: ItemStatus;
}

export const MIXED_CURRENCY_MESSAGE = "Choisis des articles dans la même devise.";

/**
 * Vérifie qu'un ensemble d'articles peut devenir UNE commande. Lève la première règle violée ; ne modifie rien :
 * l'appelant réserve ensuite tous les articles dans la même transaction (tout ou rien).
 *  - jamais son propre article (409), un seul vendeur (409), une seule devise (422, pas de découpe automatique : le panier
 *    propose déjà un lot par vendeur ET par devise) ;
 *  - tous les articles disponibles, sinon refus complet qui nomme ceux qui ne le sont plus (409) ;
 *  - plafond de valeur par commande appliqué au total (422).
 */
export function assertLotOrderable(buyerId: string, its: LotItem[], cfg: FeeConfig = FEES): { currency: Currency; itemsMinor: number } {
  if (its.length > CART_MAX_ITEMS) throw new AppError("VALIDATION", `Un lot compte ${CART_MAX_ITEMS} articles au plus.`, 422);
  if (its.some((i) => i.sellerId === buyerId)) throw new AppError("SELF_PURCHASE", "Tu ne peux pas acheter ton propre article.", 409);
  if (new Set(its.map((i) => i.sellerId)).size > 1) throw new AppError("MIXED_SELLERS", "Un achat groupé ne concerne qu'un seul vendeur.", 409);
  if (new Set(its.map((i) => i.currency)).size > 1) throw new AppError("MIXED_CURRENCY", MIXED_CURRENCY_MESSAGE, 422);
  const gone = its.filter((i) => i.status !== "active");
  if (gone.length) {
    const names = gone.map((i) => `« ${i.title} »`).join(", ");
    const many = gone.length > 1;
    throw new AppError(
      "ITEM_UNAVAILABLE",
      its.length === 1
        ? "Cet article n'est plus disponible."
        : `Commande impossible, ${many ? "ces articles ne sont plus disponibles" : "cet article n'est plus disponible"} : ${names}. Retire-${many ? "les" : "le"} du lot pour continuer.`,
      409,
      { itemIds: gone.map((i) => i.id).join(",") },
    );
  }
  const currency = its[0].currency;
  const itemsMinor = its.reduce((s, i) => s + i.priceMinor, 0);
  if (toUsdMinor(itemsMinor, currency) > cfg.maxItemValueUsdMinor)
    throw new AppError("ORDER_TOO_LARGE", "Le total de ce lot dépasse la valeur maximale autorisée par commande. Retire des articles ou fais deux commandes.", 422);
  return { currency, itemsMinor };
}

export interface CartRow {
  itemId: string;
  title: string;
  photo: string | null;
  priceMinor: number;
  currency: Currency;
  status: ItemStatus;
  sellerId: string;
  sellerName: string;
  addedAt: number;
}

/** Assemble la vue du panier : un lot par (vendeur, devise), frais de protection recalculés sur le total du lot. */
export function buildCartView(rows: CartRow[], cfg: FeeConfig = FEES): CartView {
  const groups = new Map<string, CartRow[]>();
  for (const r of rows) {
    const k = `${r.sellerId}|${r.currency}`;
    const g = groups.get(k) ?? [];
    g.push(r);
    groups.set(k, g);
  }
  const lots: CartLot[] = [...groups.values()].map((g) => {
    const sorted = [...g].sort((a, b) => a.addedAt - b.addedAt || (a.itemId < b.itemId ? -1 : 1));
    const lines: CartLine[] = sorted.map((r) => ({
      itemId: r.itemId, title: r.title, photo: r.photo, priceMinor: r.priceMinor, currency: r.currency, addedAt: r.addedAt,
      available: r.status === "active",
      reason: r.status === "active" ? null : r.status === "reserved" ? "reserved" : r.status === "sold" ? "sold" : "unavailable",
    }));
    const ok = lines.filter((l) => l.available);
    const currency = g[0].currency;
    const itemsMinor = ok.reduce((s, l) => s + l.priceMinor, 0);
    const fee = ok.length ? protectionFee(itemsMinor, currency, cfg) : 0;
    const ids = ok.map((l) => l.itemId).sort(); // l'article de référence du devis est le premier par identifiant, comme à la commande
    return {
      sellerId: g[0].sellerId, sellerName: g[0].sellerName, currency, lines,
      itemsMinor, protectionFeeMinor: fee, totalMinor: itemsMinor + fee,
      orderableItemIds: ids, quoteItemId: ids[0] ?? null,
      overLimit: ok.length > 0 && toUsdMinor(itemsMinor, currency) > cfg.maxItemValueUsdMinor,
    };
  });
  lots.sort((a, b) => a.sellerName.localeCompare(b.sellerName, "fr") || a.sellerId.localeCompare(b.sellerId) || a.currency.localeCompare(b.currency));
  return { count: rows.length, lots };
}
// ---- fin agent J

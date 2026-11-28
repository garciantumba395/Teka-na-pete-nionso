// ---- agent H : découverte (favoris, tri de la recherche, marques et tailles suivies)
// Règles partagées par les deux couches de données, les routes et les écrans.
import { AppError } from "./types";
import { cleanLine } from "./text";

export const ITEM_SORTS = ["recent", "price_asc", "price_desc", "favourites"] as const;
export type ItemSort = (typeof ITEM_SORTS)[number];

export const ITEM_SORT_LABEL: Record<ItemSort, string> = {
  recent: "Plus récent",
  price_asc: "Prix croissant",
  price_desc: "Prix décroissant",
  favourites: "Les plus aimés",
};

/** Valeur de tri reçue d'une URL ou d'un corps de requête : une valeur inconnue est ignorée (undefined = tri par défaut). */
export function parseItemSort(raw: unknown): ItemSort | undefined {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return typeof v === "string" && (ITEM_SORTS as readonly string[]).includes(v) ? (v as ItemSort) : undefined;
}

export type FollowKind = "brand" | "size";
export const FOLLOW_KINDS: readonly FollowKind[] = ["brand", "size"];
export const FOLLOW_MAX = 10; // par type (10 marques, 10 tailles)
export const FOLLOW_VALUE_MAX: Record<FollowKind, number> = { brand: 40, size: 20 };
export const FOLLOW_KIND_LABEL: Record<FollowKind, { one: string; many: string }> = {
  brand: { one: "marque", many: "marques" },
  size: { one: "taille", many: "tailles" },
};
export const FOR_YOU_MAX = 12;

export interface Follows {
  brands: string[];
  sizes: string[];
}

/** Clé de comparaison : sans accent, sans casse, espaces réduits. Même règle côté base (unaccent + lower). */
export function followKey(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/\s+/g, " ").trim();
}

/**
 * Clé de tri d'un prix comparable entre USD et CDF, SANS arrondi : en centimes de FC (1 USD = `usdCdf` FC).
 * Même taux que le filtre de prix (money.ts), mais exacte : deux prix distincts ne sont jamais à égalité.
 */
export function priceSortKey(priceMinor: number, currency: "USD" | "CDF", usdCdf: number): number {
  return currency === "USD" ? priceMinor * usdCdf : priceMinor;
}

/** Libellé d'une marque ou d'une taille à suivre : nettoyé côté serveur, espaces réduits, 422 si vide ou trop long. */
export function cleanFollowValue(kind: FollowKind, raw: unknown): string {
  const label = cleanLine(typeof raw === "string" ? raw : "").replace(/\s+/g, " ").trim();
  const what = FOLLOW_KIND_LABEL[kind].one;
  if (!label) throw new AppError("VALIDATION", `Écris une ${what}.`, 422, { value: `Écris une ${what}.` });
  if (label.length > FOLLOW_VALUE_MAX[kind])
    throw new AppError("VALIDATION", `Une ${what} est limitée à ${FOLLOW_VALUE_MAX[kind]} caractères.`, 422, { value: `Maximum ${FOLLOW_VALUE_MAX[kind]} caractères.` });
  return label;
}

export function followLimitError(kind: FollowKind): AppError {
  const many = FOLLOW_KIND_LABEL[kind].many;
  return new AppError("FOLLOW_LIMIT", `Tu peux suivre ${FOLLOW_MAX} ${many} au maximum. Retire-en une avant d'en ajouter.`, 422, { value: `Maximum ${FOLLOW_MAX} ${many}.` });
}

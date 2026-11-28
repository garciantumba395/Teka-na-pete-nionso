import type { Currency } from "./types";

// Convention : les montants sont des entiers en unités mineures ISO 4217 (USD : cents, CDF : centimes).
// Le CDF s'affiche en francs entiers. Les prix saisis par les membres sont donc des multiples de 100 centimes.

const NBSP = " ";

function groupThousands(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
}

/**
 * Montant lisible. Français, lingala et swahili : usage congolais (virgule décimale, espace insécable entre les milliers, « 26,25 $ »).
 * Anglais : « $26.25 » et « FC 35,000 ». `locale` vaut « fr » par défaut : les appelants qui ne le passent pas gardent le comportement d'avant.
 */
export function formatMoney(minor: number, currency: Currency, locale: "fr" | "en" | "ln" | "sw" = "fr"): string {
  const en = locale === "en";
  const group = (n: number) => (en ? String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",") : groupThousands(n));
  if (currency === "CDF") {
    const v = group(Math.round(minor / 100));
    return en ? `FC${NBSP}${v}` : `${v}${NBSP}FC`;
  }
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / 100);
  const cents = abs % 100;
  const dec = en ? "." : ",";
  const body = cents === 0 ? `${group(whole)}` : `${group(whole)}${dec}${String(cents).padStart(2, "0")}`;
  return en ? `${sign}$${body}` : `${sign}${body}${NBSP}$`;
}

/** Parse une saisie utilisateur (« 12,5 », « 35 000 ») en unités mineures. Retourne null si invalide. */
export function parseMoneyInput(raw: string, currency: Currency): number | null {
  const cleaned = raw.replace(/[\s  ]/g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value <= 0) return null;
  if (currency === "CDF" && !Number.isInteger(value)) return null;
  return Math.round(value * 100);
}

/** Taux USD -> CDF. PLACEHOLDER : à remplacer par la tâche refresh_exchange_rates (table exchange_rates). */
export const USD_CDF_PLACEHOLDER = 2800;

export function toUsdMinor(minor: number, currency: Currency): number {
  return currency === "USD" ? minor : Math.round(minor / USD_CDF_PLACEHOLDER);
}

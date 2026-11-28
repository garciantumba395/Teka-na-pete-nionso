// Langues de l'application. Le français est la langue de référence : toute clé existe d'abord en français.
export const LOCALES = ["fr", "en", "ln", "sw"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "fr";
export const LOCALE_COOKIE = "lang";

/** Nom de chaque langue DANS cette langue (jamais traduit). */
export const LOCALE_NAMES: Record<Locale, string> = { fr: "Français", en: "English", ln: "Lingála", sw: "Kiswahili" };

/**
 * « reviewed » : relu par un locuteur. « beta » : écrit sans relecture native, affiché avec la mention « bêta » ;
 * le français ou l'anglais restent la valeur de repli pour toute clé absente. Passer à « reviewed » seulement après relecture.
 */
export const LOCALE_STATUS: Record<Locale, "reviewed" | "beta"> = { fr: "reviewed", en: "reviewed", ln: "beta", sw: "beta" };

/** Code BCP 47 pour Intl (dates, nombres) : le lingala n'a pas de données Intl complètes partout, on retombe sur le français. */
export const INTL_LOCALE: Record<Locale, string> = { fr: "fr-CD", en: "en-GB", ln: "fr-CD", sw: "sw-CD" };

/** Valeur sûre issue d'une entrée non fiable (cookie, en-tête, API). */
export function asLocale(v: unknown): Locale | null {
  return typeof v === "string" && (LOCALES as readonly string[]).includes(v) ? (v as Locale) : null;
}

/** Meilleure langue d'un en-tête Accept-Language parmi celles prises en charge ; null si aucune. */
export function fromAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null;
  const wanted = header
    .split(",")
    .map((p) => {
      const [tag, ...params] = p.trim().split(";");
      const q = Number(params.find((x) => x.trim().startsWith("q="))?.split("=")[1] ?? 1);
      return { base: tag.trim().toLowerCase().split("-")[0], q: Number.isFinite(q) ? q : 0 };
    })
    .filter((x) => x.base && x.q > 0)
    .sort((a, b) => b.q - a.q);
  for (const w of wanted) {
    const l = asLocale(w.base);
    if (l) return l;
  }
  return null;
}

import { DEFAULT_LOCALE, INTL_LOCALE, type Locale } from "./config";

// Traducteur pur (aucune dépendance Next) : utilisable côté serveur, côté client et dans les tests.

export type Vars = Record<string, string | number>;
export type Dict = Record<string, string>;
export type Translator = (key: string, vars?: Vars) => string;

/** Remplace {nom} par la valeur ; une variable absente laisse le marqueur visible (plus facile à repérer qu'un trou). */
export function interpolate(text: string, vars?: Vars): string {
  if (!vars) return text;
  return text.replace(/\{([a-zA-Z0-9_]+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/**
 * Crée un traducteur. `dict` contient des clés complètes « espace.clé ».
 * Pluriel : si `vars.count` est un nombre, on cherche d'abord « clé_one » / « clé_other » (catégories Intl.PluralRules),
 * puis « clé » seule. Clé absente : repli sur `fallback` (le français), puis sur la clé elle-même (visible, jamais une erreur).
 */
export function createTranslator(locale: Locale, dict: Dict, fallback: Dict = {}): Translator {
  const rules = new Intl.PluralRules(INTL_LOCALE[locale]);
  return (key, vars) => {
    let k = key;
    if (vars && typeof vars.count === "number") {
      const cat = rules.select(vars.count);
      const plural = `${key}_${cat}`;
      if (plural in dict) k = plural;
      else if (`${key}_other` in dict && !(key in dict)) k = `${key}_other`;
      else if (!(key in dict)) {
        const fbPlural = `${key}_${new Intl.PluralRules(INTL_LOCALE[DEFAULT_LOCALE]).select(vars.count)}`;
        if (fbPlural in fallback) return interpolate(fallback[fbPlural], vars);
      }
    }
    const text = dict[k] ?? fallback[k] ?? fallback[`${key}_other`] ?? key;
    return interpolate(text, vars);
  };
}

"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { Locale } from "./config";
import { createTranslator, type Dict, type Translator } from "./translate";

interface Ctx {
  locale: Locale;
  t: Translator;
}

const I18nContext = createContext<Ctx>({ locale: "fr", t: (k) => k });

/** Reçoit la langue et le dictionnaire (espaces « client » seulement) calculés côté serveur : le rendu serveur et l'hydratation sont identiques. */
export function I18nProvider({ locale, dict, children }: { locale: Locale; dict: Dict; children: ReactNode }) {
  const value = useMemo<Ctx>(() => ({ locale, t: createTranslator(locale, dict) }), [locale, dict]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** Dans un composant client : `const { t, locale } = useI18n();` puis `t` avec une clé « espace.clé ». */
export function useI18n(): Ctx {
  return useContext(I18nContext);
}

import type { Locale } from "../i18n/config";
import type { Category } from "./types";

/** Nom d'une catégorie dans la langue demandée ; français si la traduction manque. À utiliser partout où une catégorie est affichée. */
export function categoryLabel(c: Pick<Category, "name" | "names">, locale: Locale): string {
  if (locale === "fr") return c.name;
  return c.names?.[locale] ?? c.name;
}

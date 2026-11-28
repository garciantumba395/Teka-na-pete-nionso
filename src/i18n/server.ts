import { cookies, headers } from "next/headers";
import { translatorFor } from "./catalog";
import { asLocale, DEFAULT_LOCALE, fromAcceptLanguage, LOCALE_COOKIE, type Locale } from "./config";
import type { Translator } from "./translate";

/**
 * Langue de la requête, par ordre de priorité : cookie (choix explicite) > langue enregistrée du membre > en-tête du navigateur > français.
 * `memberLang` : valeur déjà lue par l'appelant (évite de relire la session).
 */
export async function getLocale(memberLang?: string | null): Promise<Locale> {
  const c = asLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  if (c) return c;
  const m = asLocale(memberLang);
  if (m) return m;
  return fromAcceptLanguage((await headers()).get("accept-language")) ?? DEFAULT_LOCALE;
}

/** Traducteur du composant serveur courant. */
export async function getT(memberLang?: string | null): Promise<{ t: Translator; locale: Locale }> {
  const locale = await getLocale(memberLang);
  return { t: translatorFor(locale), locale };
}

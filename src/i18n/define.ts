import type { Locale } from "./config";

/**
 * Un espace de noms = un fichier `src/i18n/ns/<nom>.ts`. Les clés sont écrites SANS le préfixe ;
 * la clé complète est « <nom>.<clé> ».
 *  - `client: true`  : envoyé au navigateur (pour les composants client) ; garder petit.
 *  - `client: false` : reste sur le serveur.
 * Le français est obligatoire et complet ; en aussi (un test le vérifie) ; ln et sw peuvent être partiels (repli sur le français).
 */
export interface Namespace {
  name: string;
  client: boolean;
  fr: Record<string, string>;
  en: Record<string, string>;
  ln: Record<string, string>;
  sw: Record<string, string>;
}

export function defineNamespace<T extends Namespace>(ns: T): T {
  return ns;
}

export type NamespaceLang = Locale;

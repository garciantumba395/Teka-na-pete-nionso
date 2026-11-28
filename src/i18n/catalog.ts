import { DEFAULT_LOCALE, type Locale } from "./config";
import type { Dict, Translator } from "./translate";
import { createTranslator } from "./translate";
import type { Namespace } from "./define";
import common from "./ns/common";
import shell from "./ns/shell";
import ui from "./ns/ui";
import auth from "./ns/auth";
import account from "./ns/account";
import legal from "./ns/legal";
import catalog from "./ns/catalog";
import sell from "./ns/sell";
import cart from "./ns/cart";
import orders from "./ns/orders";
import pay from "./ns/pay";
import wallet from "./ns/wallet";
import courier from "./ns/courier";
import messages from "./ns/messages";
import notifications from "./ns/notifications";
import notifytexts from "./ns/notifytexts";
import disputes from "./ns/disputes";
import reviews from "./ns/reviews";
import reports from "./ns/reports";
import staff from "./ns/staff";
import errors from "./ns/errors";
import validation from "./ns/validation";
import prohibited from "./ns/prohibited";
import misc_k from "./ns/misc_k";
import misc_l from "./ns/misc_l";
import misc_m from "./ns/misc_m";
import misc_n from "./ns/misc_n";
import misc_o from "./ns/misc_o";

/** Tous les espaces de noms. Un nouvel espace s'ajoute ICI (une ligne d'import + une entrée). */
export const NAMESPACES: Namespace[] = [common, shell, ui, auth, account, legal, catalog, sell, cart, orders, pay, wallet, courier, messages, notifications, notifytexts, disputes, reviews, reports, staff, errors, validation, prohibited, misc_k, misc_l, misc_m, misc_n, misc_o];

type Flat = Record<string, string>;
const cache = new Map<string, Flat>();

/** Dictionnaire plat « espace.clé » -> texte pour une langue, `clientOnly` : seulement les espaces envoyés au navigateur. */
export function flatten(locale: Locale, clientOnly = false): Flat {
  const id = `${locale}:${clientOnly ? "c" : "a"}`;
  const hit = cache.get(id);
  if (hit) return hit;
  const out: Flat = {};
  for (const ns of NAMESPACES) {
    if (clientOnly && !ns.client) continue;
    for (const [k, v] of Object.entries(ns[locale])) out[`${ns.name}.${k}`] = v;
  }
  cache.set(id, out);
  return out;
}

/** Traducteur serveur : langue demandée, repli sur le français. */
export function translatorFor(locale: Locale): Translator {
  return createTranslator(locale, flatten(locale), locale === DEFAULT_LOCALE ? {} : flatten(DEFAULT_LOCALE));
}

/** Ce qu'on envoie au navigateur : la langue fusionnée sur le français (pour que les clés manquantes se replient sans renvoyer le français en entier). */
export function clientDict(locale: Locale): Dict {
  const fr = flatten(DEFAULT_LOCALE, true);
  return locale === DEFAULT_LOCALE ? fr : { ...fr, ...flatten(locale, true) };
}

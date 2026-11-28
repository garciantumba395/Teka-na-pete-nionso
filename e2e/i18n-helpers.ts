import type { Page } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";

/** Fixe la langue d'interface d'un contexte de test (cookie « lang »), avant d'ouvrir une page. */
export async function setLang(page: Page, lang: "fr" | "en" | "ln" | "sw") {
  await page.context().addCookies([{ name: "lang", value: lang, url: BASE }]);
}

/**
 * Mots français courants qui ne devraient plus apparaître sur un écran affiché en anglais.
 * Contrôle d'ensemble, pas une preuve : les contenus saisis par les membres (titres, messages, noms) sont ignorés par l'appelant
 * en choisissant des données de test en anglais ou sans ces mots.
 */
const FRENCH = /\b(Annuler|Retour|Envoyer|Choisis|Réessaie|Aucun|Aucune|Vendu|Réservé|Voir|Ajouter|Retirer|Publier|Commande|Paiement|Annonce|Connexion|Chercher|Vendre|Bientôt|Merci|Tu|Ton|Ta|Tes|Mon|Mes|ton|ta|tes|pour|avec|dans|une|des|les|est|pas)\b/g;

/** Texte visible de la page qui contient encore des mots français (liste vide = bon). */
export async function frenchLeftovers(page: Page, opts: { ignore?: RegExp[] } = {}): Promise<string[]> {
  const text = await page.evaluate(() => document.body.innerText);
  const out = new Set<string>();
  for (const line of text.split("\n")) {
    if (opts.ignore?.some((r) => r.test(line))) continue;
    const hits = line.match(FRENCH);
    if (hits) out.add(`${hits.join(", ")}  ←  « ${line.trim().slice(0, 80)} »`);
  }
  return [...out];
}

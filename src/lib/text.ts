// Nettoyage du texte saisi par les membres, appliqué côté SERVEUR avant tout stockage ou affichage.
// Retire : octet nul (PostgreSQL le refuse), caractères de contrôle, marques de sens d'écriture (une annonce
// inversée usurpe un autre texte), espaces de largeur nulle et BOM, séparateurs de ligne Unicode, demi-paires de
// substitution isolées (le HTML serveur les remplace par U+FFFD, le client non : erreur d'hydratation).
// Les classes sont écrites en séquences d'échappement : aucun caractère invisible dans ce fichier.

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2028\u2029\u2060-\u2064\u2066-\u2069\uFEFF\uFFFE\uFFFF]/g;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** Texte sur une ligne (titre, nom, marque...) : les retours à la ligne deviennent des espaces. */
export function cleanLine(s: string): string {
  return s.replace(/[\r\n\t]+/g, " ").replace(CONTROL, "").replace(INVISIBLE, "").replace(LONE_SURROGATE, "");
}

/** Texte sur plusieurs lignes (description, bio) : garde les retours à la ligne. */
export function cleanText(s: string): string {
  return s.replace(/\r\n?/g, "\n").replace(CONTROL, "").replace(INVISIBLE, "").replace(LONE_SURROGATE, "");
}

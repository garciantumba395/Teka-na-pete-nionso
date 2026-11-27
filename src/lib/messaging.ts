// Règles de la messagerie, partagées par la couche factice et PostgreSQL.

export const MESSAGE_MAX = 2000;

/**
 * Détecte les échanges qui tentent de sortir de la plateforme : numéro de téléphone ou lien.
 * Le message est remis quand même (pas de censure) mais signalé : l'écran rappelle que payer hors de l'appli
 * fait perdre la protection du séquestre.
 */
export function detectOffPlatform(body: string): "phone" | "link" | null {
  if (/(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|cd|me|io|app)\b)/i.test(body)) return "link";
  // Séquence d'au moins 9 chiffres, séparateurs usuels tolérés (espaces, points, tirets, +, parenthèses).
  const stripped = body.replace(/(?<=\d)[\s.\-()]+(?=\d)/g, "");
  if (/\+?\d{9,}/.test(stripped)) return "phone";
  return null;
}

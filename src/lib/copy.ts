// Tous les textes de l'interface, écrits pour ce produit (aucun repris de l'original).
// Français d'abord ; lingala et swahili plus tard : un seul endroit à traduire.

export const APP_NAME = "NomAppli"; // PLACEHOLDER : le nom viendra de /replica-brand

export const NAV = [
  { href: "/", label: "Accueil", icon: "home" },
  { href: "/search", label: "Chercher", icon: "search" },
  { href: "/sell", label: "Vendre", icon: "plus" },
  { href: "/inbox", label: "Messages", icon: "msg" },
  { href: "/me", label: "Profil", icon: "user" },
] as const;

export const PAYMENT_METHODS = [
  { value: "mpesa", label: "M-Pesa" },
  { value: "orange_money", label: "Orange Money" },
  { value: "airtel_money", label: "Airtel Money" },
  { value: "africell_money", label: "Africell Money" },
] as const;

export const ORDER_STATUS_LABEL: Record<string, string> = {
  pending_payment: "En attente de paiement",
  paid: "Payée, remise à organiser",
  in_delivery: "En cours de remise",
  delivered: "Livrée",
  completed: "Terminée",
  disputed: "Litige en cours",
  refunded: "Remboursée",
  cancelled: "Annulée",
  expired: "Expirée",
};

/** Messages d'erreur lisibles pour les codes de l'API. Les messages du serveur restent prioritaires. */
export const ERROR_FALLBACK = "Une erreur est survenue. Réessaie dans un instant.";
export const NETWORK_ERROR = "Connexion impossible. Vérifie ton réseau puis réessaie.";

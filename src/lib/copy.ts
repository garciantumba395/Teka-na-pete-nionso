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

export const DISPUTE_REASONS: { value: "not_received" | "damaged" | "not_as_described" | "other"; label: string; hint: string }[] = [
  { value: "not_received", label: "La remise n'a pas eu lieu", hint: "L'autre personne ne s'est pas présentée ou n'a pas remis l'article." },
  { value: "damaged", label: "L'article est abîmé", hint: "Il est cassé ou plus abîmé que dans l'annonce." },
  { value: "not_as_described", label: "L'article ne correspond pas à l'annonce", hint: "Autre taille, autre modèle, défaut non annoncé." },
  { value: "other", label: "Autre problème", hint: "Explique-nous la situation." },
];

export const REPORT_REASONS: { value: "prohibited" | "counterfeit" | "scam" | "offensive" | "harassment" | "other"; label: string }[] = [
  { value: "prohibited", label: "Article interdit" },
  { value: "counterfeit", label: "Contrefaçon" },
  { value: "scam", label: "Arnaque ou paiement hors de l'appli" },
  { value: "offensive", label: "Contenu choquant" },
  { value: "harassment", label: "Harcèlement ou menaces" },
  { value: "other", label: "Autre raison" },
];

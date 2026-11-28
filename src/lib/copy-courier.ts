// Textes de la livraison par coursier local (agent D). Écrits pour ce produit, en français.

export const SHIPMENT_EVENT_LABEL: Record<string, string> = {
  paid: "Paiement reçu, l'argent est mis de côté",
  handed_to_courier: "Colis remis au coursier",
  in_transit: "Colis en route",
  received: "Réception confirmée par l'acheteur",
  lost_reported: "Colis signalé perdu, litige ouvert",
  auto_released: "Argent libéré au vendeur automatiquement (aucun litige dans le délai)",
  auto_refunded: "Remboursement automatique : colis jamais livré dans le délai",
};

export const SHIPMENT_STATUS_LABEL: Record<string, string> = {
  pending: "À remettre au coursier",
  handed_to_courier: "Remis au coursier",
  in_transit: "En route",
  delivered: "Livré",
  lost_suspected: "Colis perdu (supposé)",
};

/** Libellé du statut d'une commande livrée par coursier (le libellé générique parle de « remise »). */
export const COURIER_ORDER_STATUS_LABEL: Record<string, string> = {
  paid: "Payée, colis à remettre au coursier",
  in_delivery: "Colis en route",
  delivered: "Livrée, délai de réclamation en cours",
};

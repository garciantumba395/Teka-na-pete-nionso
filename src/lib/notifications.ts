import { APP_NAME } from "./copy";
import { FEES } from "./fees";

// Notifications internes : types partagés par les deux couches de données, textes français et liens.
// On stocke le TYPE et des identifiants (jamais de texte rédigé) : le libellé est produit à l'affichage,
// ce qui permet de corriger un texte sans migrer la base. Aucune donnée sensible dans la charge utile
// (ni code de remise, ni montant, ni numéro de téléphone).

export const NOTIFICATION_KINDS = [
  "message_received",
  "order_paid",
  "order_completed",
  "order_cancelled",
  "order_expired",
  "dispute_opened",
  "dispute_message",
  "dispute_resolved",
  "review_received",
  "report_handled",
  "suspension",
  // ---- agent F : événements ajoutés (annulation encadrée, coursier, preuves, modération)
  "cancel_requested",
  "cancel_accepted",
  "cancel_declined",
  "cancel_withdrawn",
  "cancel_expired",
  "parcel_handed",
  "parcel_in_transit",
  "parcel_received",
  "claim_reminder",
  "order_auto_released",
  "parcel_lost",
  "parcel_auto_refunded",
  "dispute_evidence",
  "listing_hidden",
  // ---- fin agent F
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export interface NotificationPayload {
  conversationId?: string;
  orderId?: string;
  /** Annonce concernée (annonce masquée) : sert au lien, jamais au texte du signalement. */
  itemId?: string;
  disputeId?: string;
  itemTitle?: string;
  senderName?: string;
  /** Messages regroupés : nombre de messages non lus de la conversation. */
  count?: number;
  /** Rôle du destinataire dans la commande (le texte diffère pour l'acheteur et le vendeur). */
  role?: "buyer" | "seller";
  /** Annulation décidée par le système (article jamais remis). */
  auto?: boolean;
  /** Annulation d'une commande déjà payée : l'acheteur est remboursé. */
  refunded?: boolean;
  outcome?: "refund_buyer" | "release_seller";
  rating?: number;
  /** Fin de suspension (ms depuis 1970). */
  until?: number;
}

export interface NotificationItem {
  id: string;
  kind: NotificationKind;
  payload: NotificationPayload;
  read: boolean;
  createdAt: number;
}

export interface NotificationList {
  items: NotificationItem[];
  unreadCount: number;
}

/** Ce qu'un événement demande au système de notification (entrée interne des couches de données). */
export interface NotifySpec {
  userId: string;
  kind: NotificationKind;
  payload: NotificationPayload;
  /** Idempotence : une seule notification par (membre, clé). Absente pour les notifications regroupées. */
  eventKey?: string;
  /** Regroupement : une seule notification non lue par (membre, groupe) ; une nouvelle arrivée l'incrémente. */
  groupKey?: string;
}

// ---------------------------------------------------------------------------------------------- SMS

export type SmsCategory = "orders" | "disputes";
export interface SmsPreferences { orders: boolean; disputes: boolean }
/** SMS critiques activés par défaut (ce sont des messages de service) ; chaque membre peut les couper. */
export const DEFAULT_SMS_PREFERENCES: SmsPreferences = { orders: true, disputes: true };

export const SMS_CATEGORIES: { key: SmsCategory; label: string; hint: string }[] = [
  { key: "orders", label: "Commandes", hint: "Un SMS quand une de tes ventes est payée ou qu'un acheteur demande à l'annuler, et quand le vendeur remet ton colis au coursier." },
  { key: "disputes", label: "Litiges", hint: "Un SMS quand un litige est ouvert ou résolu sur une de tes commandes." },
];

/** Sous-ensemble critique envoyé par SMS en plus de la notification interne. */
export const SMS_KIND_CATEGORY: Partial<Record<NotificationKind, SmsCategory>> = {
  order_paid: "orders",
  cancel_requested: "orders", // agent F
  parcel_handed: "orders", // agent F
  dispute_opened: "disputes",
  dispute_resolved: "disputes",
};

/** Plafond d'envois SMS de notification par numéro et par jour (maîtrise du coût et du harcèlement). */
export const SMS_DAILY_LIMIT = 5;

/** Texte court, sans donnée sensible : ni code de remise, ni montant, ni nom, ni titre d'annonce. */
export function smsText(kind: NotificationKind): string | null {
  switch (kind) {
    case "order_paid": return `${APP_NAME} : une de tes annonces vient d'être payée. Ouvre l'application pour organiser la remise.`;
    case "cancel_requested": return `${APP_NAME} : un acheteur demande l'annulation d'une de tes ventes. Ouvre l'application pour répondre.`;
    case "parcel_handed": return `${APP_NAME} : ton colis a été remis au coursier. Ouvre l'application pour suivre la livraison.`;
    case "dispute_opened": return `${APP_NAME} : un litige a été ouvert sur une de tes commandes. Ouvre l'application pour répondre.`;
    case "dispute_resolved": return `${APP_NAME} : un litige sur une de tes commandes est résolu. Ouvre l'application pour voir la décision.`;
    default: return null;
  }
}

// -------------------------------------------------------------------------------------- affichage

const dayFmt = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Kinshasa" });

/** Texte, détail et lien (relatif au site) d'une notification, du point de vue de son destinataire. */
export function describeNotification(n: Pick<NotificationItem, "kind" | "payload">): { title: string; body: string; href: string | null } {
  const p = n.payload;
  const item = p.itemTitle ? `« ${p.itemTitle} »` : "ton article";
  const order = p.orderId ? `/orders/${p.orderId}` : null;
  const dispute = p.orderId ? `/orders/${p.orderId}/dispute` : null;
  switch (n.kind) {
    case "message_received": {
      const c = p.count ?? 1;
      return {
        title: `Nouveau message de ${p.senderName ?? "un membre"}`,
        body: c > 1 ? `${c} messages non lus à propos de ${item}.` : `À propos de ${item}.`,
        href: p.conversationId ? `/inbox/${p.conversationId}` : "/inbox",
      };
    }
    case "order_paid":
      return { title: "Commande payée", body: `${item} est payé. Organise la remise en main propre avec l'acheteur.`, href: order };
    case "order_completed":
      return p.role === "buyer"
        ? { title: "Remise confirmée", body: `Ta commande ${item} est terminée. Tu peux donner ton avis sur le vendeur.`, href: order }
        : { title: "Vente terminée", body: `${item} est vendu. L'argent est disponible dans ton portefeuille.`, href: order };
    case "order_cancelled": {
      if (p.auto) return { title: "Commande annulée", body: `La commande de ${item} a été annulée : l'article n'a pas été remis à temps.${p.role === "buyer" ? " Tu es remboursé." : ""}`, href: order };
      return p.role === "buyer"
        ? { title: "Commande annulée", body: `Le vendeur a annulé la commande de ${item}.${p.refunded ? " Tu es remboursé." : ""}`, href: order }
        : { title: "Commande annulée", body: `L'acheteur a annulé la commande de ${item}.`, href: order };
    }
    case "order_expired":
      return p.role === "buyer"
        ? { title: "Commande expirée", body: `Le délai de paiement de ${item} est dépassé : la commande a expiré.`, href: order }
        : { title: "Commande expirée", body: `L'acheteur n'a pas payé ${item} à temps : la commande a expiré.`, href: order };
    case "dispute_opened":
      return { title: "Litige ouvert", body: `Un litige a été ouvert sur la commande de ${item}. Réponds depuis la page du litige.`, href: dispute };
    case "dispute_message":
      return { title: "Nouveau message dans un litige", body: `Un message a été ajouté au litige sur ${item}.`, href: dispute };
    case "dispute_resolved":
      return {
        title: "Litige résolu",
        body: p.outcome === "refund_buyer" ? `Le litige sur ${item} est résolu : l'acheteur est remboursé.` : `Le litige sur ${item} est résolu : l'argent est libéré au vendeur.`,
        href: dispute,
      };
    case "review_received": {
      const r = p.rating ? ` (${p.rating} sur 5)` : "";
      return { title: "Nouvel avis reçu", body: `Un membre a laissé un avis${r} suite à la commande de ${item}.`, href: order };
    }
    // ---- agent F : événements ajoutés. Aucun montant, code de remise ni numéro : seulement le titre de l'annonce.
    case "cancel_requested":
      return { title: "Demande d'annulation", body: `L'acheteur de ${item} demande l'annulation de la commande. Accepte ou refuse depuis la commande : sans réponse à temps, la demande est considérée comme refusée.`, href: order };
    case "cancel_accepted":
      return { title: "Annulation acceptée", body: `Le vendeur a accepté d'annuler la commande de ${item} : elle est annulée et tu es remboursé.`, href: order };
    case "cancel_declined":
      return { title: "Annulation refusée", body: `Le vendeur n'a pas accepté d'annuler la commande de ${item}. Si tu as un problème avec cette commande, tu peux ouvrir un litige depuis la commande.`, href: order };
    case "cancel_withdrawn":
      return { title: "Demande d'annulation retirée", body: `L'acheteur a retiré sa demande d'annulation de ${item} : la commande continue.`, href: order };
    case "cancel_expired":
      return p.role === "buyer"
        ? { title: "Demande d'annulation sans réponse", body: `Le vendeur n'a pas répondu à ta demande d'annulation de ${item} : elle est considérée comme refusée. Tu peux ouvrir un litige depuis la commande.`, href: order }
        : { title: "Demande d'annulation expirée", body: `Tu n'as pas répondu à la demande d'annulation de ${item} à temps : elle est considérée comme refusée.`, href: order };
    case "parcel_handed":
      return { title: "Colis remis au coursier", body: `Le vendeur a remis ${item} au coursier. Suis la livraison depuis ta commande.`, href: order };
    case "parcel_in_transit":
      return { title: "Colis en route", body: `Ton colis ${item} est en route vers toi.`, href: order };
    case "parcel_received":
      return { title: "Colis reçu", body: `L'acheteur a confirmé la réception de ${item}. L'argent te sera libéré dans ${Math.round(FEES.claimWindowMs / 3_600_000)} heures, sauf litige.`, href: order };
    case "claim_reminder":
      return { title: "Un problème avec ton colis ?", body: `Tu as reçu ${item}. Si quelque chose ne va pas, ouvre un litige avant la fin de la période de réclamation : ensuite, l'argent est libéré au vendeur.`, href: order };
    case "order_auto_released":
      return p.role === "buyer"
        ? { title: "Commande terminée", body: `La période de réclamation sur ${item} est terminée : la commande est finalisée et l'argent a été libéré au vendeur.`, href: order }
        : { title: "Argent disponible", body: `La période de réclamation sur ${item} est terminée : l'argent est disponible dans ton portefeuille.`, href: order };
    case "parcel_lost":
      return { title: "Colis signalé non reçu", body: `Le colis de ${item} est signalé non reçu ou perdu : un litige a été ouvert. Réponds depuis la page du litige.`, href: dispute };
    case "parcel_auto_refunded":
      return p.role === "buyer"
        ? { title: "Colis non livré : remboursé", body: `Le colis de ${item} est resté trop longtemps chez le coursier : la commande est annulée et tu es remboursé.`, href: order }
        : { title: "Colis non livré : commande annulée", body: `Le colis de ${item} est resté trop longtemps chez le coursier : la commande est annulée et l'acheteur est remboursé.`, href: order };
    case "dispute_evidence":
      return { title: "Nouvelle preuve dans un litige", body: `Une photo a été ajoutée au litige sur ${item}.`, href: dispute };
    case "listing_hidden":
      return { title: "Annonce masquée", body: `Ton annonce ${item} a été masquée par notre équipe de modération : les autres membres ne la voient plus. Contacte l'assistance si tu penses qu'il y a une erreur.`, href: p.itemId ? `/items/${p.itemId}` : null };
    // ---- fin agent F
    case "report_handled":
      return { title: "Signalement traité", body: "Merci pour ton signalement : notre équipe l'a traité.", href: null };
    case "suspension":
      return {
        title: "Compte suspendu",
        body: p.until ? `Ton compte est suspendu jusqu'au ${dayFmt.format(p.until)}. Contacte l'assistance si tu penses qu'il y a une erreur.` : "Ton compte est suspendu. Contacte l'assistance si tu penses qu'il y a une erreur.",
        href: null,
      };
  }
}

export const NOTIFICATIONS_PAGE_LIMIT = 100;
/** Les notifications lues sont supprimées après ce délai (tâche planifiée purge_old_notifications). */
export const NOTIFICATIONS_RETENTION_DAYS = 90;

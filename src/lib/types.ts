// Types du domaine. Ils reflètent replica/schema.sql (mêmes statuts, mêmes noms).

export type Currency = "USD" | "CDF";

export type OrderStatus =
  | "pending_payment"
  | "paid"
  | "in_delivery"
  | "delivered"
  | "completed"
  | "disputed"
  | "refunded"
  | "cancelled"
  | "expired";

export type ItemStatus = "draft" | "active" | "reserved" | "sold" | "hidden" | "removed";
export type Condition = "new_with_tags" | "new" | "very_good" | "good" | "satisfactory";
export type PaymentMethod = "mpesa" | "orange_money" | "airtel_money" | "africell_money";
export type PaymentStatus = "initiated" | "pending_user" | "succeeded" | "failed" | "expired" | "refunded";
export type PayoutStatus = "requested" | "processing" | "paid" | "failed" | "cancelled";
export type DeliveryMethod = "hand_delivery" | "courier" | "relay_point";

export type LedgerAccount =
  | "psp_clearing"
  | "order_escrow"
  | "seller_available"
  | "payout_pending"
  | "shipping_payable"
  | "platform_revenue"
  | "psp_fees";

export interface LedgerEntry {
  id: string;
  txnId: string;
  account: LedgerAccount;
  userId: string | null;
  currency: Currency;
  amountMinor: number; // débit positif, crédit négatif
  refType: "order" | "payment" | "payout" | "dispute" | "bump" | "adjustment";
  refId: string;
  createdAt: number;
}

export type UserRole = "member" | "moderator" | "support" | "admin";

export interface User {
  id: string;
  phone: string; // E.164
  displayName: string;
  bio: string;
  areaId: string | null;
  verificationLevel: "none" | "phone" | "id";
  ratingAvg: number | null;
  ratingCount: number;
  createdAt: number;
  role?: UserRole;
  /** Fin de la suspension en cours (sanction de modération), sinon null. */
  suspendedUntil?: number | null;
}

export interface PublicProfile {
  id: string;
  displayName: string;
  bio: string;
  areaId: string | null;
  verificationLevel: User["verificationLevel"];
  ratingAvg: number | null;
  ratingCount: number;
}

export interface Category {
  id: string;
  parentId: string | null;
  slug: string;
  name: string;
  isSellable: boolean;
}

export interface Area {
  id: string;
  parentId: string | null;
  kind: "country" | "province" | "commune";
  name: string;
  lat: number | null;
  lng: number | null;
}

export interface Item {
  id: string;
  sellerId: string;
  categoryId: string;
  title: string;
  description: string;
  condition: Condition;
  sizeLabel: string | null;
  brand: string | null;
  priceMinor: number;
  currency: Currency;
  status: ItemStatus;
  areaId: string | null;
  lat: number | null;
  lng: number | null;
  photos: string[]; // URL ou data URL, dans l'ordre
  publishedAt: number | null;
  createdAt: number;
}

export interface ItemCard {
  id: string;
  title: string;
  priceMinor: number;
  currency: Currency;
  protectedPriceMinor: number;
  status: ItemStatus;
  photo: string | null;
  meta: string; // « Marque · Taille · État »
  areaName: string | null;
  distanceKm: number | null;
}

export interface ItemDetail extends ItemCard {
  brand: string | null;
  sizeLabel: string | null;
  description: string;
  photos: string[];
  condition: Condition;
  categoryName: string;
  seller: PublicProfile;
  sellerId: string;
}

export interface ItemQuery {
  q?: string;
  categoryId?: string;
  minPriceUsdMinor?: number;
  maxPriceUsdMinor?: number;
  areaId?: string; // centre du rayon = centroïde de la zone
  lat?: number;
  lng?: number;
  radiusKm?: number;
  sellerId?: string;
  /** Filtres de recherche (marque : contient, sans accent ni casse ; taille : égalité sans casse ; état : un ou plusieurs). */
  brand?: string;
  sizeLabel?: string;
  conditions?: Condition[];
  includeSold?: boolean;
  limit?: number;
}

export interface Order {
  id: string;
  buyerId: string;
  sellerId: string;
  status: OrderStatus;
  currency: Currency;
  itemsMinor: number;
  shippingMinor: number;
  protectionFeeMinor: number;
  totalMinor: number;
  deliveryMethod: DeliveryMethod;
  deliveryAreaId: string | null;
  deliveryLandmark: string | null;
  itemIds: string[];
  paymentExpiresAt: number | null;
  paidAt: number | null;
  deliveredAt: number | null;
  completedAt: number | null;
  cancelledAt: number | null;
  createdAt: number;
  /** Livraison par coursier : fin de la fenêtre de réclamation après « reçu ». Libération automatique à cette date, sauf litige. */
  autoReleaseAt: number | null;
}

export type OrderAction =
  | "pay" | "cancel" | "reveal_code" | "confirm_delivery" | "accept" | "issue" | "review"
  // Annulation encadrée après paiement : l'acheteur demande (ou retire), le vendeur accepte ou refuse.
  | "request_cancel" | "withdraw_cancel" | "accept_cancel" | "decline_cancel"
  // livraison par coursier
  | "ship" | "mark_in_transit" | "confirm_received" | "report_lost";

/** pending : en attente du vendeur ; accepted : acceptée (commande annulée) ; declined : refusée ; expired : sans réponse dans le délai, traitée comme un refus. */
export type CancelRequestStatus = "pending" | "accepted" | "declined" | "expired";

// ------------------------------------------------------------------------------------------------ livraison par coursier
export interface ShippingQuote {
  shippingMinor: number;
  currency: Currency;
  zone: "sameCommune" | "sameCity" | "otherCity";
}

export type ShipmentStatus = "pending" | "handed_to_courier" | "in_transit" | "delivered" | "lost_suspected";
export type ShipmentEventKind = "paid" | "handed_to_courier" | "in_transit" | "received" | "lost_reported" | "auto_released" | "auto_refunded";

export interface ShipmentEventView {
  id: string;
  kind: ShipmentEventKind;
  at: number;
  note: string | null;
}

/** Suivi d'une livraison par coursier. Les coordonnées du coursier n'existent qu'après paiement (l'expédition naît au paiement). */
export interface ShipmentView {
  status: ShipmentStatus;
  courierName: string | null;
  courierPhone: string | null;
  trackingRef: string | null;
  events: ShipmentEventView[];
}

export interface OrderView extends Order {
  viewerRole: "buyer" | "seller";
  items: { id: string; title: string; photo: string | null; priceMinor: number; currency: Currency }[];
  counterpart: PublicProfile;
  payment: { id: string; status: PaymentStatus; method: PaymentMethod; failureCode: string | null } | null;
  handover: { attemptsLeft: number; lockedUntil: number | null } | null;
  actions: OrderAction[];
  /** Litige ouvert ou clos sur cette commande, s'il y en a un. */
  dispute: { id: string; status: DisputeStatus } | null;
  /** Dernière demande d'annulation de l'acheteur (null si aucune, ou si elle a été retirée). `expiresAt` : au-delà, elle vaut refus. */
  cancelRequest: { status: CancelRequestStatus; requestedAt: number; expiresAt: number } | null;
  /** Suivi du colis : seulement pour la livraison par coursier, et seulement après paiement. */
  shipment: ShipmentView | null;
}

export interface Payment {
  id: string;
  orderId: string;
  provider: string;
  method: PaymentMethod;
  msisdn: string;
  amountMinor: number;
  currency: Currency;
  status: PaymentStatus;
  providerRef: string | null;
  idempotencyKey: string;
  failureCode: string | null;
  createdAt: number;
}

export interface Payout {
  id: string;
  userId: string;
  amountMinor: number;
  feeMinor: number;
  currency: Currency;
  method: PaymentMethod;
  msisdn: string;
  status: PayoutStatus;
  providerRef: string | null;
  idempotencyKey: string;
  failureCode: string | null;
  requestedAt: number;
  paidAt: number | null;
}

export interface Wallet {
  balances: { currency: Currency; availableMinor: number; pendingMinor: number }[];
  entries: { id: string; at: number; label: string; amountMinor: number; currency: Currency }[];
}

export interface ProviderEvent {
  eventId: string;
  type: "collection.succeeded" | "collection.failed" | "payout.succeeded" | "payout.failed";
  providerRef: string;
  failureCode?: string;
}

/**
 * Reconnaît une AppError par ses propriétés, PAS par `instanceof` : Next.js empaquette la couche de données
 * et les routes dans des bundles séparés, la classe existe alors en plusieurs exemplaires et `instanceof`
 * échoue entre eux (toute erreur métier devenait un 500).
 */
export function isAppError(e: unknown): e is AppError {
  return (
    e instanceof Error &&
    e.name === "AppError" &&
    typeof (e as AppError).code === "string" &&
    typeof (e as AppError).status === "number"
  );
}

// Erreurs métier : code stable (pour l'interface) + statut HTTP.
export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
    public details?: Record<string, string>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

// ------------------------------------------------------------------------------------------------ messagerie
export interface ChatMessage {
  id: string;
  /** true si le message vient du membre qui consulte. */
  mine: boolean;
  /** « system » : message de la plateforme (pas d'expéditeur). */
  kind: "text" | "system" | "image";
  body: string;
  /** Photo jointe (kind « image ») : adresse privée, lisible seulement par les deux participants. */
  photoUrl: string | null;
  /** Nom de l'expéditeur (texte alternatif de la photo). null pour un message de la plateforme. */
  senderName: string | null;
  /** Contient un numéro ou un lien : l'écran affiche un rappel de sécurité. Le message est quand même remis. */
  flagged: boolean;
  createdAt: number;
}

export interface ConversationSummary {
  id: string;
  itemId: string;
  itemTitle: string;
  itemPhoto: string | null;
  counterpart: PublicProfile;
  lastMessage: string | null;
  lastMessageAt: number | null;
  unread: number;
}

export interface ConversationView extends ConversationSummary {
  messages: ChatMessage[];
}

// ------------------------------------------------------------------------------------------------ litiges
export type DisputeReason = "not_received" | "damaged" | "not_as_described" | "other";
export type DisputeStatus = "open" | "resolved_refund" | "resolved_release";
export type DisputeOutcome = "refund_buyer" | "release_seller";

export interface DisputeNote {
  id: string;
  authorName: string;
  mine: boolean;
  /** Message de l'équipe d'assistance. */
  staff: boolean;
  note: string;
  createdAt: number;
}

// ---- agent B : photos de preuve et de messagerie
/** Photo de preuve d'un litige, avec une note facultative. Jamais présente dans une liste publique. */
export interface DisputeEvidence {
  id: string;
  /** « Assistance » pour l'équipe d'assistance. */
  authorName: string;
  mine: boolean;
  staff: boolean;
  photoUrl: string;
  note: string;
  createdAt: number;
}

export interface DisputeView {
  id: string;
  orderId: string;
  status: DisputeStatus;
  reason: DisputeReason;
  description: string;
  openedByName: string;
  openedByMe: boolean;
  openedAt: number;
  resolvedAt: number | null;
  notes: DisputeNote[];
  /** Photos de preuve, de la plus ancienne à la plus récente. */
  evidence: DisputeEvidence[];
  order: { itemTitle: string; totalMinor: number; currency: Currency; buyerName: string; sellerName: string };
  viewerRole: "buyer" | "seller" | "staff";
}

export interface DisputeSummary {
  id: string;
  orderId: string;
  reason: DisputeReason;
  openedAt: number;
  itemTitle: string;
  totalMinor: number;
  currency: Currency;
}

// ------------------------------------------------------------------------------------------------ avis
export interface Review {
  id: string;
  orderId: string;
  authorName: string;
  rating: number;
  comment: string;
  createdAt: number;
}

// ------------------------------------------------------------------------------------------------ signalement
export type ReportTarget = "item" | "user";
export type ReportReason = "prohibited" | "counterfeit" | "scam" | "offensive" | "harassment" | "other";
export type ReportStatus = "open" | "actioned" | "dismissed";
export type ReportAction = "dismiss" | "hide_item" | "suspend_user";

export interface ReportView {
  id: string;
  targetType: ReportTarget;
  targetId: string;
  /** Titre de l'annonce ou nom du membre signalé. */
  targetLabel: string;
  reason: ReportReason;
  details: string;
  reporterName: string;
  status: ReportStatus;
  createdAt: number;
}

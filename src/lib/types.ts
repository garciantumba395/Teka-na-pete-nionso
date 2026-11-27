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
}

export type OrderAction = "pay" | "cancel" | "reveal_code" | "confirm_delivery" | "accept" | "issue";

export interface OrderView extends Order {
  viewerRole: "buyer" | "seller";
  items: { id: string; title: string; photo: string | null; priceMinor: number; currency: Currency }[];
  counterpart: PublicProfile;
  payment: { id: string; status: PaymentStatus; method: PaymentMethod; failureCode: string | null } | null;
  handover: { attemptsLeft: number; lockedUntil: number | null } | null;
  actions: OrderAction[];
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

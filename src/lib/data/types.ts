import type {
  Area,
  Category,
  Item,
  ItemCard,
  ItemDetail,
  ItemQuery,
  Order,
  OrderView,
  Payment,
  PaymentMethod,
  Payout,
  ProviderEvent,
  PublicProfile,
  User,
  Wallet,
  Currency,
  DeliveryMethod,
} from "../types";
import type { ListingInput } from "../validation";

/**
 * Contrat de la couche de données. L'implémentation factice (fake.ts) et l'implémentation réelle
 * (replica-backend : Supabase + PSP) respectent les MÊMES signatures : changer l'une pour l'autre
 * ne modifie aucun écran.
 */
export interface DataLayer {
  // Authentification (identité = numéro de téléphone)
  requestOtp(phoneInput: string): Promise<{ phone: string; devCode?: string }>;
  verifyOtp(phoneInput: string, code: string, displayName?: string): Promise<{ user: User; isNew: boolean }>;
  getUser(id: string): Promise<User | null>;
  getPublicProfile(id: string): Promise<PublicProfile | null>;
  updateMe(userId: string, patch: { displayName?: string; bio?: string; areaId?: string | null }): Promise<User>;

  // Sessions : jeton opaque (seule son empreinte est stockée), révocable.
  createSession(userId: string, meta?: { ip?: string; userAgent?: string }): Promise<{ token: string; expiresAt: number }>;
  getSessionUser(token: string): Promise<User | null>;
  deleteSession(token: string): Promise<void>;
  deleteAllSessions(userId: string): Promise<void>;
  /** Suppression de compte : anonymise le profil (les commandes passées restent pour la comptabilité). Refuse s'il reste une commande ouverte ou de l'argent. */
  deleteAccount(userId: string): Promise<void>;

  /** Photo stockée côté serveur (null si l'implémentation garde les photos dans l'annonce). */
  getPhoto(id: string): Promise<{ mime: string; bytes: Buffer } | null>;

  /** Santé du service : la base répond. Sert au point de contrôle /api/health (supervision). */
  health(): Promise<{ ok: true }>;

  // Limitation de débit (fenêtre fixe) et entretien
  rateLimit(key: string, limit: number, windowSec: number): Promise<{ allowed: boolean; retryAfterSec: number }>;
  purgeExpired(): Promise<{ otp: number; sessions: number; rateLimits: number }>;
  /** Interroge le PSP pour les paiements restés « en attente » sans webhook. Retourne le nombre de paiements résolus. */
  reconcilePendingPayments(): Promise<number>;

  // Catalogue
  listCategories(): Promise<Category[]>;
  listAreas(parentId?: string | null): Promise<Area[]>;
  listItems(query: ItemQuery): Promise<ItemCard[]>;
  getItem(id: string, viewerId?: string | null): Promise<ItemDetail | null>;
  createDraft(sellerId: string, input: ListingInput): Promise<Item>;
  publishItem(sellerId: string, itemId: string): Promise<Item>;

  // Commandes et paiement
  createOrder(
    buyerId: string,
    input: { itemIds: string[]; deliveryMethod: DeliveryMethod; deliveryAreaId?: string | null; deliveryLandmark?: string | null },
  ): Promise<Order>;
  getOrder(orderId: string, viewerId: string): Promise<OrderView>;
  listMyOrders(userId: string): Promise<OrderView[]>;
  startPayment(
    orderId: string,
    buyerId: string,
    input: { method: PaymentMethod; msisdn: string; idempotencyKey: string },
  ): Promise<Payment>;
  getPayment(orderId: string, buyerId: string): Promise<Payment | null>;
  getHandoverCode(orderId: string, buyerId: string): Promise<string>;
  confirmDelivery(orderId: string, sellerId: string, code: string): Promise<OrderView>;
  acceptOrder(orderId: string, buyerId: string): Promise<OrderView>;
  cancelOrder(orderId: string, actorId: string): Promise<OrderView>;
  /**
   * Traite un événement du PSP, de façon idempotente. `matched: false` = référence inconnue : l'événement n'est PAS
   * enregistré (le PSP peut arriver avant que notre référence soit écrite, il doit pouvoir le rejouer).
   */
  handleProviderEvent(event: ProviderEvent): Promise<{ duplicate: boolean; matched?: boolean }>;
  expireUnpaidOrders(): Promise<number>;

  // Portefeuille
  getWallet(userId: string): Promise<Wallet>;
  requestPayout(
    userId: string,
    input: { amountMinor: number; currency: Currency; method: PaymentMethod; msisdn: string; idempotencyKey: string },
  ): Promise<Payout>;
  listPayouts(userId: string): Promise<Payout[]>;
}

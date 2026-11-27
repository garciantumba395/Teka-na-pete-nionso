import type {
  Area,
  Category,
  ChatMessage,
  ConversationSummary,
  ConversationView,
  DisputeOutcome,
  DisputeReason,
  DisputeSummary,
  DisputeView,
  ReportAction,
  ReportReason,
  ReportStatus,
  ReportTarget,
  ReportView,
  Review,
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
import type { PublicProhibitedRule } from "../prohibited";
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

  // Messagerie acheteur-vendeur, rattachée à une annonce. Un tiers n'y a jamais accès (404).
  /** Ouvre (ou retrouve) la conversation de cet acheteur sur cette annonce. */
  startConversation(buyerId: string, itemId: string): Promise<{ id: string; created: boolean }>;
  listConversations(userId: string): Promise<ConversationSummary[]>;
  /** Lit la conversation et marque comme lus les messages de l'interlocuteur. */
  getConversation(conversationId: string, viewerId: string): Promise<ConversationView>;
  sendMessage(conversationId: string, senderId: string, body: string): Promise<ChatMessage>;

  // Litiges : gèlent le séquestre ; seule l'équipe d'assistance (rôle support ou admin) tranche.
  openDispute(orderId: string, userId: string, input: { reason: DisputeReason; description: string }): Promise<DisputeView>;
  getOrderDispute(orderId: string, viewerId: string): Promise<DisputeView | null>;
  getDisputeById(disputeId: string, viewerId: string): Promise<DisputeView>;
  addDisputeNote(disputeId: string, authorId: string, note: string): Promise<DisputeView>;
  listOpenDisputes(staffId: string): Promise<DisputeSummary[]>;
  resolveDispute(staffId: string, disputeId: string, outcome: DisputeOutcome, note?: string): Promise<DisputeView>;
  /** Commandes payées jamais remises depuis trop longtemps (sans litige) : remboursées automatiquement. Retourne leur nombre. */
  expireStalePaidOrders(): Promise<number>;

  // Avis : une note par membre et par commande terminée.
  createReview(orderId: string, authorId: string, input: { rating: number; comment: string }): Promise<Review>;
  getMyReview(orderId: string, authorId: string): Promise<Review | null>;
  listReviews(userId: string): Promise<Review[]>;

  // Signalement et modération (rôles moderator, support, admin).
  createReport(reporterId: string, input: { targetType: ReportTarget; targetId: string; reason: ReportReason; details: string }): Promise<{ id: string; created: boolean }>;
  listReports(staffId: string, status?: ReportStatus): Promise<ReportView[]>;
  handleReport(staffId: string, reportId: string, action: ReportAction): Promise<ReportView>;

  // Portefeuille
  getWallet(userId: string): Promise<Wallet>;
  requestPayout(
    userId: string,
    input: { amountMinor: number; currency: Currency; method: PaymentMethod; msisdn: string; idempotencyKey: string },
  ): Promise<Payout>;
  listPayouts(userId: string): Promise<Payout[]>;

  // ---- agent E : articles interdits
  /** Règles d'articles interdits en vigueur, SANS les mots-clés (page publique et administration). */
  listProhibitedRules(): Promise<PublicProhibitedRule[]>;
  // ---- fin agent E
}

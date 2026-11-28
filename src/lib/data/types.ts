import type { CourierFeeMode } from "../fees";
import type {
  Area,
  CourierDue,
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
  ShippingQuote,
} from "../types";
import type { PublicProhibitedRule } from "../prohibited";
import type { NotificationList, SmsPreferences } from "../notifications";
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
  /** Avant paiement : libre pour les deux. Après paiement, avant remise : le VENDEUR seul (409 CANCEL_REQUEST_REQUIRED pour l'acheteur, qui doit demander l'annulation). */
  cancelOrder(orderId: string, actorId: string): Promise<OrderView>;
  // ---- agent A : annulation encadrée
  /** Acheteur : demande l'annulation d'une commande payée non remise. Le vendeur accepte (remboursement intégral) ou refuse ; sans réponse sous cancelRequestTtlMs, vaut refus. */
  requestCancellation(orderId: string, buyerId: string): Promise<OrderView>;
  /** Acheteur : retire sa demande en attente. */
  withdrawCancellation(orderId: string, buyerId: string): Promise<OrderView>;
  /** Vendeur : accepte la demande => commande annulée, acheteur remboursé en totalité, articles remis en vente. */
  acceptCancellation(orderId: string, sellerId: string): Promise<OrderView>;
  /** Vendeur : refuse la demande (l'acheteur peut alors ouvrir un litige). */
  declineCancellation(orderId: string, sellerId: string): Promise<OrderView>;
  // ---- fin agent A
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

  // ---- agent B : photos de preuve et de messagerie
  /**
   * Message avec UNE photo (data URL JPEG/PNG/WebP, type vérifié sur le contenu), avec ou sans texte.
   * Mêmes règles d'accès que sendMessage (tiers = 404).
   */
  sendPhotoMessage(conversationId: string, senderId: string, input: { body: string; photo: string }): Promise<ChatMessage>;
  /**
   * Ajoute une photo de preuve (et une note facultative) à un litige ouvert : parties ou assistance, 6 au plus par membre.
   * Retourne le litige à jour. Tiers = 404.
   */
  addDisputeEvidence(disputeId: string, authorId: string, input: { photo: string; note?: string }): Promise<DisputeView>;
  /**
   * Octets d'une photo de message ou de preuve. null (donc 404) si elle n'existe pas OU si `viewerId` n'est pas
   * participant : un tiers ne peut pas savoir si l'identifiant existe.
   */
  getPrivatePhoto(id: string, viewerId: string): Promise<{ mime: string; bytes: Buffer } | null>;

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

  // ---- agent G : frais de livraison par coursier
  /** Mode courant : `seller` (le vendeur règle le coursier) ou `platform` (la plateforme règle). */
  getCourierFeeMode(): Promise<CourierFeeMode>;
  /** Administrateur seulement. Ne change que les libérations FUTURES : les frais déjà versés ou en attente restent tels quels. */
  setCourierFeeMode(adminId: string, mode: CourierFeeMode): Promise<CourierFeeMode>;
  /** Assistance : frais de livraison en attente de règlement au coursier (mode `platform`), un par commande menée à terme. */
  listCourierDues(staffId: string): Promise<CourierDue[]>;
  /** Assistance : solde `shipping_payable` de la commande vers `courier_paid`. Idempotent : un second appel renvoie 409. */
  settleCourierFee(staffId: string, orderId: string): Promise<{ orderId: string; amountMinor: number; currency: Currency }>;
  requestPayout(
    userId: string,
    input: { amountMinor: number; currency: Currency; method: PaymentMethod; msisdn: string; idempotencyKey: string },
  ): Promise<Payout>;
  listPayouts(userId: string): Promise<Payout[]>;

  // ---- agent E : articles interdits
  /** Règles d'articles interdits en vigueur, SANS les mots-clés (page publique et administration). */
  listProhibitedRules(): Promise<PublicProhibitedRule[]>;
  // ---- fin agent E

  // ---- agent D : livraison par coursier
  /** Frais de livraison par coursier d'un article vers une commune (grille de frais, voir fees.ts). Sans effet de bord. */
  quoteShipping(itemId: string, destAreaId: string): Promise<ShippingQuote>;
  /** Vendeur : renseigne le coursier et marque le colis « remis au coursier » (commande payée -> en cours de livraison). */
  shipOrder(orderId: string, sellerId: string, input: { courierName: string; courierPhone: string; trackingRef?: string | null }): Promise<OrderView>;
  /** Vendeur (pour le compte du coursier) : le colis est « en route ». */
  markInTransit(orderId: string, sellerId: string): Promise<OrderView>;
  /** Acheteur : « j'ai reçu le colis ». Commande livrée ; la fenêtre de réclamation démarre. */
  confirmReceived(orderId: string, buyerId: string): Promise<OrderView>;
  /** Acheteur ou vendeur : « colis perdu ». Ouvre un litige (motif : non reçu) et gèle l'argent. */
  reportParcelLost(orderId: string, userId: string, input?: { description?: string }): Promise<DisputeView>;
  /** Tâche planifiée : libère au vendeur les commandes livrées dont la fenêtre de réclamation est close et sans litige. `at` : horloge simulée (tests, jamais en production). */
  releaseDeliveredOrders(opts?: { at?: number }): Promise<number>;
  /** Tâche planifiée : rembourse les colis restés « remis au coursier » trop longtemps sans livraison. */
  refundStaleCourierOrders(opts?: { at?: number }): Promise<number>;

  // ---- agent C : notifications
  // Notifications internes (centre de notifications). Un membre ne voit QUE les siennes ; une notification d'un tiers = 404.
  // Les événements (message, commande, litige, avis, signalement, suspension) les créent DANS les méthodes ci-dessus,
  // dans la même transaction que l'événement, sans jamais notifier l'auteur de l'action.
  /** Non lues d'abord, puis les plus récentes. `unreadCount` compte TOUTES les non lues, pas seulement la page renvoyée. */
  listNotifications(userId: string, opts?: { limit?: number }): Promise<NotificationList>;
  countUnreadNotifications(userId: string): Promise<number>;
  /** Idempotent. 404 si la notification n'existe pas ou n'est pas à ce membre. */
  markNotificationRead(userId: string, notificationId: string): Promise<void>;
  /** Retourne le nombre de notifications passées de non lue à lue. */
  markAllNotificationsRead(userId: string): Promise<number>;
  /** Préférences SMS par catégorie (les notifications internes ne se désactivent pas). */
  getNotificationPreferences(userId: string): Promise<SmsPreferences>;
  updateNotificationPreferences(userId: string, patch: Partial<SmsPreferences>): Promise<SmsPreferences>;
  /** Supprime les notifications LUES depuis plus de 90 jours. Retourne leur nombre. */
  purgeOldNotifications(): Promise<number>;
  // ---- fin agent C : notifications

  // ---- agent F : rappels et expirations notifiés (tâche planifiée send_order_reminders)
  /** Prévient l'acheteur ET le vendeur des demandes d'annulation restées sans réponse (traitées comme un refus). Idempotent par demande. Retourne le nombre de demandes notifiées. */
  notifyExpiredCancelRequests(opts?: { at?: number }): Promise<number>;
  /** Rappelle à l'acheteur, à mi-parcours de la fenêtre de réclamation, qu'il peut encore ouvrir un litige. Idempotent par commande. Retourne le nombre de rappels créés. */
  remindClaimWindows(opts?: { at?: number }): Promise<number>;
  // ---- fin agent F
}

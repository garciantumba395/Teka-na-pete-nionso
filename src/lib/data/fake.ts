import { createHash, randomBytes, randomUUID } from "node:crypto";
import { FEES, payoutFee, protectionFee, shippingFee, shippingZone } from "../fees";
import { assertTransition } from "../fsm";
import { coarsen, distanceKm } from "../geo";
import { codesEqual, checkAttempt, deriveHandoverCode, hashCode, type AttemptState } from "../handover";
import {
  assertBalanced, holdEntries, payoutFailedEntries, payoutPaidEntries, payoutRequestEntries, refundEntries,
  releaseEntries, sellerAvailable, sellerPending, type NewEntry,
} from "../ledger";
import { detectOffPlatform, MESSAGE_MAX } from "../messaging";
import { normalizeDrcPhone } from "../phone";
import { FakeMobileMoneyProvider } from "../payments/fake-provider";
import {
  AppError, type Area, type Category, type ChatMessage, type ConversationSummary, type Currency, type DisputeNote, type DisputeOutcome, type DisputeReason, type DisputeStatus, type DisputeSummary, type DisputeView, type ReportAction, type ReportReason, type ReportStatus, type ReportTarget, type ReportView, type Review, type UserRole, type Item, type ItemCard, type ItemDetail, type ItemQuery,
  type LedgerEntry, type Order, type OrderAction, type OrderView, type Payment, type PaymentMethod, type Payout,
  type ProviderEvent, type PublicProfile, type User, type Wallet,
  type ShipmentEventKind, type ShipmentStatus, type ShipmentView, type ShippingQuote,
} from "../types";
import { CONDITIONS, validateListing, type ListingInput } from "../validation";
import type { DataLayer } from "./types";
import { seedAreas, seedCategories, seedItems, seedUsers } from "./seed";

export interface FakeOptions {
  now?: () => number;
  /** true : le fournisseur factice « appelle le webhook » tout seul après providerDelayMs. false : manuel (tests). */
  autoComplete?: boolean;
  providerDelayMs?: number;
  otpCode?: string;
  seed?: boolean;
}

export interface FakeData extends DataLayer {
  /** Crochets de test, absents de l'implémentation réelle. */
  __ledger(): LedgerEntry[];
  __pendingEvents(): ProviderEvent[];
  __flush(): Promise<void>;
  __provider: FakeMobileMoneyProvider;
}

interface ShipmentRec {
  orderId: string;
  status: ShipmentStatus;
  attempt: AttemptState;
  codeHash: string;
  confirmedBy: "buyer_code" | "buyer" | "courier" | "auto" | null;
  // ---- agent D : livraison par coursier
  courierName: string | null;
  courierPhone: string | null;
  trackingRef: string | null;
  events: { id: string; kind: ShipmentEventKind; at: number; note: string | null }[];
}

const LOST_DEFAULT_TEXT = "Colis signalé perdu : il n'est pas arrivé à destination.";
const METHODS: PaymentMethod[] = ["mpesa", "orange_money", "airtel_money", "africell_money"];
const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
const PHOTO_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

export function createFakeData(opts: FakeOptions = {}): FakeData {
  const now = opts.now ?? Date.now;
  const autoComplete = opts.autoComplete ?? false;
  const delay = opts.providerDelayMs ?? 3000;
  const OTP = opts.otpCode ?? "123456";
  const provider = new FakeMobileMoneyProvider();

  const users = new Map<string, User>();
  const categories: Category[] = seedCategories();
  const areas: Area[] = seedAreas();
  const items = new Map<string, Item>();
  const orders = new Map<string, Order>();
  const openItem = new Map<string, string>(); // itemId -> orderId (équivalent de l'index unique partiel order_items_one_open_per_item)
  const payments = new Map<string, Payment>();
  const payouts = new Map<string, Payout>();
  const shipments = new Map<string, ShipmentRec>();
  const ledger: LedgerEntry[] = [];
  const seenEvents = new Set<string>();
  const otps = new Map<string, { code: string; expiresAt: number; attempts: number; sent: number[] }>();
  const queue: ProviderEvent[] = [];
  const sessions = new Map<string, { userId: string; expiresAt: number }>();
  const limits = new Map<string, { start: number; count: number }>();
  const deleted = new Set<string>();
  interface ConvRec { id: string; itemId: string; buyerId: string; sellerId: string; lastMessageAt: number | null; createdAt: number }
  interface MsgRec { id: string; convId: string; senderId: string | null; kind: "text" | "system"; body: string; flagged: boolean; readAt: number | null; createdAt: number }
  interface DisputeRec { id: string; orderId: string; openedBy: string; reason: DisputeReason; description: string; status: DisputeStatus; openedAt: number; resolvedAt: number | null }
  interface NoteRec { id: string; disputeId: string; authorId: string; staff: boolean; note: string; createdAt: number }
  interface ReviewRec { id: string; orderId: string; authorId: string; targetId: string; rating: number; comment: string; createdAt: number }
  interface ReportRec { id: string; reporterId: string; targetType: ReportTarget; targetId: string; reason: ReportReason; details: string; status: ReportStatus; createdAt: number }
  const disputes = new Map<string, DisputeRec>();
  const disputeNotes: NoteRec[] = [];
  const reviews: ReviewRec[] = [];
  const reports = new Map<string, ReportRec>();
  const suspensions: { userId: string; endsAt: number }[] = [];
  const convs = new Map<string, ConvRec>();
  const messages: MsgRec[] = [];

  if (opts.seed !== false) {
    const t = now();
    seedUsers(t).forEach((u) => users.set(u.id, u));
    seedItems(t, areas).forEach((i) => items.set(i.id, i));
  }

  // ----------------------------------------------------------------- utilitaires
  const post = (entries: NewEntry[]) => {
    assertBalanced(entries);
    for (const e of entries) ledger.push({ ...e, id: randomUUID(), createdAt: now() });
  };
  const ctx = (refType: LedgerEntry["refType"], refId: string, currency: Currency) => ({ txnId: randomUUID(), refType, refId, currency });
  const byPhone = (phone: string) => [...users.values()].find((u) => u.phone === phone) ?? null;
  const notFound = (what: string) => new AppError("NOT_FOUND", `${what} introuvable.`, 404);

  const publicProfile = (u: User): PublicProfile => ({
    id: u.id, displayName: u.displayName, bio: u.bio, areaId: u.areaId,
    verificationLevel: u.verificationLevel, ratingAvg: u.ratingAvg, ratingCount: u.ratingCount,
  });
  const profileOf = (id: string): PublicProfile => {
    const u = users.get(id);
    return u ? publicProfile(u) : { id, displayName: "Membre supprimé", bio: "", areaId: null, verificationLevel: "none", ratingAvg: null, ratingCount: 0 };
  };

  function schedule(ev: ProviderEvent) {
    if (!autoComplete) {
      queue.push(ev);
      return;
    }
    const timer = setTimeout(() => void api.handleProviderEvent(ev).catch(() => undefined), delay);
    (timer as { unref?: () => void }).unref?.();
  }

  function setOrderStatus(order: Order, to: Order["status"]) {
    assertTransition(order.status, to);
    order.status = to;
    // Équivalent des triggers orders_close_items : libère ou solde les articles.
    if (to === "cancelled" || to === "expired" || to === "refunded") {
      for (const id of order.itemIds) {
        openItem.delete(id);
        const it = items.get(id);
        if (it && it.status === "reserved") it.status = "active";
      }
    } else if (to === "completed") {
      for (const id of order.itemIds) {
        openItem.delete(id);
        const it = items.get(id);
        if (it) it.status = "sold";
      }
    }
  }

  function release(order: Order) {
    post(releaseEntries(ctx("order", order.id, order.currency), {
      sellerId: order.sellerId, itemsMinor: order.itemsMinor, shippingMinor: order.shippingMinor, feeMinor: order.protectionFeeMinor,
    }));
  }

  function toCard(it: Item, from?: { lat: number; lng: number }): ItemCard {
    const meta = [it.brand, it.sizeLabel, CONDITIONS.find((c) => c.value === it.condition)?.label].filter(Boolean).join(" · ");
    return {
      id: it.id, title: it.title, priceMinor: it.priceMinor, currency: it.currency,
      protectedPriceMinor: it.priceMinor + protectionFee(it.priceMinor, it.currency),
      status: it.status, photo: it.photos[0] ?? null, meta,
      areaName: areas.find((a) => a.id === it.areaId)?.name ?? null,
      distanceKm: from && it.lat != null && it.lng != null ? Math.round(distanceKm(from.lat, from.lng, it.lat, it.lng) * 10) / 10 : null,
    };
  }

  // ---- agent D : livraison par coursier
  function logShipment(ship: ShipmentRec, kind: ShipmentEventKind, note: string | null = null) {
    ship.events.push({ id: randomUUID(), kind, at: now(), note });
  }
  function shipmentView(order: Order): ShipmentView | null {
    const ship = order.deliveryMethod === "courier" ? shipments.get(order.id) : undefined;
    if (!ship) return null;
    return {
      status: ship.status, courierName: ship.courierName, courierPhone: ship.courierPhone, trackingRef: ship.trackingRef,
      events: ship.events.map((e) => ({ ...e })),
    };
  }

  function view(order: Order, viewerId: string): OrderView {
    if (viewerId !== order.buyerId && viewerId !== order.sellerId) throw notFound("Commande");
    const role = viewerId === order.buyerId ? "buyer" : "seller";
    const pays = [...payments.values()].filter((p) => p.orderId === order.id).sort((a, b) => b.createdAt - a.createdAt);
    const pay = pays[0] ?? null;
    const ship = shipments.get(order.id);
    const actions: OrderAction[] = [];
    const live = order.status === "paid" || order.status === "in_delivery";
    const courier = order.deliveryMethod === "courier";
    if (role === "buyer") {
      if (order.status === "pending_payment") actions.push("pay", "cancel");
      if (live && !courier) actions.push("reveal_code", "cancel", "issue");
      // ---- agent D : livraison par coursier (pas de code ; le colis remis, l'acheteur ne peut plus annuler seul)
      if (live && courier) {
        if (order.status === "paid") actions.push("cancel", "issue");
        else actions.push("confirm_received", "report_lost", "issue");
      }
      if (order.status === "delivered") {
        actions.push("accept");
        if (order.autoReleaseAt == null || now() < order.autoReleaseAt) actions.push("issue");
      }
    } else {
      if (order.status === "pending_payment") actions.push("cancel");
      if (live && !courier) actions.push("confirm_delivery", "cancel", "issue");
      if (live && courier) {
        if (order.status === "paid") actions.push("ship", "cancel", "issue");
        else {
          if (ship?.status === "handed_to_courier") actions.push("mark_in_transit");
          actions.push("report_lost", "issue");
        }
      }
    }
    if (order.status === "completed" && !reviews.some((r) => r.orderId === order.id && r.authorId === viewerId)) actions.push("review");
    const dsp = [...disputes.values()].filter((d) => d.orderId === order.id).sort((a, b) => b.openedAt - a.openedAt)[0];
    return {
      ...order, viewerRole: role,
      items: order.itemIds.map((id) => {
        const it = items.get(id)!;
        return { id, title: it.title, photo: it.photos[0] ?? null, priceMinor: it.priceMinor, currency: it.currency };
      }),
      counterpart: profileOf(role === "buyer" ? order.sellerId : order.buyerId),
      payment: pay ? { id: pay.id, status: pay.status, method: pay.method, failureCode: pay.failureCode } : null,
      shipment: shipmentView(order),
      handover: role === "seller" && live && ship && !courier
        ? { attemptsLeft: Math.max(0, FEES.handoverMaxAttempts - ship.attempt.attempts), lockedUntil: ship.attempt.lockedUntil && ship.attempt.lockedUntil > now() ? ship.attempt.lockedUntil : null }
        : null,
      actions,
      dispute: dsp ? { id: dsp.id, status: dsp.status } : null,
    };
  }

  function loadConv(convId: string, viewerId: string): ConvRec {
    const c = convs.get(convId);
    if (!c || (c.buyerId !== viewerId && c.sellerId !== viewerId)) throw notFound("Conversation");
    return c;
  }

  function convSummary(c: ConvRec, viewerId: string): ConversationSummary {
    const it = items.get(c.itemId)!;
    const mine = messages.filter((m) => m.convId === c.id);
    const last = mine[mine.length - 1];
    return {
      id: c.id, itemId: c.itemId, itemTitle: it.title, itemPhoto: it.photos[0] ?? null,
      counterpart: profileOf(viewerId === c.buyerId ? c.sellerId : c.buyerId),
      lastMessage: last ? last.body.slice(0, 140) : null, lastMessageAt: c.lastMessageAt,
      unread: mine.filter((m) => m.senderId !== viewerId && m.readAt === null).length,
    };
  }

  const chatMessage = (m: MsgRec, viewerId: string): ChatMessage => ({
    id: m.id, mine: m.senderId === viewerId, kind: m.kind, body: m.body, flagged: m.flagged, createdAt: m.createdAt,
  });

  /** Rembourse intégralement l'acheteur depuis le séquestre (grand livre + fournisseur de paiement). */
  async function refundEscrow(order: Order) {
    post(refundEntries(ctx("order", order.id, order.currency), order.totalMinor));
    const pay = [...payments.values()].find((p) => p.orderId === order.id && p.status === "succeeded");
    if (pay) {
      pay.status = "refunded";
      if (pay.providerRef) await provider.refund({ providerRef: pay.providerRef, amountMinor: pay.amountMinor });
    }
  }

  function requireRole(userId: string, allowed: UserRole[]): User {
    const u = users.get(userId);
    if (!u || deleted.has(userId) || !allowed.includes(u.role ?? "member")) throw notFound("Ressource");
    return u;
  }

  function disputeView(d: DisputeRec, viewerId: string): DisputeView {
    const order = loadOrder(d.orderId);
    const staff = !!users.get(viewerId) && ["support", "admin"].includes(users.get(viewerId)!.role ?? "member");
    if (!staff && viewerId !== order.buyerId && viewerId !== order.sellerId) throw notFound("Litige");
    const it = items.get(order.itemIds[0]);
    return {
      id: d.id, orderId: d.orderId, status: d.status, reason: d.reason, description: d.description,
      openedByName: profileOf(d.openedBy).displayName, openedByMe: d.openedBy === viewerId, openedAt: d.openedAt, resolvedAt: d.resolvedAt,
      notes: disputeNotes.filter((n) => n.disputeId === d.id).sort((a, b) => a.createdAt - b.createdAt).map((n): DisputeNote => ({
        id: n.id, authorName: n.staff ? "Assistance" : profileOf(n.authorId).displayName, mine: n.authorId === viewerId, staff: n.staff, note: n.note, createdAt: n.createdAt,
      })),
      order: { itemTitle: it?.title ?? "Article", totalMinor: order.totalMinor, currency: order.currency, buyerName: profileOf(order.buyerId).displayName, sellerName: profileOf(order.sellerId).displayName },
      viewerRole: staff && viewerId !== order.buyerId && viewerId !== order.sellerId ? "staff" : viewerId === order.buyerId ? "buyer" : "seller",
    };
  }

  function reportView(r: ReportRec): ReportView {
    const label = r.targetType === "item" ? (items.get(r.targetId)?.title ?? "Annonce supprimée") : profileOf(r.targetId).displayName;
    return { id: r.id, targetType: r.targetType, targetId: r.targetId, targetLabel: label, reason: r.reason, details: r.details, reporterName: profileOf(r.reporterId).displayName, status: r.status, createdAt: r.createdAt };
  }

  function loadOrder(orderId: string): Order {
    const o = orders.get(orderId);
    if (!o) throw notFound("Commande");
    return o;
  }

  function validateMsisdn(raw: string): string {
    const p = normalizeDrcPhone(raw);
    if (!p) throw new AppError("PHONE_INVALID", "Numéro de téléphone invalide.", 422);
    return p;
  }

  // ------------------------------------------------------------------------ API
  const api: FakeData = {
    __provider: provider,
    __ledger: () => ledger,
    __pendingEvents: () => [...queue],
    async __flush() {
      while (queue.length) await api.handleProviderEvent(queue.shift()!);
    },

    // ---- authentification
    async requestOtp(phoneInput) {
      const phone = normalizeDrcPhone(phoneInput);
      if (!phone) throw new AppError("PHONE_INVALID", "Numéro de téléphone invalide.", 422);
      const t = now();
      const rec = otps.get(phone) ?? { code: OTP, expiresAt: 0, attempts: 0, sent: [] };
      rec.sent = rec.sent.filter((s) => t - s < 10 * 60_000);
      if (rec.sent.length >= 3) throw new AppError("OTP_RATE_LIMIT", "Trop de demandes. Réessaie dans quelques minutes.", 429);
      rec.sent.push(t);
      rec.code = OTP;
      rec.expiresAt = t + 5 * 60_000;
      rec.attempts = 0;
      otps.set(phone, rec);
      return { phone, devCode: process.env.NODE_ENV === "production" ? undefined : OTP };
    },

    async verifyOtp(phoneInput, code, displayName) {
      const phone = normalizeDrcPhone(phoneInput);
      if (!phone) throw new AppError("PHONE_INVALID", "Numéro de téléphone invalide.", 422);
      const rec = otps.get(phone);
      if (!rec || rec.expiresAt < now()) throw new AppError("OTP_EXPIRED", "Ce code a expiré. Demandes-en un nouveau.", 400);
      if (rec.attempts >= 5) throw new AppError("OTP_LOCKED", "Trop d'essais. Demande un nouveau code.", 429);
      if (code !== rec.code) {
        rec.attempts++;
        throw new AppError("OTP_WRONG", "Code incorrect.", 400);
      }
      let user = byPhone(phone);
      let isNew = false;
      if (!user) {
        const name = displayName?.trim() ?? "";
        if (name.length < 2 || name.length > 40) throw new AppError("NAME_REQUIRED", "Dis-nous comment t'appeler (2 à 40 caractères).", 422);
        user = { id: randomUUID(), phone, displayName: name, bio: "", areaId: null, verificationLevel: "phone", ratingAvg: null, ratingCount: 0, createdAt: now() };
        users.set(user.id, user);
        isNew = true;
      }
      otps.delete(phone);
      return { user, isNew };
    },

    async getUser(id) {
      const u = deleted.has(id) ? null : (users.get(id) ?? null);
      if (!u) return null;
      const until = Math.max(0, ...suspensions.filter((s) => s.userId === id && s.endsAt > now()).map((s) => s.endsAt));
      return { ...u, role: u.role ?? "member", suspendedUntil: until > 0 ? until : null };
    },
    async getPublicProfile(id) {
      const u = users.get(id);
      return u && !deleted.has(id) ? publicProfile(u) : null;
    },
    async updateMe(userId, patch) {
      const u = users.get(userId);
      if (!u) throw notFound("Compte");
      if (patch.displayName !== undefined) {
        const n = patch.displayName.trim();
        if (n.length < 2 || n.length > 40) throw new AppError("VALIDATION", "Le nom doit faire entre 2 et 40 caractères.", 422);
        u.displayName = n;
      }
      if (patch.bio !== undefined) u.bio = patch.bio.slice(0, 500);
      if (patch.areaId !== undefined) u.areaId = patch.areaId;
      return u;
    },

    // ---- sessions, limites, entretien
    async createSession(userId) {
      if (!users.has(userId) || deleted.has(userId)) throw notFound("Compte");
      const token = randomBytes(32).toString("base64url");
      const expiresAt = now() + 30 * 86400_000;
      sessions.set(sha256(token), { userId, expiresAt });
      return { token, expiresAt };
    },
    async getSessionUser(token) {
      const s = sessions.get(sha256(token));
      if (!s || s.expiresAt < now()) return null;
      return api.getUser(s.userId);
    },
    async deleteSession(token) {
      sessions.delete(sha256(token));
    },
    async deleteAllSessions(userId) {
      for (const [h, s] of sessions) if (s.userId === userId) sessions.delete(h);
    },
    async deleteAccount(userId) {
      const u = users.get(userId);
      if (!u || deleted.has(userId)) throw notFound("Compte");
      const open = [...orders.values()].some(
        (o) => (o.buyerId === userId || o.sellerId === userId) && !["completed", "refunded", "cancelled", "expired"].includes(o.status),
      );
      if (open) throw new AppError("ACCOUNT_HAS_OPEN_ORDERS", "Termine ou annule tes commandes en cours avant de supprimer ton compte.", 409);
      const w = await api.getWallet(userId);
      if (w.balances.some((b) => b.availableMinor > 0 || b.pendingMinor > 0))
        throw new AppError("ACCOUNT_HAS_FUNDS", "Retire l'argent de ton portefeuille avant de supprimer ton compte.", 409);
      for (const it of items.values()) if (it.sellerId === userId && (it.status === "active" || it.status === "draft")) it.status = "removed";
      u.displayName = "Membre supprimé";
      u.bio = "";
      u.phone = `deleted:${userId}`;
      u.areaId = null;
      deleted.add(userId);
      await api.deleteAllSessions(userId);
    },
    async getPhoto() {
      return null;
    },
    async health() {
      return { ok: true as const };
    },
    async rateLimit(key, limit, windowSec) {
      const t = now();
      const rec = limits.get(key);
      if (!rec || t - rec.start >= windowSec * 1000) {
        limits.set(key, { start: t, count: 1 });
        return { allowed: true, retryAfterSec: 0 };
      }
      rec.count++;
      return rec.count > limit
        ? { allowed: false, retryAfterSec: Math.max(1, Math.ceil((rec.start + windowSec * 1000 - t) / 1000)) }
        : { allowed: true, retryAfterSec: 0 };
    },
    async purgeExpired() {
      const t = now();
      let otp = 0, s = 0, r = 0;
      for (const [k, v] of otps) if (v.expiresAt < t) { otps.delete(k); otp++; }
      for (const [k, v] of sessions) if (v.expiresAt < t) { sessions.delete(k); s++; }
      for (const [k, v] of limits) if (t - v.start > 86_400_000) { limits.delete(k); r++; }
      return { otp, sessions: s, rateLimits: r };
    },
    async reconcilePendingPayments() {
      return 0; // le fournisseur factice appelle toujours son webhook
    },

    // ---- catalogue
    async listCategories() {
      return categories;
    },
    async listAreas(parentId) {
      return areas.filter((a) => (parentId === undefined ? true : a.parentId === parentId));
    },

    async listItems(q) {
      await api.expireUnpaidOrders();
      const centre = q.areaId ? areas.find((a) => a.id === q.areaId) : undefined;
      const from = q.lat != null && q.lng != null ? { lat: q.lat, lng: q.lng } : centre?.lat != null && centre.lng != null ? { lat: centre.lat, lng: centre.lng } : undefined;
      const tokens = norm(q.q ?? "").split(/\s+/).filter(Boolean);
      const catIds = q.categoryId ? new Set([q.categoryId, ...categories.filter((c) => c.parentId === q.categoryId).map((c) => c.id)]) : null;
      let list = [...items.values()].filter((it) => {
        if (it.status !== "active" && !(q.includeSold && (it.status === "sold" || it.status === "reserved"))) return false;
        if (q.sellerId && it.sellerId !== q.sellerId) return false;
        if (catIds && !catIds.has(it.categoryId)) return false;
        if (tokens.length) {
          const hay = norm(`${it.title} ${it.brand ?? ""} ${it.description}`);
          if (!tokens.every((t) => hay.includes(t))) return false;
        }
        if (q.brand && !norm(it.brand ?? "").includes(norm(q.brand))) return false;
        if (q.sizeLabel && norm(it.sizeLabel ?? "") !== norm(q.sizeLabel)) return false;
        if (q.conditions?.length && !q.conditions.includes(it.condition)) return false;
        const usd = it.currency === "USD" ? it.priceMinor : Math.round(it.priceMinor / 2800);
        if (q.minPriceUsdMinor != null && usd < q.minPriceUsdMinor) return false;
        if (q.maxPriceUsdMinor != null && usd > q.maxPriceUsdMinor) return false;
        if (q.radiusKm != null && from) {
          if (it.lat == null || it.lng == null) return false;
          if (distanceKm(from.lat, from.lng, it.lat, it.lng) > q.radiusKm) return false;
        }
        return true;
      });
      if (q.radiusKm != null && from)
        list.sort((a, b) => distanceKm(from.lat, from.lng, a.lat!, a.lng!) - distanceKm(from.lat, from.lng, b.lat!, b.lng!));
      else list.sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0));
      list = list.slice(0, q.limit ?? 60);
      return list.map((it) => toCard(it, q.radiusKm != null ? from : undefined));
    },

    async getItem(id, viewerId) {
      const it = items.get(id);
      if (!it) return null;
      if ((it.status === "draft" || it.status === "hidden" || it.status === "removed") && it.sellerId !== viewerId) return null;
      const seller = users.get(it.sellerId);
      if (!seller) return null;
      const detail: ItemDetail = {
        ...toCard(it), brand: it.brand, sizeLabel: it.sizeLabel, description: it.description, photos: it.photos, condition: it.condition,
        categoryName: categories.find((c) => c.id === it.categoryId)?.name ?? "", seller: publicProfile(seller), sellerId: it.sellerId,
      };
      return detail;
    },

    async createDraft(sellerId, input: ListingInput) {
      if (!users.has(sellerId)) throw notFound("Compte");
      const photos = input.photos ?? [];
      if (photos.length > FEES.maxPhotos) throw new AppError("VALIDATION", `Tu peux ajouter ${FEES.maxPhotos} photos au maximum.`, 422, { photos: `Maximum ${FEES.maxPhotos} photos.` });
      for (const p of photos) {
        if (!PHOTO_RE.test(p) || p.length > 600_000)
          throw new AppError("VALIDATION", "Une photo est invalide ou trop lourde.", 422, { photos: "Photo invalide ou trop lourde (JPEG, PNG ou WebP, compressée)." });
      }
      const area = input.areaId ? areas.find((a) => a.id === input.areaId) : undefined;
      const item: Item = {
        id: randomUUID(), sellerId, categoryId: input.categoryId, title: (input.title ?? "").trim(),
        description: input.description ?? "", condition: input.condition as Item["condition"],
        sizeLabel: input.sizeLabel?.trim() || null, brand: input.brand?.trim() || null,
        priceMinor: input.priceMinor, currency: input.currency as Currency, status: "draft",
        areaId: area?.id ?? null, lat: area?.lat != null ? coarsen(area.lat) : null, lng: area?.lng != null ? coarsen(area.lng) : null,
        photos, publishedAt: null, createdAt: now(),
      };
      items.set(item.id, item);
      return item;
    },

    async publishItem(sellerId, itemId) {
      const it = items.get(itemId);
      if (!it || it.sellerId !== sellerId) throw notFound("Annonce");
      if (it.status !== "draft") throw new AppError("INVALID_STATE", "Cette annonce est déjà publiée.", 409);
      const errors = validateListing(
        { title: it.title, description: it.description, categoryId: it.categoryId, condition: it.condition, sizeLabel: it.sizeLabel,
          brand: it.brand, priceMinor: it.priceMinor, currency: it.currency, areaId: it.areaId, photos: it.photos },
        categories,
      );
      if (Object.keys(errors).length) throw new AppError("VALIDATION", "Corrige les champs signalés.", 422, errors as Record<string, string>);
      it.status = "active";
      it.publishedAt = now();
      return it;
    },

    // ---- commandes
    async expireUnpaidOrders() {
      let n = 0;
      for (const o of orders.values()) {
        if (o.status === "pending_payment" && o.paymentExpiresAt != null && o.paymentExpiresAt < now()) {
          setOrderStatus(o, "expired");
          n++;
        }
      }
      return n;
    },

    async createOrder(buyerId, input) {
      await api.expireUnpaidOrders();
      if (!users.has(buyerId)) throw notFound("Compte");
      if (input.deliveryMethod === "relay_point")
        throw new AppError("NOT_SUPPORTED", "La livraison en point relais n'est pas encore disponible.", 400);
      const ids = [...new Set(input.itemIds)];
      if (!ids.length) throw new AppError("VALIDATION", "Choisis au moins un article.", 422);
      const list = ids.map((id) => items.get(id));
      if (list.some((x) => !x)) throw notFound("Article");
      const its = list as Item[];
      if (its.some((i) => i.sellerId === buyerId)) throw new AppError("SELF_PURCHASE", "Tu ne peux pas acheter ton propre article.", 409);
      if (new Set(its.map((i) => i.sellerId)).size > 1) throw new AppError("MIXED_SELLERS", "Un achat groupé ne concerne qu'un seul vendeur.", 409);
      if (new Set(its.map((i) => i.currency)).size > 1) throw new AppError("MIXED_CURRENCY", "Les articles doivent être dans la même devise.", 409);
      // Réservation atomique : vérification de tous les articles puis écriture, sans point d'attente entre les deux.
      for (const i of its) {
        if (i.status !== "active" || openItem.has(i.id)) throw new AppError("ITEM_UNAVAILABLE", "Cet article n'est plus disponible.", 409);
      }
      const currency = its[0].currency;
      const itemsMinor = its.reduce((s, i) => s + i.priceMinor, 0);
      const fee = protectionFee(itemsMinor, currency);
      // ---- agent D : livraison par coursier (commune de l'acheteur + repère obligatoires, frais selon la grille)
      let shippingMinor = 0;
      if (input.deliveryMethod === "courier") {
        const landmark = input.deliveryLandmark?.trim() ?? "";
        if (!input.deliveryAreaId || !areas.some((a) => a.id === input.deliveryAreaId && a.kind === "commune"))
          throw new AppError("VALIDATION", "Choisis ta commune pour la livraison.", 422, { deliveryAreaId: "Choisis ta commune pour la livraison." });
        if (landmark.length < 3)
          throw new AppError("VALIDATION", "Décris un repère pour le coursier (3 caractères au moins).", 422, { deliveryLandmark: "Décris un repère pour le coursier (3 caractères au moins)." });
        shippingMinor = shippingFee(shippingZone(its[0].areaId ?? users.get(its[0].sellerId)?.areaId, input.deliveryAreaId, areas), currency);
      }
      const order: Order = {
        id: randomUUID(), buyerId, sellerId: its[0].sellerId, status: "pending_payment", currency,
        itemsMinor, shippingMinor, protectionFeeMinor: fee, totalMinor: itemsMinor + shippingMinor + fee, autoReleaseAt: null,
        deliveryMethod: input.deliveryMethod, deliveryAreaId: input.deliveryAreaId ?? null,
        deliveryLandmark: input.deliveryLandmark?.trim().slice(0, 200) || null, itemIds: ids,
        paymentExpiresAt: now() + FEES.orderPaymentTtlMs, paidAt: null, deliveredAt: null, completedAt: null, cancelledAt: null, createdAt: now(),
      };
      orders.set(order.id, order);
      for (const i of its) {
        i.status = "reserved";
        openItem.set(i.id, order.id);
      }
      return order;
    },

    async getOrder(orderId, viewerId) {
      await api.expireUnpaidOrders();
      return view(loadOrder(orderId), viewerId);
    },

    async listMyOrders(userId) {
      await api.expireUnpaidOrders();
      return [...orders.values()]
        .filter((o) => o.buyerId === userId || o.sellerId === userId)
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((o) => view(o, userId));
    },

    async startPayment(orderId, buyerId, input) {
      await api.expireUnpaidOrders();
      const order = loadOrder(orderId);
      if (order.buyerId !== buyerId) throw notFound("Commande");
      const existing = [...payments.values()].find((p) => p.idempotencyKey === input.idempotencyKey);
      if (existing) {
        if (existing.orderId !== orderId) throw new AppError("IDEMPOTENCY_CONFLICT", "Clé d'idempotence déjà utilisée.", 409);
        return existing;
      }
      if (order.status === "expired") throw new AppError("ORDER_EXPIRED", "Le délai de paiement est dépassé.", 409);
      if (order.status !== "pending_payment") throw new AppError("INVALID_STATE", "Cette commande ne peut plus être payée.", 409);
      if (!METHODS.includes(input.method)) throw new AppError("VALIDATION", "Moyen de paiement non pris en charge.", 422);
      const msisdn = validateMsisdn(input.msisdn);
      const active = [...payments.values()].find((p) => p.orderId === orderId && (p.status === "initiated" || p.status === "pending_user"));
      if (active) throw new AppError("PAYMENT_IN_PROGRESS", "Un paiement est déjà en attente de validation sur ton téléphone.", 409);
      const pay: Payment = {
        id: randomUUID(), orderId, provider: provider.name, method: input.method, msisdn, amountMinor: order.totalMinor,
        currency: order.currency, status: "initiated", providerRef: null, idempotencyKey: input.idempotencyKey, failureCode: null, createdAt: now(),
      };
      payments.set(pay.id, pay);
      const { providerRef } = await provider.initiateCollection({
        orderId, paymentId: pay.id, amountMinor: pay.amountMinor, currency: pay.currency, method: pay.method, msisdn, idempotencyKey: pay.idempotencyKey,
      });
      pay.providerRef = providerRef;
      pay.status = "pending_user";
      const ok = FakeMobileMoneyProvider.outcomeFor(msisdn) === "succeeded";
      schedule({ eventId: `evt_${randomUUID()}`, type: ok ? "collection.succeeded" : "collection.failed", providerRef, failureCode: ok ? undefined : "INSUFFICIENT_FUNDS" });
      return pay;
    },

    async getPayment(orderId, buyerId) {
      const order = loadOrder(orderId);
      if (order.buyerId !== buyerId) throw notFound("Commande");
      return [...payments.values()].filter((p) => p.orderId === orderId).sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
    },

    async getHandoverCode(orderId, buyerId) {
      const order = loadOrder(orderId);
      if (order.buyerId !== buyerId) throw notFound("Commande");
      if (order.deliveryMethod === "courier") throw new AppError("INVALID_STATE", "La livraison par coursier n'utilise pas de code de remise.", 409);
      if (order.status !== "paid" && order.status !== "in_delivery" && order.status !== "delivered")
        throw new AppError("INVALID_STATE", "Le code est disponible une fois la commande payée.", 409);
      return deriveHandoverCode(orderId);
    },

    async confirmDelivery(orderId, sellerId, code) {
      const order = loadOrder(orderId);
      if (order.sellerId !== sellerId) throw notFound("Commande");
      if (order.status !== "paid" && order.status !== "in_delivery") throw new AppError("INVALID_STATE", "Cette commande n'attend pas de remise.", 409);
      if (order.deliveryMethod === "courier") throw new AppError("INVALID_STATE", "Cette commande est livrée par coursier : l'acheteur confirme la réception.", 409);
      const ship = shipments.get(orderId);
      if (!ship) throw new AppError("INVALID_STATE", "Aucune remise en cours pour cette commande.", 409);
      const ok = codesEqual(deriveHandoverCode(orderId), (code ?? "").trim());
      const r = checkAttempt(ship.attempt, ok, now(), FEES.handoverMaxAttempts, FEES.handoverLockMs);
      ship.attempt = r.state;
      if (r.result === "locked") throw new AppError("CODE_LOCKED", "Trop d'essais. Réessaie dans quelques minutes.", 429);
      if (r.result === "wrong") {
        const left = FEES.handoverMaxAttempts - r.state.attempts;
        throw new AppError("CODE_WRONG", `Code incorrect. Il te reste ${left} essai${left > 1 ? "s" : ""}.`, 400);
      }
      // Le code vaut acceptation : livré puis terminé, l'argent est libéré au vendeur.
      ship.status = "delivered";
      ship.confirmedBy = "buyer_code";
      setOrderStatus(order, "delivered");
      order.deliveredAt = now();
      setOrderStatus(order, "completed");
      order.completedAt = now();
      release(order);
      return view(order, sellerId);
    },

    async acceptOrder(orderId, buyerId) {
      const order = loadOrder(orderId);
      if (order.buyerId !== buyerId) throw notFound("Commande");
      if (order.status !== "delivered") throw new AppError("INVALID_STATE", "Tu pourras accepter l'article une fois qu'il est livré.", 409);
      setOrderStatus(order, "completed");
      order.completedAt = now();
      release(order);
      return view(order, buyerId);
    },

    async cancelOrder(orderId, actorId) {
      const order = loadOrder(orderId);
      if (order.buyerId !== actorId && order.sellerId !== actorId) throw notFound("Commande");
      if (order.status === "pending_payment") {
        setOrderStatus(order, "cancelled");
        order.cancelledAt = now();
      } else if (order.status === "paid" || order.status === "in_delivery") {
        // ---- agent D : colis remis au coursier, l'acheteur ne peut plus annuler seul (colis perdu ou litige à la place)
        if (order.status === "in_delivery" && order.deliveryMethod === "courier" && actorId === order.buyerId)
          throw new AppError("INVALID_STATE", "Le colis est parti : signale-le comme non reçu ou ouvre un litige.", 409);
        // Non remis : remboursement intégral de l'acheteur.
        await refundEscrow(order);
        setOrderStatus(order, "cancelled");
        order.cancelledAt = now();
      } else {
        throw new AppError("INVALID_STATE", "Cette commande ne peut plus être annulée.", 409);
      }
      return view(order, actorId);
    },

    async handleProviderEvent(ev) {
      const key = `${provider.name}:${ev.eventId}`;
      if (seenEvents.has(key)) return { duplicate: true };
      const known = ev.type.startsWith("collection.")
        ? [...payments.values()].some((p) => p.providerRef === ev.providerRef)
        : [...payouts.values()].some((p) => p.providerRef === ev.providerRef);
      if (!known) return { duplicate: false, matched: false };
      seenEvents.add(key);
      await api.expireUnpaidOrders();

      if (ev.type === "collection.succeeded" || ev.type === "collection.failed") {
        const pay = [...payments.values()].find((p) => p.providerRef === ev.providerRef);
        if (!pay) return { duplicate: false };
        if (pay.status === "succeeded" || pay.status === "refunded") return { duplicate: true };
        const order = orders.get(pay.orderId)!;
        if (ev.type === "collection.failed") {
          pay.status = "failed";
          pay.failureCode = ev.failureCode ?? "DECLINED";
          return { duplicate: false };
        }
        pay.status = "succeeded";
        if (order.status === "pending_payment") {
          setOrderStatus(order, "paid");
          order.paidAt = now();
          post(holdEntries(ctx("payment", pay.id, order.currency), order.totalMinor));
          const code = deriveHandoverCode(order.id);
          const ship: ShipmentRec = {
            orderId: order.id, status: "pending", attempt: { attempts: 0, lockedUntil: null }, codeHash: order.deliveryMethod === "courier" ? "" : hashCode(code), confirmedBy: null,
            courierName: null, courierPhone: null, trackingRef: null, events: [],
          };
          if (order.deliveryMethod === "courier") logShipment(ship, "paid");
          shipments.set(order.id, ship);
        } else {
          // Paiement arrivé APRÈS expiration ou annulation : on ne garde jamais l'argent, remboursement automatique.
          post(holdEntries(ctx("payment", pay.id, order.currency), pay.amountMinor));
          post(refundEntries(ctx("payment", pay.id, order.currency), pay.amountMinor));
          pay.status = "refunded";
          if (pay.providerRef) await provider.refund({ providerRef: pay.providerRef, amountMinor: pay.amountMinor });
        }
        return { duplicate: false };
      }

      const payout = [...payouts.values()].find((p) => p.providerRef === ev.providerRef);
      if (!payout) return { duplicate: false };
      if (payout.status === "paid" || payout.status === "failed") return { duplicate: true };
      if (ev.type === "payout.succeeded") {
        payout.status = "paid";
        payout.paidAt = now();
        post(payoutPaidEntries(ctx("payout", payout.id, payout.currency), { userId: payout.userId, amountMinor: payout.amountMinor }));
      } else {
        payout.status = "failed";
        payout.failureCode = ev.failureCode ?? "FAILED";
        post(payoutFailedEntries(ctx("payout", payout.id, payout.currency), { userId: payout.userId, amountMinor: payout.amountMinor, feeMinor: payout.feeMinor }));
      }
      return { duplicate: false };
    },

    // ---- portefeuille
    async startConversation(buyerId, itemId) {
      const u = users.get(buyerId);
      if (!u || deleted.has(buyerId)) throw notFound("Compte");
      const it = items.get(itemId);
      if (!it || !["active", "reserved", "sold"].includes(it.status)) throw notFound("Annonce");
      if (it.sellerId === buyerId) throw new AppError("OWN_ITEM", "C'est ton annonce : tu ne peux pas t'écrire à toi-même.", 409);
      if (deleted.has(it.sellerId)) throw new AppError("MEMBER_DELETED", "Ce membre a supprimé son compte.", 409);
      const existing = [...convs.values()].find((c) => c.itemId === itemId && c.buyerId === buyerId);
      if (existing) return { id: existing.id, created: false };
      const c: ConvRec = { id: randomUUID(), itemId, buyerId, sellerId: it.sellerId, lastMessageAt: null, createdAt: now() };
      convs.set(c.id, c);
      return { id: c.id, created: true };
    },

    async listConversations(userId) {
      return [...convs.values()]
        .filter((c) => c.buyerId === userId || c.sellerId === userId)
        .map((c) => convSummary(c, userId))
        .sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0));
    },

    async getConversation(conversationId, viewerId) {
      const c = loadConv(conversationId, viewerId);
      const mine = messages.filter((m) => m.convId === c.id);
      for (const m of mine) if (m.senderId !== viewerId && m.readAt === null) m.readAt = now();
      return { ...convSummary(c, viewerId), messages: mine.map((m) => chatMessage(m, viewerId)) };
    },

    async sendMessage(conversationId, senderId, body) {
      const c = loadConv(conversationId, senderId);
      const text = body.trim();
      if (text.length < 1) throw new AppError("VALIDATION", "Écris un message.", 422, { body: "Écris un message." });
      if (text.length > MESSAGE_MAX) throw new AppError("VALIDATION", "Un message est limité à 2 000 caractères.", 422, { body: "Un message est limité à 2 000 caractères." });
      const other = senderId === c.buyerId ? c.sellerId : c.buyerId;
      if (deleted.has(other)) throw new AppError("MEMBER_DELETED", "Ce membre a supprimé son compte.", 409);
      const m: MsgRec = { id: randomUUID(), convId: c.id, senderId, kind: "text", body: text, flagged: detectOffPlatform(text) !== null, readAt: null, createdAt: now() };
      messages.push(m);
      c.lastMessageAt = m.createdAt;
      return chatMessage(m, senderId);
    },

    async openDispute(orderId, userId, input) {
      const order = loadOrder(orderId);
      if (order.buyerId !== userId && order.sellerId !== userId) throw notFound("Commande");
      if (order.status === "disputed") throw new AppError("DISPUTE_EXISTS", "Un litige est déjà ouvert sur cette commande.", 409);
      if (order.status === "delivered") {
        // ---- agent D : après « reçu » (livraison par coursier), litige possible pour l'acheteur seul, pendant la fenêtre de réclamation
        if (order.buyerId !== userId) throw new AppError("INVALID_STATE", "Après la livraison, seul l'acheteur peut ouvrir un litige.", 409);
        if (order.autoReleaseAt == null || now() >= order.autoReleaseAt) throw new AppError("INVALID_STATE", "La fenêtre de réclamation est terminée.", 409);
      } else if (order.status !== "paid" && order.status !== "in_delivery") throw new AppError("INVALID_STATE", "Un litige ne peut être ouvert que sur une commande payée et pas encore remise.", 409);
      const text = input.description.trim();
      if (text.length < 10) throw new AppError("VALIDATION", "Décris le problème en quelques mots (10 caractères au moins).", 422, { description: "Décris le problème en quelques mots (10 caractères au moins)." });
      if (text.length > 2000) throw new AppError("VALIDATION", "La description est limitée à 2 000 caractères.", 422, { description: "La description est limitée à 2 000 caractères." });
      if (!["not_received", "damaged", "not_as_described", "other"].includes(input.reason)) throw new AppError("VALIDATION", "Choisis le motif du problème.", 422, { reason: "Choisis le motif du problème." });
      setOrderStatus(order, "disputed");
      const d: DisputeRec = { id: randomUUID(), orderId, openedBy: userId, reason: input.reason, description: text, status: "open", openedAt: now(), resolvedAt: null };
      disputes.set(d.id, d);
      return disputeView(d, userId);
    },

    async getOrderDispute(orderId, viewerId) {
      const order = loadOrder(orderId);
      if (order.buyerId !== viewerId && order.sellerId !== viewerId) throw notFound("Commande");
      const d = [...disputes.values()].filter((x) => x.orderId === orderId).sort((a, b) => b.openedAt - a.openedAt)[0];
      return d ? disputeView(d, viewerId) : null;
    },

    async getDisputeById(disputeId, viewerId) {
      const d = disputes.get(disputeId);
      if (!d) throw notFound("Litige");
      return disputeView(d, viewerId);
    },

    async addDisputeNote(disputeId, authorId, note) {
      const d = disputes.get(disputeId);
      if (!d) throw notFound("Litige");
      const view0 = disputeView(d, authorId); // 404 pour un tiers
      if (d.status !== "open") throw new AppError("INVALID_STATE", "Ce litige est clos.", 409);
      const text = note.trim();
      if (text.length < 1 || text.length > 1000) throw new AppError("VALIDATION", "Un message fait entre 1 et 1 000 caractères.", 422, { note: "Un message fait entre 1 et 1 000 caractères." });
      disputeNotes.push({ id: randomUUID(), disputeId, authorId, staff: view0.viewerRole === "staff", note: text, createdAt: now() });
      return disputeView(d, authorId);
    },

    async listOpenDisputes(staffId) {
      requireRole(staffId, ["support", "admin"]);
      return [...disputes.values()].filter((d) => d.status === "open").sort((a, b) => a.openedAt - b.openedAt).map((d): DisputeSummary => {
        const o = loadOrder(d.orderId);
        return { id: d.id, orderId: d.orderId, reason: d.reason, openedAt: d.openedAt, itemTitle: items.get(o.itemIds[0])?.title ?? "Article", totalMinor: o.totalMinor, currency: o.currency };
      });
    },

    async resolveDispute(staffId, disputeId, outcome: DisputeOutcome, note) {
      requireRole(staffId, ["support", "admin"]);
      const d = disputes.get(disputeId);
      if (!d) throw notFound("Litige");
      if (d.status !== "open") throw new AppError("INVALID_STATE", "Ce litige est déjà clos.", 409);
      const order = loadOrder(d.orderId);
      if (order.status !== "disputed") throw new AppError("INVALID_STATE", "La commande n'est plus en litige.", 409);
      if (outcome === "refund_buyer") {
        await refundEscrow(order);
        setOrderStatus(order, "refunded");
        d.status = "resolved_refund";
      } else {
        const ship = shipments.get(order.id);
        if (ship) { ship.status = "delivered"; ship.confirmedBy = "auto"; }
        setOrderStatus(order, "completed");
        order.deliveredAt = order.deliveredAt ?? now();
        order.completedAt = now();
        release(order);
        d.status = "resolved_release";
      }
      d.resolvedAt = now();
      const text = (note ?? "").trim();
      if (text) disputeNotes.push({ id: randomUUID(), disputeId, authorId: staffId, staff: true, note: text.slice(0, 1000), createdAt: now() });
      return disputeView(d, staffId);
    },

    async expireStalePaidOrders() {
      let n = 0;
      for (const o of orders.values()) {
        // Un colis déjà remis au coursier relève de refundStaleCourierOrders (délai propre), pas de ce filet.
        if ((o.status === "paid" || o.status === "in_delivery") && !(o.status === "in_delivery" && o.deliveryMethod === "courier") && o.paidAt != null && now() - o.paidAt >= FEES.unhandedOrderMs) {
          await refundEscrow(o);
          setOrderStatus(o, "cancelled");
          o.cancelledAt = now();
          n++;
        }
      }
      return n;
    },

    async createReview(orderId, authorId, input) {
      const order = loadOrder(orderId);
      if (order.buyerId !== authorId && order.sellerId !== authorId) throw notFound("Commande");
      if (order.status !== "completed") throw new AppError("INVALID_STATE", "Tu pourras donner ton avis une fois la vente terminée.", 409);
      if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) throw new AppError("VALIDATION", "Choisis une note de 1 à 5.", 422, { rating: "Choisis une note de 1 à 5." });
      const comment = input.comment.trim();
      if (comment.length > 500) throw new AppError("VALIDATION", "Un avis est limité à 500 caractères.", 422, { comment: "Un avis est limité à 500 caractères." });
      if (reviews.some((r) => r.orderId === orderId && r.authorId === authorId)) throw new AppError("REVIEW_EXISTS", "Tu as déjà donné ton avis sur cette commande.", 409);
      const targetId = authorId === order.buyerId ? order.sellerId : order.buyerId;
      const r: ReviewRec = { id: randomUUID(), orderId, authorId, targetId, rating: input.rating, comment, createdAt: now() };
      reviews.push(r);
      const t = users.get(targetId);
      if (t) {
        // Arithmétique entière (centièmes) : comme numeric côté PostgreSQL, sans erreur d'arrondi flottante.
        const totalHundredths = Math.round((t.ratingAvg ?? 0) * 100) * t.ratingCount + input.rating * 100;
        t.ratingCount += 1;
        t.ratingAvg = Math.round(totalHundredths / t.ratingCount) / 100;
      }
      return { id: r.id, orderId, authorName: profileOf(authorId).displayName, rating: r.rating, comment: r.comment, createdAt: r.createdAt };
    },

    async getMyReview(orderId, authorId) {
      const order = loadOrder(orderId);
      if (order.buyerId !== authorId && order.sellerId !== authorId) throw notFound("Commande");
      const r = reviews.find((x) => x.orderId === orderId && x.authorId === authorId);
      return r ? { id: r.id, orderId, authorName: profileOf(authorId).displayName, rating: r.rating, comment: r.comment, createdAt: r.createdAt } : null;
    },

    async listReviews(userId) {
      return reviews.filter((r) => r.targetId === userId).sort((a, b) => b.createdAt - a.createdAt).slice(0, 30)
        .map((r) => ({ id: r.id, orderId: r.orderId, authorName: profileOf(r.authorId).displayName, rating: r.rating, comment: r.comment, createdAt: r.createdAt }));
    },

    async createReport(reporterId, input) {
      if (!users.has(reporterId) || deleted.has(reporterId)) throw notFound("Compte");
      if (input.targetType === "item") {
        const it = items.get(input.targetId);
        if (!it || it.status === "draft" || it.status === "removed") throw notFound("Annonce");
        if (it.sellerId === reporterId) throw new AppError("OWN_TARGET", "Tu ne peux pas signaler ta propre annonce.", 409);
      } else {
        if (!users.has(input.targetId) || deleted.has(input.targetId)) throw notFound("Membre");
        if (input.targetId === reporterId) throw new AppError("OWN_TARGET", "Tu ne peux pas te signaler toi-même.", 409);
      }
      const details = input.details.trim();
      if (details.length > 1000) throw new AppError("VALIDATION", "Les précisions sont limitées à 1 000 caractères.", 422, { details: "Les précisions sont limitées à 1 000 caractères." });
      const dup = [...reports.values()].find((r) => r.reporterId === reporterId && r.targetType === input.targetType && r.targetId === input.targetId && r.status === "open");
      if (dup) return { id: dup.id, created: false };
      const r: ReportRec = { id: randomUUID(), reporterId, targetType: input.targetType, targetId: input.targetId, reason: input.reason, details, status: "open", createdAt: now() };
      reports.set(r.id, r);
      return { id: r.id, created: true };
    },

    async listReports(staffId, status = "open") {
      requireRole(staffId, ["moderator", "support", "admin"]);
      return [...reports.values()].filter((r) => r.status === status).sort((a, b) => a.createdAt - b.createdAt).map(reportView);
    },

    async handleReport(staffId, reportId, action: ReportAction) {
      requireRole(staffId, ["moderator", "support", "admin"]);
      const r = reports.get(reportId);
      if (!r) throw notFound("Signalement");
      if (r.status !== "open") throw new AppError("INVALID_STATE", "Ce signalement est déjà traité.", 409);
      if (action === "dismiss") {
        r.status = "dismissed";
      } else if (action === "hide_item") {
        if (r.targetType !== "item") throw new AppError("VALIDATION", "Seule une annonce peut être masquée.", 422);
        const it = items.get(r.targetId);
        if (it && it.status === "active") it.status = "hidden";
        r.status = "actioned";
      } else {
        const userId = r.targetType === "user" ? r.targetId : items.get(r.targetId)?.sellerId;
        if (!userId) throw notFound("Membre");
        suspensions.push({ userId, endsAt: now() + 7 * 86_400_000 });
        await api.deleteAllSessions(userId);
        r.status = "actioned";
      }
      return reportView(r);
    },

    async getWallet(userId) {
      const mine = ledger.filter((e) => e.userId === userId && e.account === "seller_available");
      const balances = (["USD", "CDF"] as Currency[])
        .map((currency) => ({ currency, availableMinor: sellerAvailable(ledger, userId, currency), pendingMinor: sellerPending(ledger, userId, currency) }))
        .filter((b) => b.availableMinor !== 0 || b.pendingMinor !== 0 || mine.some((e) => e.currency === b.currency));
      const entries = mine
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((e) => ({
          id: e.id, at: e.createdAt, currency: e.currency, amountMinor: -e.amountMinor,
          label: e.refType === "order" ? "Vente" : e.refType === "payout" ? (e.amountMinor > 0 ? "Retrait" : "Retrait annulé") : "Ajustement",
        }));
      return { balances, entries };
    },

    async requestPayout(userId, input) {
      const dup = [...payouts.values()].find((p) => p.idempotencyKey === input.idempotencyKey);
      if (dup) {
        if (dup.userId !== userId) throw new AppError("IDEMPOTENCY_CONFLICT", "Clé d'idempotence déjà utilisée.", 409);
        return dup;
      }
      if (!users.has(userId)) throw notFound("Compte");
      if (input.currency !== "USD" && input.currency !== "CDF") throw new AppError("VALIDATION", "Devise non prise en charge.", 422);
      if (!METHODS.includes(input.method)) throw new AppError("VALIDATION", "Moyen de retrait non pris en charge.", 422);
      const msisdn = validateMsisdn(input.msisdn);
      const amount = input.amountMinor;
      if (!Number.isInteger(amount) || amount <= 0) throw new AppError("VALIDATION", "Indique un montant valide.", 422);
      if (input.currency === "CDF" && amount % 100 !== 0) throw new AppError("VALIDATION", "Le montant en francs doit être un nombre entier.", 422);
      if (amount < FEES.payout.minMinor[input.currency]) throw new AppError("BELOW_MINIMUM", "Le montant est inférieur au minimum de retrait.", 422);
      const fee = payoutFee(amount);
      if (sellerAvailable(ledger, userId, input.currency) < amount + fee)
        throw new AppError("INSUFFICIENT_FUNDS", "Ton solde disponible est insuffisant (frais de retrait inclus).", 409);
      const payout: Payout = {
        id: randomUUID(), userId, amountMinor: amount, feeMinor: fee, currency: input.currency, method: input.method, msisdn,
        status: "requested", providerRef: null, idempotencyKey: input.idempotencyKey, failureCode: null, requestedAt: now(), paidAt: null,
      };
      payouts.set(payout.id, payout);
      post(payoutRequestEntries(ctx("payout", payout.id, payout.currency), { userId, amountMinor: amount, feeMinor: fee }));
      const { providerRef } = await provider.initiatePayout({
        payoutId: payout.id, amountMinor: amount, currency: payout.currency, method: input.method, msisdn, idempotencyKey: payout.idempotencyKey,
      });
      payout.providerRef = providerRef;
      payout.status = "processing";
      const ok = FakeMobileMoneyProvider.outcomeFor(msisdn) === "succeeded";
      schedule({ eventId: `evt_${randomUUID()}`, type: ok ? "payout.succeeded" : "payout.failed", providerRef, failureCode: ok ? undefined : "ACCOUNT_BLOCKED" });
      return payout;
    },

    async listPayouts(userId) {
      return [...payouts.values()].filter((p) => p.userId === userId).sort((a, b) => b.requestedAt - a.requestedAt);
    },

    // ---- agent D : livraison par coursier
    async quoteShipping(itemId, destAreaId): Promise<ShippingQuote> {
      const it = items.get(itemId);
      if (!it || (it.status !== "active" && it.status !== "reserved")) throw notFound("Annonce");
      if (!areas.some((a) => a.id === destAreaId && a.kind === "commune"))
        throw new AppError("VALIDATION", "Choisis ta commune pour la livraison.", 422, { areaId: "Choisis ta commune pour la livraison." });
      const zone = shippingZone(it.areaId ?? users.get(it.sellerId)?.areaId, destAreaId, areas);
      return { shippingMinor: shippingFee(zone, it.currency), currency: it.currency, zone };
    },

    async shipOrder(orderId, sellerId, input) {
      const order = loadOrder(orderId);
      if (order.sellerId !== sellerId) throw notFound("Commande");
      if (order.deliveryMethod !== "courier") throw new AppError("INVALID_STATE", "Cette commande est en remise en main propre.", 409);
      if (order.status !== "paid") throw new AppError("INVALID_STATE", "Tu pourras remettre le colis au coursier une fois la commande payée.", 409);
      const name = input.courierName.trim();
      if (name.length < 2 || name.length > 80) throw new AppError("VALIDATION", "Indique le nom du coursier.", 422, { courierName: "Indique le nom du coursier." });
      const phone = normalizeDrcPhone(input.courierPhone);
      if (!phone) throw new AppError("VALIDATION", "Numéro du coursier invalide.", 422, { courierPhone: "Numéro du coursier invalide." });
      const ship = shipments.get(orderId);
      if (!ship) throw new AppError("INVALID_STATE", "Aucune expédition pour cette commande.", 409);
      ship.courierName = name;
      ship.courierPhone = phone;
      ship.trackingRef = input.trackingRef?.trim().slice(0, 60) || null;
      ship.status = "handed_to_courier";
      logShipment(ship, "handed_to_courier");
      setOrderStatus(order, "in_delivery");
      return view(order, sellerId);
    },

    async markInTransit(orderId, sellerId) {
      const order = loadOrder(orderId);
      if (order.sellerId !== sellerId) throw notFound("Commande");
      const ship = shipments.get(orderId);
      if (order.deliveryMethod !== "courier" || !ship || order.status !== "in_delivery" || ship.status !== "handed_to_courier")
        throw new AppError("INVALID_STATE", "Le colis doit d'abord être remis au coursier.", 409);
      ship.status = "in_transit";
      logShipment(ship, "in_transit");
      return view(order, sellerId);
    },

    async confirmReceived(orderId, buyerId) {
      const order = loadOrder(orderId);
      if (order.buyerId !== buyerId) throw notFound("Commande");
      const ship = shipments.get(orderId);
      if (order.deliveryMethod !== "courier" || !ship) throw new AppError("INVALID_STATE", "Cette commande n'est pas livrée par coursier.", 409);
      if (order.status !== "in_delivery") throw new AppError("INVALID_STATE", "Le colis n'est pas encore parti : tu pourras confirmer la réception ensuite.", 409);
      ship.status = "delivered";
      ship.confirmedBy = "buyer";
      setOrderStatus(order, "delivered");
      order.deliveredAt = now();
      order.autoReleaseAt = now() + FEES.claimWindowMs;
      logShipment(ship, "received");
      return view(order, buyerId);
    },

    async reportParcelLost(orderId, userId, input) {
      const order = loadOrder(orderId);
      if (order.buyerId !== userId && order.sellerId !== userId) throw notFound("Commande");
      const ship = shipments.get(orderId);
      if (order.deliveryMethod !== "courier" || !ship) throw new AppError("INVALID_STATE", "Cette commande n'est pas livrée par coursier.", 409);
      if (order.status !== "in_delivery") throw new AppError("INVALID_STATE", "Le colis ne peut être signalé perdu qu'une fois remis au coursier et tant qu'il n'est pas reçu.", 409);
      const text = (input?.description ?? "").trim() || LOST_DEFAULT_TEXT;
      const d = await api.openDispute(orderId, userId, { reason: "not_received", description: text });
      ship.status = "lost_suspected";
      logShipment(ship, "lost_reported");
      return d;
    },

    async releaseDeliveredOrders(o) {
      const t = o?.at ?? now();
      let n = 0;
      for (const order of orders.values()) {
        if (order.status !== "delivered" || order.deliveryMethod !== "courier" || order.autoReleaseAt == null || order.autoReleaseAt > t) continue;
        setOrderStatus(order, "completed");
        order.completedAt = now();
        release(order);
        const ship = shipments.get(order.id);
        if (ship) logShipment(ship, "auto_released");
        n++;
      }
      return n;
    },

    async refundStaleCourierOrders(o) {
      const t = o?.at ?? now();
      let n = 0;
      for (const order of orders.values()) {
        if (order.status !== "in_delivery" || order.deliveryMethod !== "courier") continue;
        const ship = shipments.get(order.id);
        const handedAt = ship?.events.find((e) => e.kind === "handed_to_courier")?.at;
        if (!ship || handedAt == null || t - handedAt < FEES.courierStaleMs) continue;
        await refundEscrow(order);
        setOrderStatus(order, "cancelled");
        order.cancelledAt = now();
        ship.status = "lost_suspected";
        logShipment(ship, "auto_refunded");
        n++;
      }
      return n;
    },
  };

  return api;
}

export type { Wallet };

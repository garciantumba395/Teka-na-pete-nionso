import { randomUUID } from "node:crypto";
import { FEES, payoutFee, protectionFee } from "../fees";
import { assertTransition } from "../fsm";
import { coarsen, distanceKm } from "../geo";
import { codesEqual, checkAttempt, deriveHandoverCode, hashCode, type AttemptState } from "../handover";
import {
  assertBalanced, holdEntries, payoutFailedEntries, payoutPaidEntries, payoutRequestEntries, refundEntries,
  releaseEntries, sellerAvailable, sellerPending, type NewEntry,
} from "../ledger";
import { normalizeDrcPhone } from "../phone";
import { FakeMobileMoneyProvider } from "../payments/fake-provider";
import {
  AppError, type Area, type Category, type Currency, type Item, type ItemCard, type ItemDetail, type ItemQuery,
  type LedgerEntry, type Order, type OrderAction, type OrderView, type Payment, type PaymentMethod, type Payout,
  type ProviderEvent, type PublicProfile, type User, type Wallet,
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
  status: "pending" | "delivered";
  attempt: AttemptState;
  codeHash: string;
  confirmedBy: "buyer_code" | "courier" | "auto" | null;
}

const METHODS: PaymentMethod[] = ["mpesa", "orange_money", "airtel_money", "africell_money"];
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

  function view(order: Order, viewerId: string): OrderView {
    if (viewerId !== order.buyerId && viewerId !== order.sellerId) throw notFound("Commande");
    const role = viewerId === order.buyerId ? "buyer" : "seller";
    const pays = [...payments.values()].filter((p) => p.orderId === order.id).sort((a, b) => b.createdAt - a.createdAt);
    const pay = pays[0] ?? null;
    const ship = shipments.get(order.id);
    const actions: OrderAction[] = [];
    const live = order.status === "paid" || order.status === "in_delivery";
    if (role === "buyer") {
      if (order.status === "pending_payment") actions.push("pay", "cancel");
      if (live) actions.push("reveal_code", "cancel", "issue");
      if (order.status === "delivered") actions.push("accept", "issue");
    } else {
      if (order.status === "pending_payment") actions.push("cancel");
      if (live) actions.push("confirm_delivery", "cancel");
    }
    return {
      ...order, viewerRole: role,
      items: order.itemIds.map((id) => {
        const it = items.get(id)!;
        return { id, title: it.title, photo: it.photos[0] ?? null, priceMinor: it.priceMinor, currency: it.currency };
      }),
      counterpart: profileOf(role === "buyer" ? order.sellerId : order.buyerId),
      payment: pay ? { id: pay.id, status: pay.status, method: pay.method, failureCode: pay.failureCode } : null,
      handover: role === "seller" && live && ship
        ? { attemptsLeft: Math.max(0, FEES.handoverMaxAttempts - ship.attempt.attempts), lockedUntil: ship.attempt.lockedUntil && ship.attempt.lockedUntil > now() ? ship.attempt.lockedUntil : null }
        : null,
      actions,
    };
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
      return users.get(id) ?? null;
    },
    async getPublicProfile(id) {
      const u = users.get(id);
      return u ? publicProfile(u) : null;
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
        ...toCard(it), description: it.description, photos: it.photos, condition: it.condition,
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
      if (input.deliveryMethod !== "hand_delivery")
        throw new AppError("NOT_SUPPORTED", "Seule la remise en main propre est disponible pour l'instant.", 400);
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
      const order: Order = {
        id: randomUUID(), buyerId, sellerId: its[0].sellerId, status: "pending_payment", currency,
        itemsMinor, shippingMinor: 0, protectionFeeMinor: fee, totalMinor: itemsMinor + fee,
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
      if (order.status !== "paid" && order.status !== "in_delivery" && order.status !== "delivered")
        throw new AppError("INVALID_STATE", "Le code est disponible une fois la commande payée.", 409);
      return deriveHandoverCode(orderId);
    },

    async confirmDelivery(orderId, sellerId, code) {
      const order = loadOrder(orderId);
      if (order.sellerId !== sellerId) throw notFound("Commande");
      if (order.status !== "paid" && order.status !== "in_delivery") throw new AppError("INVALID_STATE", "Cette commande n'attend pas de remise.", 409);
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
        // Non remis : remboursement intégral de l'acheteur.
        post(refundEntries(ctx("order", order.id, order.currency), order.totalMinor));
        const pay = [...payments.values()].find((p) => p.orderId === orderId && p.status === "succeeded");
        if (pay) {
          pay.status = "refunded";
          if (pay.providerRef) await provider.refund({ providerRef: pay.providerRef, amountMinor: pay.amountMinor });
        }
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
          shipments.set(order.id, { orderId: order.id, status: "pending", attempt: { attempts: 0, lockedUntil: null }, codeHash: hashCode(code), confirmedBy: null });
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
  };

  return api;
}

export type { Wallet };

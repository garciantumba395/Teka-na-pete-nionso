import { createHash, createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { assertLotOrderable, buildCartView, CART_MAX_ITEMS, type CartRow } from "../../cart";
import { APP_NAME } from "../../copy";
import { COURIER_FEE_MODES, payoutFee, protectionFee, shippingFee, shippingZone, type CourierFeeMode, type ShippingZone } from "../../fees";
import { coarsen } from "../../geo";
import { checkAttempt, codesEqual, deriveHandoverCode, hashCode } from "../../handover";
import {
  assertBalanced, courierSettleEntries, holdEntries, payoutFailedEntries, payoutPaidEntries, payoutRequestEntries, refundEntries,
  releaseEntries, type NewEntry,
} from "../../ledger";
import { USD_CDF_PLACEHOLDER } from "../../money";
import { cleanFollowValue, followKey, followLimitError, FOLLOW_MAX, FOR_YOU_MAX, type Follows } from "../../discovery";
import { cleanLine } from "../../text";
import { FakeMobileMoneyProvider } from "../../payments/fake-provider";
import type { PaymentProvider } from "../../payments/provider";
import { detectOffPlatform, MESSAGE_MAX } from "../../messaging";
import { normalizeDrcPhone } from "../../phone";
import { decodePhotoDataUrl, MAX_EVIDENCE_PER_MEMBER, PHOTO_INVALID_MESSAGE, privatePhotoUrl } from "../../photos";
import {
  DEFAULT_SMS_PREFERENCES, NOTIFICATIONS_PAGE_LIMIT, NOTIFICATIONS_RETENTION_DAYS, SMS_DAILY_LIMIT, SMS_KIND_CATEGORY, smsText,
  type NotificationItem, type NotificationKind, type NotifySpec, type SmsPreferences,
} from "../../notifications";
import { ConsoleSmsProvider, type SmsProvider } from "../../sms/provider";
import {
  AppError, type Area, type Category, type ChatMessage, type Condition, type ConversationSummary, type DisputeNote, type DisputeOutcome, type DisputeSummary, type CourierDue, type DisputeView, type ReportAction, type ReportView, type Review, type UserRole, type Currency, type Item, type ItemCard, type ItemDetail, type LedgerEntry, type Order, type OrderAction, type OrderView, type CancelRequestStatus, type Payment, type PaymentMethod, type DisputeEvidence,
  type PaymentStatus, type Payout, type PayoutStatus, type ProviderEvent, type PublicProfile, type User, type Wallet,
  type ShipmentEventKind, type ShipmentView, type ShippingQuote,
} from "../../types";
import { CONDITIONS, validateListing } from "../../validation";
import type { DataLayer } from "../types";
import { UUID_RE } from "../ids";
import { pgCode, withTx, type Client, type Pool, type Queryable } from "./pool";
import { checkListingText, publicRule } from "../../prohibited";
import { createProhibitedLoader } from "./prohibited";
import { createSettingsLoader } from "./settings";

export interface PgOptions {
  now?: () => number;
  provider?: PaymentProvider;
  sms?: SmsProvider;
  /** true : le fournisseur factice « appelle le webhook » tout seul après providerDelayMs. false : manuel (tests). */
  autoComplete?: boolean;
  providerDelayMs?: number;
  /** Code SMS fixe pour la démonstration et les tests. Ignoré en production. */
  otpCode?: string;
  otpSecret?: string;
  settingsTtlMs?: number;
}

export interface PgData extends DataLayer {
  /** Crochets de test, absents de l'usage normal. */
  __pendingEvents(): ProviderEvent[];
  __flush(): Promise<void>;
  __provider: PaymentProvider;
  __sms: SmsProvider;
  /** Attend la fin des envois SMS de notification en cours (ils ne bloquent jamais les méthodes métier). */
  __settleSms(): Promise<void>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

const LOST_DEFAULT_TEXT = "Colis signalé perdu : il n'est pas arrivé à destination.";
const METHODS: PaymentMethod[] = ["mpesa", "orange_money", "airtel_money", "africell_money"];
const ONE_DAY = 86_400_000;
const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);
const ts = (n: number) => new Date(n);
const notFound = (what: string) => new AppError("NOT_FOUND", `${what} introuvable.`, 404);
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);
const photoUrl = (path: string) => (path.startsWith("db:") ? `/api/v1/photos/${path.slice(3)}` : path);

// ---- agent B : photos de preuve et de messagerie
const chatMessageOf = (m: Row, viewerId: string): ChatMessage => ({
  id: m.id, mine: m.sender_id === viewerId, kind: m.kind === "system" ? "system" : m.photo_id ? "image" : "text", body: m.body,
  photoUrl: m.photo_id ? privatePhotoUrl(m.photo_id) : null, senderName: m.sender_name ?? null, flagged: m.flagged, createdAt: m.created_at.getTime(),
});

const userOf = (r: Row): User => ({
  id: r.id, phone: r.phone ?? "", displayName: r.display_name, bio: r.bio ?? "", areaId: r.area_id,
  verificationLevel: r.verification_level, ratingAvg: r.rating_avg ?? null, ratingCount: r.rating_count, createdAt: r.created_at.getTime(),
  role: (r.role ?? "member") as UserRole, suspendedUntil: r.suspended_until ? r.suspended_until.getTime() : null,
});
const profileOf = (r: Row): PublicProfile => ({
  id: r.id, displayName: r.display_name, bio: r.bio ?? "", areaId: r.area_id,
  verificationLevel: r.verification_level, ratingAvg: r.rating_avg ?? null, ratingCount: r.rating_count,
});
const DELETED_PROFILE = (id: string): PublicProfile => ({
  id, displayName: "Membre supprimé", bio: "", areaId: null, verificationLevel: "none", ratingAvg: null, ratingCount: 0,
});
const orderOf = (r: Row): Order => ({
  id: r.id, buyerId: r.buyer_id, sellerId: r.seller_id, status: r.status, currency: r.currency,
  itemsMinor: r.items_minor, shippingMinor: r.shipping_minor, protectionFeeMinor: r.protection_fee_minor, totalMinor: r.total_minor,
  deliveryMethod: r.delivery_method, deliveryAreaId: r.delivery_area_id, deliveryLandmark: r.delivery_landmark,
  itemIds: r.item_ids ?? [], paymentExpiresAt: r.payment_expires_at?.getTime() ?? null, paidAt: r.paid_at?.getTime() ?? null,
  deliveredAt: r.delivered_at?.getTime() ?? null, completedAt: r.completed_at?.getTime() ?? null,
  cancelledAt: r.cancelled_at?.getTime() ?? null, createdAt: r.created_at.getTime(), autoReleaseAt: r.auto_release_at?.getTime() ?? null,
});
const paymentOf = (r: Row): Payment => ({
  id: r.id, orderId: r.order_id, provider: r.provider, method: r.method, msisdn: r.msisdn ?? "", amountMinor: r.amount_minor,
  currency: r.currency, status: r.status as PaymentStatus, providerRef: r.provider_ref, idempotencyKey: r.idempotency_key,
  failureCode: r.failure_code, createdAt: r.created_at.getTime(),
});
const payoutOf = (r: Row): Payout => ({
  id: r.id, userId: r.user_id, amountMinor: r.amount_minor, feeMinor: r.fee_minor, currency: r.currency, method: r.method,
  msisdn: r.msisdn, status: r.status as PayoutStatus, providerRef: r.provider_ref, idempotencyKey: r.idempotency_key,
  failureCode: r.failure_code, requestedAt: r.requested_at.getTime(), paidAt: r.paid_at?.getTime() ?? null,
});

export function createPgData(pool: Pool, opts: PgOptions = {}): PgData {
  const now = opts.now ?? Date.now;
  const provider = opts.provider ?? new FakeMobileMoneyProvider();
  const sms = opts.sms ?? new ConsoleSmsProvider();
  const autoComplete = opts.autoComplete ?? false;
  const delay = opts.providerDelayMs ?? 3000;
  const prod = process.env.NODE_ENV === "production";
  const fixedOtp = prod ? undefined : (opts.otpCode ?? process.env.DEV_FIXED_OTP);
  const otpSecret = opts.otpSecret ?? process.env.OTP_SECRET ?? "dev-only-otp-secret-change-me";
  const getFees = createSettingsLoader(pool, now, opts.settingsTtlMs ?? 30_000);

  // ---- agent J : lots
  async function cartOf(q: Queryable, userId: string, fees?: Awaited<ReturnType<typeof getFees>>) {
    const r = await q.query(
      `select ci.item_id, ci.added_at, i.title, i.price_minor, i.currency, i.status, i.seller_id, p.display_name as seller_name,
              (select storage_path from item_photos where item_id = i.id order by position limit 1) as path
       from cart_items ci join items i on i.id = ci.item_id join profiles p on p.id = i.seller_id
       where ci.user_id = $1`, [userId]);
    const rows: CartRow[] = r.rows.map((x) => ({
      itemId: x.item_id, title: x.title, photo: x.path ? photoUrl(x.path) : null, priceMinor: x.price_minor, currency: x.currency as Currency,
      status: x.status, sellerId: x.seller_id, sellerName: x.seller_name, addedAt: x.added_at.getTime(),
    }));
    return buildCartView(rows, fees ?? (await getFees()));
  }
  // ---- fin agent J
  const prohibited = createProhibitedLoader(pool, now, opts.settingsTtlMs ?? 30_000); // agent E
  const queue: ProviderEvent[] = [];

  const hashOtp = (phone: string, code: string) => createHmac("sha256", otpSecret).update(`${phone}:${code}`).digest("hex");
  const sameHash = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

  function schedule(ev: ProviderEvent) {
    if (!autoComplete) {
      queue.push(ev);
      return;
    }
    const timer = setTimeout(() => void api.handleProviderEvent(ev).catch((e) => console.error("[pg] événement fournisseur", e)), delay);
    (timer as { unref?: () => void }).unref?.();
  }

  async function post(c: Client, entries: NewEntry[]) {
    assertBalanced(entries);
    const at = ts(now());
    for (const e of entries) {
      await c.query(
        `insert into ledger_entries (txn_id, account, user_id, currency, amount_minor, ref_type, ref_id, created_at) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [e.txnId, e.account, e.userId, e.currency, e.amountMinor, e.refType, e.refId, at],
      );
    }
  }
  const ctx = (refType: LedgerEntry["refType"], refId: string, currency: Currency) => ({ txnId: randomUUID(), refType, refId, currency });

  async function walletBalance(q: Queryable, userId: string, account: "seller_available" | "payout_pending", currency: Currency): Promise<number> {
    const r = await q.query(`select coalesce(sum(amount_minor), 0) as s from ledger_entries where user_id = $1 and account = $2 and currency = $3`, [userId, account, currency]);
    return -Number(r.rows[0].s);
  }

  async function loadOrder(q: Queryable, id: string, lock = false): Promise<Order> {
    if (!isUuid(id)) throw notFound("Commande");
    const r = await q.query(
      `select o.*, array(select item_id from order_items where order_id = o.id order by item_id) as item_ids from orders o where o.id = $1 ${lock ? "for update of o" : ""}`,
      [id],
    );
    if (!r.rows[0]) throw notFound("Commande");
    return orderOf(r.rows[0]);
  }

  // ---- agent A : annulation encadrée
  const closePendingTx = (q: Queryable, orderId: string) =>
    q.query(`update order_cancel_requests set status = 'closed', resolved_at = $2 where order_id = $1 and status = 'pending'`, [orderId, ts(now())]);
  /** Commande verrouillée + rôle exigé : un participant sans ce rôle n'a pas l'action (404, comme confirmDelivery). */
  async function cancelCtx(c: Client, orderId: string, userId: string, role: "buyer" | "seller"): Promise<Order> {
    const order = await loadOrder(c, orderId, true);
    if (order.buyerId !== userId && order.sellerId !== userId) throw notFound("Commande");
    if ((role === "buyer" ? order.buyerId : order.sellerId) !== userId) throw notFound("Commande");
    if (order.status !== "paid" && order.status !== "in_delivery") throw new AppError("INVALID_STATE", "L'annulation ne concerne qu'une commande payée et pas encore remise.", 409);
    return order;
  }
  /** Demandes de la commande : une « pending » trop ancienne vaut refus (lecture seule, aucune écriture d'argent). */
  async function cancelRequestsOf(q: Queryable, orderId: string) {
    const ttl = (await getFees()).cancelRequestTtlMs;
    const rows = (await q.query(`select status, requested_at from order_cancel_requests where order_id = $1 order by requested_at desc, id`, [orderId])).rows;
    const recs = rows.map((r) => {
      const at = (r.requested_at as Date).getTime();
      const expired = r.status === "pending" && now() - at >= ttl;
      return { status: r.status as string, at, expired };
    });
    return { recs, ttl, livePending: recs.some((r) => r.status === "pending" && !r.expired), refused: recs.some((r) => r.status === "declined" || r.expired) };
  }
  const noOrExpired = (expired: boolean) => expired
    ? new AppError("CANCEL_REQUEST_EXPIRED", "Cette demande d'annulation est restée sans réponse trop longtemps : elle est close. L'acheteur peut ouvrir un litige.", 409)
    : new AppError("CANCEL_REQUEST_NONE", "Aucune demande d'annulation en attente sur cette commande.", 409);
  /** Lit la demande en attente (verrouillée) ; lève si elle n'existe pas ou a expiré. */
  async function pendingRequestTx(c: Client, orderId: string): Promise<string> {
    const r = (await c.query(`select id, requested_at from order_cancel_requests where order_id = $1 and status = 'pending' for update`, [orderId])).rows[0];
    if (!r) throw noOrExpired(false);
    if (now() - (r.requested_at as Date).getTime() >= (await getFees()).cancelRequestTtlMs) throw noOrExpired(true);
    return r.id as string;
  }
  // ---- fin agent A

  /** Libère les commandes dont le délai de paiement est dépassé. Les triggers de la base remettent les articles en vente. */
  async function expireUnpaid(q: Queryable): Promise<number> {
    // agent C : les notifications des deux parties sont créées par la MÊME instruction que l'expiration (atomique, idempotente par clé d'événement).
    const r = await q.query(
      `with e as (
         update orders set status = 'expired' where status = 'pending_payment' and payment_expires_at < $1 returning id, buyer_id, seller_id
       ), ins as (
         insert into notifications (user_id, kind, payload, event_key, created_at)
         select u.uid, 'order_expired',
                jsonb_build_object('orderId', e.id, 'role', u.role,
                  'itemTitle', (select i.title from order_items oi join items i on i.id = oi.item_id where oi.order_id = e.id order by i.id limit 1)),
                'order_expired:' || e.id, $1
         from e cross join lateral (values (e.buyer_id, 'buyer'), (e.seller_id, 'seller')) as u(uid, role)
         join profiles p on p.id = u.uid and p.deleted_at is null
         on conflict (user_id, event_key) where event_key is not null do nothing
       )
       select count(*)::int as n from e`, [ts(now())]);
    return r.rows[0]?.n ?? 0;
  }

  // ---- agent D : livraison par coursier
  async function logShipment(q: Queryable, shipmentId: string, orderId: string, kind: ShipmentEventKind, actorId: string | null, note: string | null = null) {
    await q.query(`insert into shipment_events (shipment_id, order_id, kind, actor_id, note, created_at) values ($1,$2,$3,$4,$5,$6)`, [shipmentId, orderId, kind, actorId, note, ts(now())]);
  }
  /** Zone de tarification entre la commune d'origine de l'article et celle de l'acheteur (communes sans parent connu : même ville). */
  async function zoneFor(q: Queryable, originAreaId: string | null, destAreaId: string): Promise<ShippingZone> {
    if (!isUuid(destAreaId)) throw new AppError("VALIDATION", "Choisis ta commune pour la livraison.", 422, { areaId: "Choisis ta commune pour la livraison." });
    const dest = (await q.query(`select id, parent_id from areas where id = $1 and kind = 'commune'`, [destAreaId])).rows[0];
    if (!dest) throw new AppError("VALIDATION", "Choisis ta commune pour la livraison.", 422, { areaId: "Choisis ta commune pour la livraison." });
    const origin = originAreaId ? (await q.query(`select id, parent_id from areas where id = $1`, [originAreaId])).rows[0] : null;
    return shippingZone(origin?.id ?? null, dest.id, [origin, dest].filter(Boolean).map((a) => ({ id: a.id, parentId: a.parent_id })));
  }
  async function shipmentViewOf(q: Queryable, order: Order, ship: Row | undefined): Promise<ShipmentView | null> {
    if (order.deliveryMethod !== "courier" || !ship) return null;
    const ev = await q.query(`select id, kind, note, created_at from shipment_events where shipment_id = $1 order by seq`, [ship.id]);
    return {
      status: ship.status, courierName: ship.courier_name, courierPhone: ship.courier_phone, trackingRef: ship.tracking_ref,
      events: ev.rows.map((e) => ({ id: e.id, kind: e.kind, at: e.created_at.getTime(), note: e.note })),
    };
  }

  async function buildView(q: Queryable, order: Order, viewerId: string): Promise<OrderView> {
    if (viewerId !== order.buyerId && viewerId !== order.sellerId) throw notFound("Commande");
    const role = viewerId === order.buyerId ? "buyer" : "seller";
    const fees = await getFees();
    const [itemsR, payR, shipR, cpR] = await Promise.all([
      q.query(
        `select i.id, i.title, i.price_minor, i.currency, (select storage_path from item_photos where item_id = i.id order by position limit 1) as path
         from order_items oi join items i on i.id = oi.item_id where oi.order_id = $1 order by i.id`, [order.id]),
      q.query(`select * from payments where order_id = $1 order by created_at desc limit 1`, [order.id]),
      q.query(`select * from shipments where order_id = $1`, [order.id]),
      q.query(`select * from profiles where id = $1`, [role === "buyer" ? order.sellerId : order.buyerId]),
    ]);
    const pay = payR.rows[0];
    const ship = shipR.rows[0];
    const live = order.status === "paid" || order.status === "in_delivery";
    const actions: OrderAction[] = [];
    const courier = order.deliveryMethod === "courier";
    const cr = await cancelRequestsOf(q, order.id); // agent A : les actions dépendent de l'état des demandes d'annulation
    if (role === "buyer") {
      if (order.status === "pending_payment") actions.push("pay", "cancel");
      if (live && !courier) {
        actions.push("reveal_code", "issue");
        if (cr.livePending) actions.push("withdraw_cancel");
        else if (!cr.refused) actions.push("request_cancel");
      }
      // ---- agent D : livraison par coursier (pas de code ; une fois le colis remis, l'acheteur ne peut plus annuler seul)
      if (live && courier) {
        if (order.status === "paid") {
          actions.push("issue");
          if (cr.livePending) actions.push("withdraw_cancel");
          else if (!cr.refused) actions.push("request_cancel");
        } else actions.push("confirm_received", "report_lost", "issue");
      }
      if (order.status === "delivered") {
        actions.push("accept");
        if (order.autoReleaseAt == null || now() < order.autoReleaseAt) actions.push("issue");
      }
    } else {
      if (order.status === "pending_payment") actions.push("cancel");
      if (live && !courier) {
        actions.push("confirm_delivery", "cancel", "issue");
        if (cr.livePending) actions.push("accept_cancel", "decline_cancel");
      }
      if (live && courier) {
        if (order.status === "paid") {
          actions.push("ship", "cancel", "issue");
          if (cr.livePending) actions.push("accept_cancel", "decline_cancel");
        } else {
          if (ship?.status === "handed_to_courier") actions.push("mark_in_transit");
          actions.push("report_lost", "issue");
        }
      }
    }
    const dspR = await q.query(`select id, status from disputes where order_id = $1 order by opened_at desc limit 1`, [order.id]);
    if (order.status === "completed") {
      const mine = await q.query(`select 1 from reviews where order_id = $1 and author_id = $2`, [order.id, viewerId]);
      if (!mine.rowCount) actions.push("review");
    }
    const cp = cpR.rows[0];
    const locked = ship?.handover_locked_until && ship.handover_locked_until.getTime() > now() ? ship.handover_locked_until.getTime() : null;
    return {
      ...order, viewerRole: role,
      items: itemsR.rows.map((i) => ({ id: i.id, title: i.title, photo: i.path ? photoUrl(i.path) : null, priceMinor: i.price_minor, currency: i.currency })),
      counterpart: cp && !cp.deleted_at ? profileOf(cp) : DELETED_PROFILE(role === "buyer" ? order.sellerId : order.buyerId),
      payment: pay ? { id: pay.id, status: pay.status, method: pay.method, failureCode: pay.failure_code } : null,
      shipment: await shipmentViewOf(q, order, ship),
      handover: role === "seller" && live && ship && !courier ? { attemptsLeft: Math.max(0, fees.handoverMaxAttempts - ship.handover_attempts), lockedUntil: locked } : null,
      actions,
      dispute: dspR.rows[0] ? { id: dspR.rows[0].id, status: dspR.rows[0].status } : null,
      cancelRequest: (() => {
        const last = cr.recs.find((x) => x.status !== "withdrawn" && x.status !== "closed");
        if (!last || (last.status === "pending" && !live)) return null;
        return { status: (last.expired ? "expired" : last.status) as CancelRequestStatus, requestedAt: last.at, expiresAt: last.at + cr.ttl };
      })(),
      shippingToSellerMinor: role === "seller" ? await shippingToSellerOf(q, order, fees.courierFeeMode) : 0,
    };
  }

  // ---- agent G : part « livraison » versée au vendeur (lue dans le grand livre une fois la commande terminée)
  async function shippingToSellerOf(q: Queryable, order: Order, mode: CourierFeeMode): Promise<number> {
    if (order.shippingMinor <= 0) return 0;
    if (order.status === "completed") {
      const r = await q.query(`select coalesce(sum(amount_minor), 0) as s from ledger_entries where ref_id = $1 and ref_type = 'order_shipping' and account = 'seller_available'`, [order.id]);
      return -Number(r.rows[0].s);
    }
    if (order.status === "cancelled" || order.status === "refunded" || order.status === "expired") return 0;
    return mode === "seller" ? order.shippingMinor : 0;
  }

  function cardOf(r: Row, fees: Awaited<ReturnType<typeof getFees>>, dist: number | null = null): ItemCard {
    const meta = [r.brand, r.size_label, CONDITIONS.find((c) => c.value === r.condition)?.label].filter(Boolean).join(" · ");
    return {
      id: r.id, title: r.title, priceMinor: r.price_minor, currency: r.currency,
      protectedPriceMinor: r.price_minor + protectionFee(r.price_minor, r.currency, fees),
      status: r.status, photo: r.first_photo ? photoUrl(r.first_photo) : null, meta, areaName: r.area_name ?? null,
      distanceKm: dist === null ? null : Math.round(dist * 10) / 10,
      favouriteCount: Number(r.fav_count ?? 0), favourited: !!r.fav, own: !!r.own,
    };
  }
  // ---- agent H : colonnes communes des cartes (photo, lieu, nombre de favoris, état favori du membre `viewerParam`)
  const CARD_COLS = (viewerParam: string) => `i.*, a.name as area_name,
    (select storage_path from item_photos where item_id = i.id order by position limit 1) as first_photo,
    (select count(*)::int from favourites f where f.item_id = i.id) as fav_count,
    exists(select 1 from favourites f where f.item_id = i.id and f.user_id = ${viewerParam}::uuid) as fav,
    coalesce(i.seller_id = ${viewerParam}::uuid, false) as own`;
  const FAVOURABLE = ["active", "reserved", "sold"];
  async function followsOf(q: Queryable, userId: string): Promise<Follows> {
    const r = await q.query(`select kind, label from member_follows where user_id = $1 order by seq`, [userId]);
    return { brands: r.rows.filter((x) => x.kind === "brand").map((x) => x.label as string), sizes: r.rows.filter((x) => x.kind === "size").map((x) => x.label as string) };
  }
  const RECENT_ORDER = "i.published_at desc nulls last, i.created_at desc, i.id desc";
  // ---- fin agent H

  const itemOf = (r: Row, photos: string[]): Item => ({
    id: r.id, sellerId: r.seller_id, categoryId: r.category_id, title: r.title, description: r.description, condition: r.condition as Condition,
    sizeLabel: r.size_label, brand: r.brand, priceMinor: r.price_minor, currency: r.currency, status: r.status, areaId: r.area_id,
    lat: r.lat ?? null, lng: r.lng ?? null, photos, publishedAt: r.published_at?.getTime() ?? null, createdAt: r.created_at.getTime(),
  });

  async function roleOf(q: Queryable, userId: string): Promise<UserRole | null> {
    if (!isUuid(userId)) return null;
    const r = await q.query(`select role from profiles where id = $1 and deleted_at is null`, [userId]);
    return (r.rows[0]?.role as UserRole | undefined) ?? null;
  }
  async function requireRole(q: Queryable, userId: string, allowed: UserRole[]): Promise<void> {
    const role = await roleOf(q, userId);
    if (!role || !allowed.includes(role)) throw notFound("Ressource");
  }

  async function disputeViewOf(q: Queryable, disputeId: string, viewerId: string): Promise<DisputeView> {
    if (!isUuid(disputeId) || !isUuid(viewerId)) throw notFound("Litige");
    const r = await q.query(
      `select d.*, o.buyer_id, o.seller_id, o.total_minor, o.currency, bp.display_name as buyer_name, sp.display_name as seller_name, op.display_name as opener_name,
         (select i.title from order_items oi join items i on i.id = oi.item_id where oi.order_id = o.id order by i.id limit 1) as item_title,
         (select role from profiles where id = $2) as viewer_role
       from disputes d join orders o on o.id = d.order_id
       join profiles bp on bp.id = o.buyer_id join profiles sp on sp.id = o.seller_id join profiles op on op.id = d.opened_by
       where d.id = $1`, [disputeId, viewerId]);
    const x = r.rows[0];
    if (!x) throw notFound("Litige");
    const staff = ["support", "admin"].includes(x.viewer_role);
    const party = viewerId === x.buyer_id || viewerId === x.seller_id;
    if (!staff && !party) throw notFound("Litige");
    const notes = await q.query(
      `select n.id, n.author_id, n.note, n.created_at, p.display_name, p.role from dispute_evidence n join profiles p on p.id = n.author_id
       where n.dispute_id = $1 and n.note is not null and n.storage_path is null order by n.seq`, [disputeId]);
    // ---- agent B : photos de preuve et de messagerie
    const ev = await q.query(
      `select e.id, e.author_id, e.storage_path, e.note, e.created_at, p.display_name, p.role from dispute_evidence e join profiles p on p.id = e.author_id
       where e.dispute_id = $1 and e.storage_path like 'pp:%' order by e.seq`, [disputeId]);
    return {
      id: x.id, orderId: x.order_id, status: x.status, reason: x.reason, description: x.description,
      openedByName: x.opener_name, openedByMe: x.opened_by === viewerId, openedAt: x.opened_at.getTime(), resolvedAt: x.resolved_at ? x.resolved_at.getTime() : null,
      notes: notes.rows.map((n): DisputeNote => {
        const isStaff = ["support", "admin"].includes(n.role);
        return { id: n.id, authorName: isStaff ? "Assistance" : n.display_name, mine: n.author_id === viewerId, staff: isStaff, note: n.note, createdAt: n.created_at.getTime() };
      }),
      evidence: ev.rows.map((e): DisputeEvidence => {
        const isStaff = ["support", "admin"].includes(e.role);
        return { id: e.id, authorName: isStaff ? "Assistance" : e.display_name, mine: e.author_id === viewerId, staff: isStaff, photoUrl: privatePhotoUrl(String(e.storage_path).slice(3)), note: e.note ?? "", createdAt: e.created_at.getTime() };
      }),
      order: { itemTitle: x.item_title ?? "Article", totalMinor: Number(x.total_minor), currency: x.currency, buyerName: x.buyer_name, sellerName: x.seller_name },
      viewerRole: staff && !party ? "staff" : viewerId === x.buyer_id ? "buyer" : "seller",
    };
  }

  async function reportViewOf(q: Queryable, id: string): Promise<ReportView> {
    const r = (await q.query(
      `select r.*, rp.display_name as reporter_name,
         case r.target_type when 'item' then (select title from items where id = r.target_id) else (select display_name from profiles where id = r.target_id) end as label
       from reports r join profiles rp on rp.id = r.reporter_id where r.id = $1`, [id])).rows[0];
    if (!r) throw notFound("Signalement");
    return { id: r.id, targetType: r.target_type, targetId: r.target_id, targetLabel: r.label ?? "Supprimé", reason: r.reason, details: r.details ?? "", reporterName: r.reporter_name, status: r.status, createdAt: r.created_at.getTime() };
  }

  /** Rembourse l'acheteur depuis le séquestre. Retourne la demande à envoyer au fournisseur, à exécuter APRÈS la transaction. */
  async function refundEscrowTx(c: Client, order: Order): Promise<{ providerRef: string; amountMinor: number } | null> {
    await post(c, refundEntries(ctx("order", order.id, order.currency), order.totalMinor));
    const pay = (await c.query(`update payments set status = 'refunded', refunded_minor = amount_minor where order_id = $1 and status = 'succeeded' returning *`, [order.id])).rows[0];
    return pay?.provider_ref ? { providerRef: pay.provider_ref, amountMinor: pay.amount_minor } : null;
  }

  // ---- agent C : notifications
  interface SmsJob { id: string; userId: string; kind: NotificationKind }
  const smsInFlight = new Set<Promise<void>>();

  async function orderTitleOf(q: Queryable, orderId: string): Promise<string> {
    const r = await q.query(`select i.title from order_items oi join items i on i.id = oi.item_id where oi.order_id = $1 order by i.id limit 1`, [orderId]);
    return r.rows[0]?.title ?? "Article";
  }

  /**
   * Crée, fusionne ou ignore une notification, DANS la transaction de l'événement (q = le client de la transaction).
   * Jamais pour un membre supprimé ou inconnu (la jointure sur profiles ne renvoie alors aucune ligne).
   *  - eventKey : unique par (membre, clé) : rejouer l'événement ne crée aucun doublon ;
   *  - groupKey : une seule notification non lue par (membre, groupe), incrémentée à chaque arrivée.
   * Si la notification est NOUVELLE et critique, elle est ajoutée à `jobs` : le SMS part APRÈS la validation de la transaction.
   */
  async function notifyTx(q: Queryable, spec: NotifySpec, jobs?: SmsJob[]): Promise<void> {
    if (!isUuid(spec.userId)) return;
    const at = ts(now());
    let id: string | undefined;
    if (spec.groupKey) {
      const r = await q.query(
        `insert into notifications (user_id, kind, payload, group_key, created_at)
         select $1::uuid, $2::text, $3::jsonb, $4::text, $5::timestamptz from profiles where id = $1::uuid and deleted_at is null
         on conflict (user_id, group_key) where group_key is not null and read_at is null
         do update set payload = notifications.payload || (excluded.payload - 'count')
                              || jsonb_build_object('count', coalesce((notifications.payload->>'count')::int, 1) + 1),
                       created_at = excluded.created_at
         returning id, (xmax = 0) as fresh`,
        [spec.userId, spec.kind, JSON.stringify({ ...spec.payload, count: 1 }), spec.groupKey, at]);
      if (r.rows[0]?.fresh) id = r.rows[0].id;
    } else {
      const r = await q.query(
        `insert into notifications (user_id, kind, payload, event_key, created_at)
         select $1::uuid, $2::text, $3::jsonb, $4::text, $5::timestamptz from profiles where id = $1::uuid and deleted_at is null
         on conflict (user_id, event_key) where event_key is not null do nothing
         returning id`,
        [spec.userId, spec.kind, JSON.stringify(spec.payload), spec.eventKey ?? null, at]);
      id = r.rows[0]?.id;
    }
    if (id && jobs && SMS_KIND_CATEGORY[spec.kind]) jobs.push({ id, userId: spec.userId, kind: spec.kind });
  }

  /** Les deux parties d'une commande, sauf l'auteur de l'action (`except`). */
  async function notifyParties(q: Queryable, o: Order, make: (role: "buyer" | "seller") => Omit<NotifySpec, "userId">, jobs?: SmsJob[], except?: string) {
    for (const [uid, role] of [[o.buyerId, "buyer"], [o.sellerId, "seller"]] as const) {
      if (uid !== except) await notifyTx(q, { ...make(role), userId: uid }, jobs);
    }
  }

  /** Envoi des SMS critiques : HORS transaction, jamais bloquant, jamais d'erreur remontée à l'appelant. Préférences, plafond quotidien et membre supprimé vérifiés ici. */
  function fireSms(jobs: SmsJob[]) {
    for (const j of jobs) {
      const category = SMS_KIND_CATEGORY[j.kind];
      const text = smsText(j.kind);
      if (!category || !text) continue;
      const p: Promise<void> = (async () => {
        try {
          const r = (await pool.query(
            `select p.phone, coalesce(np.sms_orders, true) as sms_orders, coalesce(np.sms_disputes, true) as sms_disputes
             from profiles p left join notification_preferences np on np.user_id = p.id where p.id = $1 and p.deleted_at is null`, [j.userId])).rows[0];
          if (!r?.phone) return;
          if (!(category === "orders" ? r.sms_orders : r.sms_disputes)) return;
          const rl = await api.rateLimit(`sms:notif:${sha256(r.phone).slice(0, 24)}`, SMS_DAILY_LIMIT, 86_400);
          if (!rl.allowed) return;
          await sms.send(r.phone, text);
          await pool.query(`update notifications set channels_sent = array_append(channels_sent, 'sms') where id = $1`, [j.id]);
        } catch (e) {
          console.error("[notifications] SMS non envoyé", (e as Error).message);
        }
      })().finally(() => smsInFlight.delete(p));
      smsInFlight.add(p);
    }
  }
  // ---- fin agent C : notifications

  const api: PgData = {
    __provider: provider,
    __sms: sms,
    async __settleSms() {
      while (smsInFlight.size) await Promise.all([...smsInFlight]);
    },
    __pendingEvents: () => [...queue],
    async __flush() {
      while (queue.length) await api.handleProviderEvent(queue.shift()!);
    },

    // ================================================================ authentification
    async requestOtp(phoneInput) {
      const phone = normalizeDrcPhone(phoneInput);
      if (!phone) throw new AppError("PHONE_INVALID", "Numéro de téléphone invalide.", 422);
      const rl = await api.rateLimit(`otp:send:${sha256(phone).slice(0, 24)}`, 3, 600);
      if (!rl.allowed) throw new AppError("OTP_RATE_LIMIT", "Trop de demandes. Réessaie dans quelques minutes.", 429);
      const code = fixedOtp ?? String(randomInt(0, 1_000_000)).padStart(6, "0");
      const t = now();
      await pool.query(
        `insert into otp_codes (phone, code_hash, attempts, expires_at, created_at) values ($1,$2,0,$3,$4)
         on conflict (phone) do update set code_hash = $2, attempts = 0, expires_at = $3, created_at = $4`,
        [phone, hashOtp(phone, code), ts(t + 5 * 60_000), ts(t)],
      );
      try {
        await sms.send(phone, `${APP_NAME} : ton code est ${code}. Il expire dans 5 minutes. Ne le partage avec personne.`);
      } catch (e) {
        await pool.query(`delete from otp_codes where phone = $1`, [phone]);
        console.error("[sms] envoi impossible", (e as Error).message);
        throw new AppError("SMS_UNAVAILABLE", "Impossible d'envoyer le SMS pour le moment. Réessaie dans un instant.", 502);
      }
      return { phone, devCode: !prod && sms.name === "console" ? code : undefined };
    },

    async verifyOtp(phoneInput, code, displayName) {
      const phone = normalizeDrcPhone(phoneInput);
      if (!phone) throw new AppError("PHONE_INVALID", "Numéro de téléphone invalide.", 422);
      type Out = { err: AppError } | { user: User; isNew: boolean };
      // Le compteur d'essais doit être VALIDÉ en base avant de lever l'erreur : lever dans la transaction annulerait l'incrément.
      const out = await withTx<Out>(pool, async (c) => {
        const rec = (await c.query(`select * from otp_codes where phone = $1 for update`, [phone])).rows[0];
        if (!rec || rec.expires_at.getTime() < now()) return { err: new AppError("OTP_EXPIRED", "Ce code a expiré. Demandes-en un nouveau.", 400) };
        if (rec.attempts >= 5) return { err: new AppError("OTP_LOCKED", "Trop d'essais. Demande un nouveau code.", 429) };
        if (!sameHash(hashOtp(phone, code), rec.code_hash)) {
          await c.query(`update otp_codes set attempts = attempts + 1 where phone = $1`, [phone]);
          return { err: new AppError("OTP_WRONG", "Code incorrect.", 400) };
        }
        let u = (await c.query(`select * from profiles where phone = $1 and deleted_at is null`, [phone])).rows[0];
        let isNew = false;
        if (!u) {
          const name = displayName?.trim() ?? "";
          if (name.length < 2 || name.length > 40) return { err: new AppError("NAME_REQUIRED", "Dis-nous comment t'appeler (2 à 40 caractères).", 422) };
          u = (await c.query(
            `insert into profiles (phone, phone_verified_at, display_name, verification_level, created_at) values ($1,$2,$3,'phone',$2) returning *`,
            [phone, ts(now()), name],
          )).rows[0];
          isNew = true;
        }
        await c.query(`delete from otp_codes where phone = $1`, [phone]);
        return { user: userOf(u), isNew };
      });
      if ("err" in out) throw out.err;
      return out;
    },

    async getUser(id) {
      if (!isUuid(id)) return null;
      const r = await pool.query(
        `select p.*, (select max(ends_at) from sanctions where user_id = p.id and kind = 'suspension' and ends_at > $2) as suspended_until
         from profiles p where p.id = $1 and p.deleted_at is null`, [id, ts(now())]);
      return r.rows[0] ? userOf(r.rows[0]) : null;
    },
    async getPublicProfile(id) {
      if (!isUuid(id)) return null;
      const r = await pool.query(`select * from profiles where id = $1 and deleted_at is null and status <> 'banned'`, [id]);
      return r.rows[0] ? profileOf(r.rows[0]) : null;
    },
    async updateMe(userId, patch) {
      if (patch.displayName !== undefined) {
        const n = patch.displayName.trim();
        if (n.length < 2 || n.length > 40) throw new AppError("VALIDATION", "Le nom doit faire entre 2 et 40 caractères.", 422);
        patch = { ...patch, displayName: n };
      }
      const r = await pool.query(
        `update profiles set display_name = coalesce($2, display_name), bio = coalesce($3, bio),
           area_id = case when $4::boolean then $5::uuid else area_id end
         where id = $1 and deleted_at is null returning *`,
        [userId, patch.displayName ?? null, patch.bio === undefined ? null : patch.bio.slice(0, 500), patch.areaId !== undefined, patch.areaId ?? null],
      );
      if (!r.rows[0]) throw notFound("Compte");
      return userOf(r.rows[0]);
    },

    // ================================================================ sessions, limites, entretien
    async createSession(userId, meta) {
      const token = randomBytes(32).toString("base64url");
      const expiresAt = now() + 30 * ONE_DAY;
      await withTx(pool, async (c) => {
        await c.query(
          `insert into sessions (user_id, token_hash, user_agent, created_at, last_seen_at, expires_at) values ($1,$2,$3,$4,$4,$5)`,
          [userId, sha256(token), meta?.userAgent?.slice(0, 200) ?? null, ts(now()), ts(expiresAt)],
        );
        // Au plus 20 sessions actives par membre : la plus ancienne est révoquée.
        await c.query(`delete from sessions where id in (select id from sessions where user_id = $1 order by created_at desc offset 20)`, [userId]);
      });
      return { token, expiresAt };
    },
    async getSessionUser(token) {
      if (!token || token.length > 200) return null;
      const r = await pool.query(
        `select p.*, (select max(ends_at) from sanctions where user_id = p.id and kind = 'suspension' and ends_at > $2) as suspended_until
         from sessions s join profiles p on p.id = s.user_id where s.token_hash = $1 and s.expires_at > $2 and p.deleted_at is null`,
        [sha256(token), ts(now())],
      );
      if (!r.rows[0]) return null;
      await pool.query(`update sessions set last_seen_at = $2 where token_hash = $1 and last_seen_at < $3`, [sha256(token), ts(now()), ts(now() - 600_000)]);
      return userOf(r.rows[0]);
    },
    async deleteSession(token) {
      await pool.query(`delete from sessions where token_hash = $1`, [sha256(token)]);
    },
    async deleteAllSessions(userId) {
      if (isUuid(userId)) await pool.query(`delete from sessions where user_id = $1`, [userId]);
    },

    async deleteAccount(userId) {
      if (!isUuid(userId)) throw notFound("Compte");
      await withTx(pool, async (c) => {
        const u = (await c.query(`select id from profiles where id = $1 and deleted_at is null for update`, [userId])).rows[0];
        if (!u) throw notFound("Compte");
        const open = await c.query(
          `select 1 from orders where (buyer_id = $1 or seller_id = $1) and status not in ('completed','refunded','cancelled','expired') limit 1`, [userId]);
        if (open.rowCount) throw new AppError("ACCOUNT_HAS_OPEN_ORDERS", "Termine ou annule tes commandes en cours avant de supprimer ton compte.", 409);
        await c.query(`select pg_advisory_xact_lock(hashtext($1))`, [`wallet:${userId}`]);
        for (const cur of ["USD", "CDF"] as Currency[]) {
          if ((await walletBalance(c, userId, "seller_available", cur)) > 0 || (await walletBalance(c, userId, "payout_pending", cur)) > 0)
            throw new AppError("ACCOUNT_HAS_FUNDS", "Retire l'argent de ton portefeuille avant de supprimer ton compte.", 409);
        }
        await c.query(`update items set status = 'removed' where seller_id = $1 and status in ('active','draft')`, [userId]);
        await c.query(`delete from sessions where user_id = $1`, [userId]);
        await c.query(`delete from favourites where user_id = $1`, [userId]);
        await c.query(`delete from cart_items where user_id = $1`, [userId]); // ---- agent J
        await c.query(`delete from member_follows where user_id = $1`, [userId]); // agent H
        await c.query(`delete from devices where user_id = $1`, [userId]);
        await c.query(`delete from notifications where user_id = $1`, [userId]);
        await c.query(`delete from notification_preferences where user_id = $1`, [userId]);
        await c.query(`delete from identity_verifications where user_id = $1`, [userId]);
        await c.query(
          `update profiles set display_name = 'Membre supprimé', bio = '', phone = null, avatar_path = null, area_id = null, deleted_at = $2 where id = $1`,
          [userId, ts(now())],
        );
      });
    },

    async health() {
      await pool.query("select 1");
      return { ok: true as const };
    },

    async getPhoto(id) {
      if (!isUuid(id)) return null;
      const r = await pool.query(`select mime, content from photo_blobs where id = $1`, [id]);
      return r.rows[0] ? { mime: r.rows[0].mime, bytes: r.rows[0].content } : null;
    },

    async rateLimit(key, limit, windowSec) {
      const t = now();
      const r = await pool.query(
        `insert into rate_limits (key, window_start, count) values ($1, $2, 1)
         on conflict (key) do update set
           window_start = case when rate_limits.window_start <= $2::timestamptz - make_interval(secs => $3) then $2 else rate_limits.window_start end,
           count = case when rate_limits.window_start <= $2::timestamptz - make_interval(secs => $3) then 1 else rate_limits.count + 1 end
         returning count, window_start`,
        [key, ts(t), windowSec],
      );
      const { count, window_start } = r.rows[0];
      if (count <= limit) return { allowed: true, retryAfterSec: 0 };
      return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((window_start.getTime() + windowSec * 1000 - t) / 1000)) };
    },

    async purgeExpired() {
      const t = ts(now());
      const [o, s, r] = await Promise.all([
        pool.query(`delete from otp_codes where expires_at < $1`, [t]),
        pool.query(`delete from sessions where expires_at < $1`, [t]),
        pool.query(`delete from rate_limits where window_start < $1`, [ts(now() - ONE_DAY)]),
      ]);
      return { otp: o.rowCount ?? 0, sessions: s.rowCount ?? 0, rateLimits: r.rowCount ?? 0 };
    },

    async reconcilePendingPayments() {
      let resolved = 0;
      const rows = (await pool.query(
        `select * from payments where status in ('initiated','pending_user') and created_at < $1 order by created_at limit 200`, [ts(now() - 120_000)])).rows;
      for (const r of rows) {
        if (!r.provider_ref) {
          // Le fournisseur n'a jamais confirmé la demande (panne ou arrêt en cours de route) : on l'abandonne.
          const u = await pool.query(`update payments set status = 'failed', failure_code = 'PROVIDER_TIMEOUT' where id = $1 and status = 'initiated' and provider_ref is null`, [r.id]);
          resolved += u.rowCount ?? 0;
        } else if (provider.getCollection) {
          const res = await provider.getCollection(r.provider_ref);
          if (res.status !== "pending") {
            await api.handleProviderEvent({
              eventId: `reconcile:${r.provider_ref}:${res.status}`,
              type: res.status === "succeeded" ? "collection.succeeded" : "collection.failed",
              providerRef: r.provider_ref, failureCode: res.failureCode,
            });
            resolved++;
          }
        }
      }
      return resolved;
    },

    // ================================================================ catalogue
    async listCategories() {
      const r = await pool.query(`select id, parent_id, slug, name->>'fr' as name, is_sellable from categories order by sort_order, slug`);
      return r.rows.map((x): Category => ({ id: x.id, parentId: x.parent_id, slug: x.slug, name: x.name, isSellable: x.is_sellable }));
    },
    async listAreas(parentId) {
      if (parentId !== undefined && parentId !== null && !isUuid(parentId)) return [];
      const r = await pool.query(
        `select id, parent_id, kind, name, lat, lng from areas where ($1::boolean = false or parent_id = $2::uuid) order by name`,
        [parentId !== undefined, parentId ?? null],
      );
      return r.rows.map((x): Area => ({ id: x.id, parentId: x.parent_id, kind: x.kind, name: x.name, lat: x.lat ?? null, lng: x.lng ?? null }));
    },

    async listItems(q) {
      await expireUnpaid(pool);
      const fees = await getFees();
      const params: unknown[] = [];
      const p = (v: unknown) => (params.push(v), `$${params.length}`);
      let from: { lat: number; lng: number } | undefined;
      if (q.lat != null && q.lng != null) from = { lat: q.lat, lng: q.lng };
      else if (q.areaId && isUuid(q.areaId)) {
        const a = (await pool.query(`select lat, lng from areas where id = $1`, [q.areaId])).rows[0];
        if (a?.lat != null && a?.lng != null) from = { lat: a.lat, lng: a.lng };
      }
      const where: string[] = [`i.status = any(${p(q.includeSold ? ["active", "sold", "reserved"] : ["active"])}::text[])`];
      if (q.sellerId) where.push(isUuid(q.sellerId) ? `i.seller_id = ${p(q.sellerId)}` : "false");
      if (q.categoryId) {
        if (!isUuid(q.categoryId)) where.push("false");
        else where.push(`i.category_id in (select id from categories where id = ${p(q.categoryId)} or parent_id = $${params.length})`);
      }
      for (const tok of norm(q.q ?? "").split(/\s+/).filter(Boolean).slice(0, 8)) {
        where.push(`unaccent(lower(i.title || ' ' || coalesce(i.brand, '') || ' ' || i.description)) like ${p(`%${likeEscape(tok)}%`)} escape '\\'`);
      }
      if (q.brand) where.push(`unaccent(lower(coalesce(i.brand, ''))) like ${p(`%${likeEscape(norm(q.brand))}%`)} escape '\\'`);
      if (q.sizeLabel) where.push(`unaccent(lower(coalesce(i.size_label, ''))) = ${p(norm(q.sizeLabel))}`);
      if (q.conditions?.length) where.push(`i.condition = any(${p(q.conditions)}::text[])`);
      const usd = `(case when i.currency = 'USD' then i.price_minor else round(i.price_minor / ${USD_CDF_PLACEHOLDER}.0) end)`;
      if (q.minPriceUsdMinor != null) where.push(`${usd} >= ${p(q.minPriceUsdMinor)}`);
      if (q.maxPriceUsdMinor != null) where.push(`${usd} <= ${p(q.maxPriceUsdMinor)}`);
      let distSql = "null::float8";
      let order = RECENT_ORDER;
      // agent H : tri choisi. Prix comparé en centimes de FC sans arrondi (même taux que le filtre) ; départage : plus récent puis id.
      const priceKey = `(case when i.currency = 'USD' then i.price_minor * ${USD_CDF_PLACEHOLDER} else i.price_minor end)`;
      const sortOrder = q.sort === "price_asc" ? `${priceKey} asc, ${RECENT_ORDER}` : q.sort === "price_desc" ? `${priceKey} desc, ${RECENT_ORDER}`
        : q.sort === "favourites" ? `fav_count desc, ${RECENT_ORDER}` : null;
      const viewer = p(q.viewerId && isUuid(q.viewerId) ? q.viewerId : null);
      if (q.radiusKm != null && from) {
        const dLat = q.radiusKm / 111;
        const dLng = q.radiusKm / (111 * Math.max(0.1, Math.cos((from.lat * Math.PI) / 180)));
        where.push(`i.lat is not null and i.lng is not null and i.lat between ${p(from.lat - dLat)} and ${p(from.lat + dLat)} and i.lng between ${p(from.lng - dLng)} and ${p(from.lng + dLng)}`);
        const la = p(from.lat), lo = p(from.lng);
        distSql = `distance_km(${la}::float8, ${lo}::float8, i.lat::float8, i.lng::float8)`;
        where.push(`${distSql} <= ${p(q.radiusKm)}`);
        order = q.sort === "recent" ? RECENT_ORDER : `dist asc, ${RECENT_ORDER}`;
      } else if (from) {
        distSql = `distance_km(${p(from.lat)}::float8, ${p(from.lng)}::float8, i.lat::float8, i.lng::float8)`;
      }
      if (sortOrder) order = sortOrder;
      const limit = Math.min(Math.max(q.limit ?? 60, 1), 100);
      const offset = Math.max(Math.floor(q.offset ?? 0), 0);
      const r = await pool.query(
        `select ${CARD_COLS(viewer)}, ${distSql} as dist
         from items i left join areas a on a.id = i.area_id
         where ${where.join(" and ")} order by ${order} limit ${limit} offset ${offset}`,
        params,
      );
      return r.rows.map((x) => cardOf(x, fees, q.radiusKm != null && x.dist != null ? x.dist : null));
    },

    async getItem(id, viewerId) {
      if (!isUuid(id)) return null;
      const r = await pool.query(
        `select i.*, a.name as area_name, c.name->>'fr' as category_name, p.id as p_id, p.display_name, p.bio, p.area_id as p_area, p.verification_level,
           p.rating_avg, p.rating_count, p.deleted_at,
           (select storage_path from item_photos where item_id = i.id order by position limit 1) as first_photo,
           (select count(*)::int from favourites f where f.item_id = i.id) as fav_count,
           exists(select 1 from favourites f where f.item_id = i.id and f.user_id = $2::uuid) as fav,
           coalesce(i.seller_id = $2::uuid, false) as own
         from items i left join areas a on a.id = i.area_id left join categories c on c.id = i.category_id join profiles p on p.id = i.seller_id
         where i.id = $1`, [id, viewerId && isUuid(viewerId) ? viewerId : null]);
      const x = r.rows[0];
      if (!x) return null;
      if (["draft", "hidden", "removed"].includes(x.status) && x.seller_id !== viewerId) return null;
      if (x.deleted_at) return null;
      const photos = (await pool.query(`select storage_path from item_photos where item_id = $1 order by position`, [id])).rows.map((p) => photoUrl(p.storage_path));
      const fees = await getFees();
      const detail: ItemDetail = {
        ...cardOf(x, fees), brand: x.brand, sizeLabel: x.size_label, description: x.description, photos, condition: x.condition,
        categoryName: x.category_name ?? "", sellerId: x.seller_id,
        seller: profileOf({ id: x.p_id, display_name: x.display_name, bio: x.bio, area_id: x.p_area, verification_level: x.verification_level, rating_avg: x.rating_avg, rating_count: x.rating_count }),
      };
      return detail;
    },

    async createDraft(sellerId, input) {
      const fees = await getFees();
      const photos = input.photos ?? [];
      if (photos.length > fees.maxPhotos) throw new AppError("VALIDATION", `Tu peux ajouter ${fees.maxPhotos} photos au maximum.`, 422, { photos: `Maximum ${fees.maxPhotos} photos.` });
      const bad = (): never => { throw new AppError("VALIDATION", "Une photo est invalide ou trop lourde.", 422, { photos: "Photo invalide ou trop lourde (JPEG, PNG ou WebP, compressée)." }); };
      // Le type est déduit du CONTENU, jamais de ce que le client annonce (règles partagées : src/lib/photos.ts).
      const decoded = photos.map((p) => decodePhotoDataUrl(p) ?? bad());
      return withTx(pool, async (c) => {
        const seller = (await c.query(`select id from profiles where id = $1 and deleted_at is null`, [sellerId])).rows[0];
        if (!seller) throw notFound("Compte");
        const area = input.areaId && isUuid(input.areaId) ? (await c.query(`select id, lat, lng from areas where id = $1`, [input.areaId])).rows[0] : null;
        const r = await c.query(
          `insert into items (seller_id, category_id, title, description, condition, size_label, brand, price_minor, currency, status, area_id, lat, lng, created_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'draft',$10,$11,$12,$13) returning *`,
          [sellerId, input.categoryId, (input.title ?? "").trim(), input.description ?? "", input.condition, input.sizeLabel?.trim() || null,
            input.brand?.trim() || null, input.priceMinor, input.currency, area?.id ?? null,
            area?.lat != null ? coarsen(area.lat) : null, area?.lng != null ? coarsen(area.lng) : null, ts(now())],
        ).catch((e) => {
          // Données invalides (catégorie inconnue, état invalide, prix négatif) : refus propre, jamais une erreur serveur.
          if (["23503", "23514", "22P02", "22003"].includes(pgCode(e) ?? "")) throw new AppError("VALIDATION", "Annonce invalide : vérifie la catégorie, l'état et le prix.", 422);
          throw e;
        });
        const urls: string[] = [];
        let pos = 0;
        for (const ph of decoded) {
          const b = (await c.query(`insert into photo_blobs (owner_id, mime, size, content, created_at) values ($1,$2,$3,$4,$5) returning id`, [sellerId, ph.mime, ph.bytes.length, ph.bytes, ts(now())])).rows[0];
          await c.query(`insert into item_photos (item_id, storage_path, position, bytes) values ($1,$2,$3,$4)`, [r.rows[0].id, `db:${b.id}`, pos++, ph.bytes.length]);
          urls.push(`/api/v1/photos/${b.id}`);
        }
        return itemOf(r.rows[0], urls);
      });
    },

    async publishItem(sellerId, itemId) {
      if (!isUuid(itemId)) throw notFound("Annonce");
      const fees = await getFees();
      const bannedRules = await prohibited.compiled(); // agent E : chargé avant la transaction
      return withTx(pool, async (c) => {
        const it = (await c.query(`select * from items where id = $1 and seller_id = $2 for update`, [itemId, sellerId])).rows[0];
        if (!it) throw notFound("Annonce");
        if (it.status !== "draft") throw new AppError("INVALID_STATE", "Cette annonce est déjà publiée.", 409);
        const photos = (await c.query(`select storage_path from item_photos where item_id = $1 order by position`, [itemId])).rows.map((p) => photoUrl(p.storage_path));
        const cats = (await c.query(`select id, parent_id, slug, name->>'fr' as name, is_sellable from categories`)).rows
          .map((x): Category => ({ id: x.id, parentId: x.parent_id, slug: x.slug, name: x.name, isSellable: x.is_sellable }));
        const errors = validateListing(
          { title: it.title, description: it.description, categoryId: it.category_id, condition: it.condition, sizeLabel: it.size_label, brand: it.brand,
            priceMinor: it.price_minor, currency: it.currency, areaId: it.area_id, photos }, cats, fees);
        if (Object.keys(errors).length) throw new AppError("VALIDATION", "Corrige les champs signalés.", 422, errors as Record<string, string>);
        // ---- agent E : articles interdits (aucun contournement ; la transaction est annulée, l'annonce reste en brouillon)
        const banned = checkListingText({ title: it.title, description: it.description, brand: it.brand }, bannedRules);
        if (banned) throw new AppError("PROHIBITED_ITEM", banned.hit.message, 422, { [banned.field]: banned.hit.message });
        // ---- fin agent E
        const u = await c.query(`update items set status = 'active', published_at = $2 where id = $1 returning *`, [itemId, ts(now())]);
        return itemOf(u.rows[0], photos);
      });
    },

    // ================================================================ commandes
    async expireUnpaidOrders() {
      return expireUnpaid(pool);
    },

    async createOrder(buyerId, input) {
      await expireUnpaid(pool);
      if (input.deliveryMethod === "relay_point") throw new AppError("NOT_SUPPORTED", "La livraison en point relais n'est pas encore disponible.", 400);
      const ids = [...new Set(input.itemIds)];
      if (!ids.length) throw new AppError("VALIDATION", "Choisis au moins un article.", 422);
      if (ids.some((i) => !isUuid(i))) throw notFound("Article");
      const fees = await getFees();
      try {
        return await withTx(pool, async (c) => {
          const buyer = (await c.query(`select id from profiles where id = $1 and deleted_at is null`, [buyerId])).rows[0];
          if (!buyer) throw notFound("Compte");
          // Verrou de ligne, dans un ORDRE FIXE (par id) : deux acheteurs concurrents sont sérialisés, sans interblocage.
          const rows = (await c.query(`select * from items where id = any($1::uuid[]) order by id for update`, [ids])).rows;
          if (rows.length !== ids.length) throw notFound("Article");
          // Toutes les règles du lot (même code que la couche factice), puis réservation de TOUS les articles dans cette transaction : tout ou rien.
          const { currency, itemsMinor } = assertLotOrderable(
            buyerId,
            rows.map((i) => ({ id: i.id, title: i.title, sellerId: i.seller_id, currency: i.currency as Currency, priceMinor: i.price_minor, status: i.status })),
            fees,
          );
          const fee = protectionFee(itemsMinor, currency, fees);
          // ---- agent D : livraison par coursier (commune de l'acheteur + repère obligatoires, frais selon la grille)
          let shippingMinor = 0;
          if (input.deliveryMethod === "courier") {
            if (!input.deliveryAreaId || !isUuid(input.deliveryAreaId)) throw new AppError("VALIDATION", "Choisis ta commune pour la livraison.", 422, { deliveryAreaId: "Choisis ta commune pour la livraison." });
            if ((input.deliveryLandmark?.trim().length ?? 0) < 3) throw new AppError("VALIDATION", "Décris un repère pour le coursier (3 caractères au moins).", 422, { deliveryLandmark: "Décris un repère pour le coursier (3 caractères au moins)." });
            const sellerArea = (await c.query(`select area_id from profiles where id = $1`, [rows[0].seller_id])).rows[0]?.area_id ?? null;
            let zone: ShippingZone;
            try { zone = await zoneFor(c, rows[0].area_id ?? sellerArea, input.deliveryAreaId); } catch (e) {
              if (e instanceof AppError) throw new AppError("VALIDATION", e.message, 422, { deliveryAreaId: e.message });
              throw e;
            }
            shippingMinor = shippingFee(zone, currency, fees);
          }
          const o = (await c.query(
            `insert into orders (buyer_id, seller_id, status, currency, items_minor, shipping_minor, protection_fee_minor, total_minor, delivery_method,
               delivery_area_id, delivery_landmark, payment_expires_at, created_at)
             values ($1,$2,'pending_payment',$3,$4,$12,$5,$6,$7,$8,$9,$10,$11) returning *`,
            [buyerId, rows[0].seller_id, currency, itemsMinor, fee, itemsMinor + shippingMinor + fee, input.deliveryMethod,
              input.deliveryAreaId && isUuid(input.deliveryAreaId) ? input.deliveryAreaId : null,
              input.deliveryLandmark?.trim().slice(0, 200) || null, ts(now() + fees.orderPaymentTtlMs), ts(now()), shippingMinor],
          )).rows[0];
          for (const i of rows) {
            await c.query(`insert into order_items (order_id, item_id, price_minor, currency) values ($1,$2,$3,$4)`, [o.id, i.id, i.price_minor, i.currency]);
            await c.query(`update items set status = 'reserved' where id = $1`, [i.id]);
          }
          await c.query(`delete from cart_items where user_id = $1 and item_id = any($2::uuid[])`, [buyerId, ids]); // ---- agent J : les articles commandés quittent le panier
          return orderOf({ ...o, item_ids: rows.map((i) => i.id as string) });
        });
      } catch (e) {
        // Filet de sécurité : l'index unique partiel order_items_one_open_per_item tranche si le verrou était contourné.
        if (pgCode(e) === "23505") throw new AppError("ITEM_UNAVAILABLE", "Cet article n'est plus disponible.", 409);
        throw e;
      }
    },

    async getOrder(orderId, viewerId) {
      await expireUnpaid(pool);
      return buildView(pool, await loadOrder(pool, orderId), viewerId);
    },

    async listMyOrders(userId) {
      await expireUnpaid(pool);
      const r = await pool.query(
        `select o.*, array(select item_id from order_items where order_id = o.id order by item_id) as item_ids
         from orders o where o.buyer_id = $1 or o.seller_id = $1 order by o.created_at desc limit 100`, [userId]);
      return Promise.all(r.rows.map((x) => buildView(pool, orderOf(x), userId)));
    },

    async startPayment(orderId, buyerId, input) {
      await expireUnpaid(pool);
      if (!isUuid(orderId)) throw notFound("Commande");
      const msisdn = normalizeDrcPhone(input.msisdn);
      type Started = { pay: Payment; created: boolean; order: Order };
      const started = await withTx<Started>(pool, async (c) => {
        const order = await loadOrder(c, orderId, true);
        if (order.buyerId !== buyerId) throw notFound("Commande");
        const dup = (await c.query(`select * from payments where idempotency_key = $1`, [input.idempotencyKey])).rows[0];
        if (dup) {
          if (dup.order_id !== orderId) throw new AppError("IDEMPOTENCY_CONFLICT", "Clé d'idempotence déjà utilisée.", 409);
          return { pay: paymentOf(dup), created: false, order };
        }
        if (order.status === "expired") throw new AppError("ORDER_EXPIRED", "Le délai de paiement est dépassé.", 409);
        if (order.status !== "pending_payment") throw new AppError("INVALID_STATE", "Cette commande ne peut plus être payée.", 409);
        if (!METHODS.includes(input.method)) throw new AppError("VALIDATION", "Moyen de paiement non pris en charge.", 422);
        if (!msisdn) throw new AppError("PHONE_INVALID", "Numéro de téléphone invalide.", 422);
        const active = (await c.query(`select 1 from payments where order_id = $1 and status in ('initiated','pending_user') limit 1`, [orderId])).rowCount;
        if (active) throw new AppError("PAYMENT_IN_PROGRESS", "Un paiement est déjà en attente de validation sur ton téléphone.", 409);
        let p;
        try {
          p = (await c.query(
            `insert into payments (order_id, provider, method, msisdn, amount_minor, currency, status, idempotency_key, created_at)
             values ($1,$2,$3,$4,$5,$6,'initiated',$7,$8) returning *`,
            [orderId, provider.name, input.method, msisdn, order.totalMinor, order.currency, input.idempotencyKey, ts(now())],
          )).rows[0];
        } catch (e) {
          // Deux commandes différentes ont pris la même clé au même instant : le SELECT ci-dessus ne peut pas le voir (verrous de lignes différents).
          if (pgCode(e) === "23505") throw new AppError("IDEMPOTENCY_CONFLICT", "Clé d'idempotence déjà utilisée.", 409);
          throw e;
        }
        return { pay: paymentOf(p), created: true, order };
      });
      if (!started.created) return started.pay;
      // L'appel au fournisseur se fait HORS transaction (réseau lent) ; la clé d'idempotence protège un éventuel rejeu.
      let providerRef: string;
      try {
        ({ providerRef } = await provider.initiateCollection({
          orderId, paymentId: started.pay.id, amountMinor: started.pay.amountMinor, currency: started.pay.currency, method: input.method, msisdn: msisdn!, idempotencyKey: input.idempotencyKey,
        }));
      } catch (e) {
        await pool.query(`update payments set status = 'failed', failure_code = 'PROVIDER_ERROR' where id = $1`, [started.pay.id]);
        console.error("[pay] fournisseur indisponible", (e as Error).message);
        throw new AppError("PSP_UNAVAILABLE", "Le paiement mobile est indisponible pour le moment. Réessaie dans un instant.", 502);
      }
      const u = (await pool.query(`update payments set provider_ref = $2, status = 'pending_user' where id = $1 returning *`, [started.pay.id, providerRef])).rows[0];
      if (provider instanceof FakeMobileMoneyProvider) {
        const ok = FakeMobileMoneyProvider.outcomeFor(msisdn!) === "succeeded";
        schedule({ eventId: `evt_${randomUUID()}`, type: ok ? "collection.succeeded" : "collection.failed", providerRef, failureCode: ok ? undefined : "INSUFFICIENT_FUNDS" });
      }
      return paymentOf(u);
    },

    async getPayment(orderId, buyerId) {
      const order = await loadOrder(pool, orderId);
      if (order.buyerId !== buyerId) throw notFound("Commande");
      const r = await pool.query(`select * from payments where order_id = $1 order by created_at desc limit 1`, [orderId]);
      return r.rows[0] ? paymentOf(r.rows[0]) : null;
    },

    async getHandoverCode(orderId, buyerId) {
      const order = await loadOrder(pool, orderId);
      if (order.buyerId !== buyerId) throw notFound("Commande");
      if (order.deliveryMethod === "courier") throw new AppError("INVALID_STATE", "La livraison par coursier n'utilise pas de code de remise.", 409);
      if (!["paid", "in_delivery", "delivered"].includes(order.status)) throw new AppError("INVALID_STATE", "Le code est disponible une fois la commande payée.", 409);
      return deriveHandoverCode(orderId);
    },

    async confirmDelivery(orderId, sellerId, code) {
      const fees = await getFees();
      type Out = { err: AppError } | { ok: true };
      // Le compteur d'essais est validé en base AVANT de lever l'erreur (sinon le ROLLBACK annulerait l'incrément).
      const out = await withTx<Out>(pool, async (c) => {
        const order = await loadOrder(c, orderId, true);
        if (order.sellerId !== sellerId) throw notFound("Commande");
        if (order.status !== "paid" && order.status !== "in_delivery") throw new AppError("INVALID_STATE", "Cette commande n'attend pas de remise.", 409);
        if (order.deliveryMethod === "courier") throw new AppError("INVALID_STATE", "Cette commande est livrée par coursier : l'acheteur confirme la réception.", 409);
        const ship = (await c.query(`select * from shipments where order_id = $1 for update`, [orderId])).rows[0];
        if (!ship) throw new AppError("INVALID_STATE", "Aucune remise en cours pour cette commande.", 409);
        const ok = codesEqual(deriveHandoverCode(orderId), (code ?? "").trim());
        const r = checkAttempt(
          { attempts: ship.handover_attempts, lockedUntil: ship.handover_locked_until?.getTime() ?? null }, ok, now(), fees.handoverMaxAttempts, fees.handoverLockMs);
        await c.query(`update shipments set handover_attempts = $2, handover_locked_until = $3 where order_id = $1`,
          [orderId, r.state.attempts, r.state.lockedUntil ? ts(r.state.lockedUntil) : null]);
        if (r.result === "locked") return { err: new AppError("CODE_LOCKED", "Trop d'essais. Réessaie dans quelques minutes.", 429) };
        if (r.result === "wrong") {
          const left = fees.handoverMaxAttempts - r.state.attempts;
          return { err: new AppError("CODE_WRONG", `Code incorrect. Il te reste ${left} essai${left > 1 ? "s" : ""}.`, 400) };
        }
        await c.query(`update shipments set status = 'delivered', delivered_confirmed_by = 'buyer_code' where order_id = $1`, [orderId]);
        await c.query(`update orders set status = 'delivered', delivered_at = $2 where id = $1`, [orderId, ts(now())]);
        await c.query(`update orders set status = 'completed', completed_at = $2 where id = $1`, [orderId, ts(now())]);
        await closePendingTx(c, orderId); // agent A : le code vaut acceptation, la demande d'annulation est close
        await post(c, releaseEntries(ctx("order", orderId, order.currency), { sellerId: order.sellerId, itemsMinor: order.itemsMinor, shippingMinor: order.shippingMinor, feeMinor: order.protectionFeeMinor, courierFeeMode: (await getFees()).courierFeeMode }));
        await notifyTx(c, { userId: order.buyerId, kind: "order_completed", payload: { orderId, itemTitle: await orderTitleOf(c, orderId), role: "buyer" }, eventKey: `order_completed:${orderId}` });
        return { ok: true };
      });
      if ("err" in out) throw out.err;
      return buildView(pool, await loadOrder(pool, orderId), sellerId);
    },

    async acceptOrder(orderId, buyerId) {
      await withTx(pool, async (c) => {
        const order = await loadOrder(c, orderId, true);
        if (order.buyerId !== buyerId) throw notFound("Commande");
        if (order.status !== "delivered") throw new AppError("INVALID_STATE", "Tu pourras accepter l'article une fois qu'il est livré.", 409);
        await c.query(`update orders set status = 'completed', completed_at = $2 where id = $1`, [orderId, ts(now())]);
        await post(c, releaseEntries(ctx("order", orderId, order.currency), { sellerId: order.sellerId, itemsMinor: order.itemsMinor, shippingMinor: order.shippingMinor, feeMinor: order.protectionFeeMinor, courierFeeMode: (await getFees()).courierFeeMode }));
        await notifyTx(c, { userId: order.sellerId, kind: "order_completed", payload: { orderId, itemTitle: await orderTitleOf(c, orderId), role: "seller" }, eventKey: `order_completed:${orderId}` });
      });
      return buildView(pool, await loadOrder(pool, orderId), buyerId);
    },

    async cancelOrder(orderId, actorId) {
      let refund: { providerRef: string; amountMinor: number } | null = null;
      await withTx(pool, async (c) => {
        const order = await loadOrder(c, orderId, true);
        if (order.buyerId !== actorId && order.sellerId !== actorId) throw notFound("Commande");
        if (order.status === "pending_payment") {
          await c.query(`update orders set status = 'cancelled', cancelled_at = $2 where id = $1`, [orderId, ts(now())]);
        } else if (order.status === "paid" || order.status === "in_delivery") {
          // ---- agent D : colis remis au coursier, l'acheteur ne peut plus annuler seul (colis perdu ou litige à la place)
          if (order.status === "in_delivery" && order.deliveryMethod === "courier" && actorId === order.buyerId)
            throw new AppError("INVALID_STATE", "Le colis est parti : signale-le comme non reçu ou ouvre un litige.", 409);
          // Après paiement, l'acheteur ne peut plus annuler seul (il pourrait avoir reçu l'article sans donner le code).
          if (actorId === order.buyerId) {
            throw new AppError("CANCEL_REQUEST_REQUIRED", "Après paiement, tu ne peux plus annuler seul : demande l'annulation au vendeur. S'il refuse, tu peux ouvrir un litige.", 409);
          }
          await closePendingTx(c, orderId);
          // Vendeur, non remis : remboursement intégral de l'acheteur.
          await post(c, refundEntries(ctx("order", orderId, order.currency), order.totalMinor));
          const pay = (await c.query(`update payments set status = 'refunded', refunded_minor = amount_minor where order_id = $1 and status = 'succeeded' returning *`, [orderId])).rows[0];
          if (pay?.provider_ref) refund = { providerRef: pay.provider_ref, amountMinor: pay.amount_minor };
          await c.query(`update orders set status = 'cancelled', cancelled_at = $2 where id = $1`, [orderId, ts(now())]);
        } else {
          throw new AppError("INVALID_STATE", "Cette commande ne peut plus être annulée.", 409);
        }
        const other = actorId === order.buyerId ? order.sellerId : order.buyerId;
        await notifyTx(c, {
          userId: other, kind: "order_cancelled", eventKey: `order_cancelled:${orderId}`,
          payload: { orderId, itemTitle: await orderTitleOf(c, orderId), role: other === order.buyerId ? "buyer" : "seller", refunded: order.status !== "pending_payment" },
        });
      });
      if (refund) await refundAtProvider(refund);
      return buildView(pool, await loadOrder(pool, orderId), actorId);
    },

    // ---- agent A : annulation encadrée
    async requestCancellation(orderId, buyerId) {
      const jobs: SmsJob[] = [];
      await withTx(pool, async (c) => {
        const order = await cancelCtx(c, orderId, buyerId, "buyer");
        const st = await cancelRequestsOf(c, orderId);
        if (st.livePending) throw new AppError("CANCEL_REQUEST_EXISTS", "Ta demande d'annulation est déjà envoyée au vendeur.", 409);
        if (st.refused) throw new AppError("CANCEL_REQUEST_REFUSED", "Le vendeur n'a pas accepté l'annulation. Si tu as un problème avec cette commande, ouvre un litige.", 409);
        const req = (await c.query(`insert into order_cancel_requests (order_id, requested_by, requested_at) values ($1,$2,$3) returning id`, [orderId, buyerId, ts(now())])).rows[0];
        await notifyTx(c, { userId: order.sellerId, kind: "cancel_requested", payload: { orderId, itemTitle: await orderTitleOf(c, orderId), role: "seller" }, eventKey: `cancel_requested:${req.id}` }, jobs); // agent F
      });
      fireSms(jobs);
      return buildView(pool, await loadOrder(pool, orderId), buyerId);
    },

    async withdrawCancellation(orderId, buyerId) {
      await withTx(pool, async (c) => {
        const order = await cancelCtx(c, orderId, buyerId, "buyer");
        const id = await pendingRequestTx(c, orderId);
        await c.query(`update order_cancel_requests set status = 'withdrawn', resolved_at = $2, resolved_by = $3 where id = $1`, [id, ts(now()), buyerId]);
        await notifyTx(c, { userId: order.sellerId, kind: "cancel_withdrawn", payload: { orderId, itemTitle: await orderTitleOf(c, orderId), role: "seller" }, eventKey: `cancel_withdrawn:${id}` }); // agent F
      });
      return buildView(pool, await loadOrder(pool, orderId), buyerId);
    },

    async acceptCancellation(orderId, sellerId) {
      let refund: { providerRef: string; amountMinor: number } | null = null;
      await withTx(pool, async (c) => {
        const order = await cancelCtx(c, orderId, sellerId, "seller");
        const id = await pendingRequestTx(c, orderId);
        refund = await refundEscrowTx(c, order);
        await c.query(`update orders set status = 'cancelled', cancelled_at = $2 where id = $1`, [orderId, ts(now())]);
        await c.query(`update order_cancel_requests set status = 'accepted', resolved_at = $2, resolved_by = $3 where id = $1`, [id, ts(now()), sellerId]);
        await notifyTx(c, { userId: order.buyerId, kind: "cancel_accepted", payload: { orderId, itemTitle: await orderTitleOf(c, orderId), role: "buyer", refunded: true }, eventKey: `cancel_accepted:${id}` }); // agent F
      });
      if (refund) await refundAtProvider(refund);
      return buildView(pool, await loadOrder(pool, orderId), sellerId);
    },

    async declineCancellation(orderId, sellerId) {
      await withTx(pool, async (c) => {
        const order = await cancelCtx(c, orderId, sellerId, "seller");
        const id = await pendingRequestTx(c, orderId);
        await c.query(`update order_cancel_requests set status = 'declined', resolved_at = $2, resolved_by = $3 where id = $1`, [id, ts(now()), sellerId]);
        await notifyTx(c, { userId: order.buyerId, kind: "cancel_declined", payload: { orderId, itemTitle: await orderTitleOf(c, orderId), role: "buyer" }, eventKey: `cancel_declined:${id}` }); // agent F
      });
      return buildView(pool, await loadOrder(pool, orderId), sellerId);
    },
    // ---- fin agent A

    async handleProviderEvent(ev) {
      let refund: { providerRef: string; amountMinor: number } | null = null;
      const jobs: SmsJob[] = [];
      const res = await withTx<{ duplicate: boolean; matched: boolean }>(pool, async (c) => {
        // Référence inconnue : on n'enregistre PAS l'événement, il pourra être rejoué (le PSP répond parfois avant
        // que notre référence soit écrite, l'appel au fournisseur se faisant hors transaction).
        const target = ev.type.startsWith("collection.")
          ? await c.query(`select 1 from payments where provider = $1 and provider_ref = $2`, [provider.name, ev.providerRef])
          : await c.query(`select 1 from payouts where provider = $1 and provider_ref = $2`, [provider.name, ev.providerRef]);
        if (!target.rowCount) return { duplicate: false, matched: false };
        const fresh = await c.query(
          `insert into webhook_events (provider, event_id, payload) values ($1,$2,$3) on conflict (provider, event_id) do nothing returning id`,
          [provider.name, ev.eventId, JSON.stringify(ev)],
        );
        if (!fresh.rowCount) return { duplicate: true, matched: true }; // même événement déjà reçu
        await expireUnpaid(c);

        if (ev.type === "collection.succeeded" || ev.type === "collection.failed") {
          const pay = (await c.query(`select * from payments where provider = $1 and provider_ref = $2 for update`, [provider.name, ev.providerRef])).rows[0];
          if (!pay) return { duplicate: false, matched: false };
          if (pay.status === "succeeded" || pay.status === "refunded") return { duplicate: true, matched: true }; // déjà encaissé : aucun effet
          const order = await loadOrder(c, pay.order_id, true);
          if (ev.type === "collection.failed") {
            await c.query(`update payments set status = 'failed', failure_code = $2 where id = $1`, [pay.id, ev.failureCode ?? "DECLINED"]);
          } else if (order.status === "pending_payment") {
            await c.query(`update payments set status = 'succeeded' where id = $1`, [pay.id]);
            await c.query(`update orders set status = 'paid', paid_at = $2 where id = $1`, [order.id, ts(now())]);
            await post(c, holdEntries(ctx("payment", pay.id, order.currency), order.totalMinor));
            const sh = (await c.query(`insert into shipments (order_id, method, status, handover_code_hash) values ($1,$2,'pending',$3) returning id`,
              [order.id, order.deliveryMethod, order.deliveryMethod === "courier" ? null : hashCode(deriveHandoverCode(order.id))])).rows[0];
            if (order.deliveryMethod === "courier") await logShipment(c, sh.id, order.id, "paid", null);
            await notifyTx(c, { userId: order.sellerId, kind: "order_paid", payload: { orderId: order.id, itemTitle: await orderTitleOf(c, order.id), role: "seller" }, eventKey: `order_paid:${order.id}` }, jobs);
          } else {
            // Paiement arrivé APRÈS expiration ou annulation : on ne garde jamais l'argent, remboursement automatique.
            await post(c, holdEntries(ctx("payment", pay.id, order.currency), pay.amount_minor));
            await post(c, refundEntries(ctx("payment", pay.id, order.currency), pay.amount_minor));
            await c.query(`update payments set status = 'refunded', refunded_minor = amount_minor where id = $1`, [pay.id]);
            if (pay.provider_ref) refund = { providerRef: pay.provider_ref, amountMinor: pay.amount_minor };
          }
        } else {
          const po = (await c.query(`select * from payouts where provider = $1 and provider_ref = $2 for update`, [provider.name, ev.providerRef])).rows[0];
          if (!po) return { duplicate: false, matched: false };
          if (po.status === "paid" || po.status === "failed") return { duplicate: true, matched: true };
          const cx = ctx("payout", po.id, po.currency);
          if (ev.type === "payout.succeeded") {
            await c.query(`update payouts set status = 'paid', paid_at = $2 where id = $1`, [po.id, ts(now())]);
            await post(c, payoutPaidEntries(cx, { userId: po.user_id, amountMinor: po.amount_minor }));
          } else {
            await c.query(`update payouts set status = 'failed', failure_code = $2 where id = $1`, [po.id, ev.failureCode ?? "FAILED"]);
            await post(c, payoutFailedEntries(cx, { userId: po.user_id, amountMinor: po.amount_minor, feeMinor: po.fee_minor }));
          }
        }
        await c.query(`update webhook_events set processed_at = $3 where provider = $1 and event_id = $2`, [provider.name, ev.eventId, ts(now())]);
        return { duplicate: false, matched: true };
      });
      fireSms(jobs);
      if (refund) await refundAtProvider(refund);
      return res;
    },

    // ================================================================ portefeuille
    async startConversation(buyerId, itemId) {
      if (!isUuid(buyerId) || !isUuid(itemId)) throw notFound("Annonce");
      const me = (await pool.query(`select 1 from profiles where id = $1 and deleted_at is null`, [buyerId])).rows[0];
      if (!me) throw notFound("Compte");
      const it = (await pool.query(`select i.seller_id, i.status, p.deleted_at from items i join profiles p on p.id = i.seller_id where i.id = $1`, [itemId])).rows[0];
      if (!it || !["active", "reserved", "sold"].includes(it.status)) throw notFound("Annonce");
      if (it.seller_id === buyerId) throw new AppError("OWN_ITEM", "C'est ton annonce : tu ne peux pas t'écrire à toi-même.", 409);
      if (it.deleted_at) throw new AppError("MEMBER_DELETED", "Ce membre a supprimé son compte.", 409);
      // Une seule conversation par (annonce, acheteur) : l'insertion concurrente retombe sur la ligne existante.
      const ins = await pool.query(
        `insert into conversations (item_id, buyer_id, seller_id, created_at) values ($1, $2, $3, $4)
         on conflict (item_id, buyer_id) do nothing returning id`, [itemId, buyerId, it.seller_id, ts(now())]);
      if (ins.rows[0]) return { id: ins.rows[0].id as string, created: true };
      const ex = (await pool.query(`select id from conversations where item_id = $1 and buyer_id = $2`, [itemId, buyerId])).rows[0];
      return { id: ex.id as string, created: false };
    },

    async listConversations(userId) {
      if (!isUuid(userId)) return [];
      const r = await pool.query(
        `select c.id, c.item_id, c.last_message_at, c.buyer_id, c.seller_id, i.title,
           (select storage_path from item_photos where item_id = i.id order by position limit 1) as first_photo,
           p.id as p_id, p.display_name, p.bio, p.area_id as p_area, p.verification_level, p.rating_avg, p.rating_count, p.deleted_at,
           (select case when kind = 'image' and body = '' then 'Photo' else body end from messages where conversation_id = c.id order by seq desc limit 1) as last_body,
           (select count(*)::int from messages where conversation_id = c.id and read_at is null and sender_id is distinct from $1) as unread
         from conversations c join items i on i.id = c.item_id
         join profiles p on p.id = case when c.buyer_id = $1 then c.seller_id else c.buyer_id end
         where c.buyer_id = $1 or c.seller_id = $1
         order by c.last_message_at desc nulls last, c.created_at desc limit 100`, [userId]);
      return r.rows.map((x): ConversationSummary => ({
        id: x.id, itemId: x.item_id, itemTitle: x.title, itemPhoto: x.first_photo ? photoUrl(x.first_photo) : null,
        counterpart: x.deleted_at
          ? DELETED_PROFILE(x.p_id)
          : profileOf({ id: x.p_id, display_name: x.display_name, bio: x.bio, area_id: x.p_area, verification_level: x.verification_level, rating_avg: x.rating_avg, rating_count: x.rating_count }),
        lastMessage: x.last_body ? String(x.last_body).slice(0, 140) : null,
        lastMessageAt: x.last_message_at ? x.last_message_at.getTime() : null, unread: x.unread,
      }));
    },

    async getConversation(conversationId, viewerId) {
      if (!isUuid(conversationId) || !isUuid(viewerId)) throw notFound("Conversation");
      const c = (await pool.query(`select id from conversations where id = $1 and (buyer_id = $2 or seller_id = $2)`, [conversationId, viewerId])).rows[0];
      if (!c) throw notFound("Conversation");
      await pool.query(`update messages set read_at = $3 where conversation_id = $1 and read_at is null and sender_id is distinct from $2`, [conversationId, viewerId, ts(now())]);
      await pool.query(`update notifications set read_at = $2 where user_id = $1 and group_key = $3 and read_at is null`, [viewerId, ts(now()), `conv:${conversationId}`]); // agent C : ouvrir la conversation lit sa notification
      const summary = (await api.listConversations(viewerId)).find((s) => s.id === conversationId);
      if (!summary) throw notFound("Conversation");
      const msgs = await pool.query(
        `select m.id, m.sender_id, m.kind, m.body, m.flagged, m.created_at, pp.id as photo_id, sp.display_name as sender_name
         from messages m left join private_photos pp on pp.message_id = m.id left join profiles sp on sp.id = m.sender_id
         where m.conversation_id = $1 order by m.seq`, [conversationId]);
      return {
        ...summary,
        messages: msgs.rows.map((m): ChatMessage => chatMessageOf(m, viewerId)),
      };
    },

    async sendMessage(conversationId, senderId, body) {
      if (!isUuid(conversationId) || !isUuid(senderId)) throw notFound("Conversation");
      const text = body.trim();
      if (text.length < 1) throw new AppError("VALIDATION", "Écris un message.", 422, { body: "Écris un message." });
      if (text.length > MESSAGE_MAX) throw new AppError("VALIDATION", "Un message est limité à 2 000 caractères.", 422, { body: "Un message est limité à 2 000 caractères." });
      const c = (await pool.query(
        `select c.buyer_id, c.seller_id, p.deleted_at from conversations c
         join profiles p on p.id = case when c.buyer_id = $2 then c.seller_id else c.buyer_id end
         where c.id = $1 and (c.buyer_id = $2 or c.seller_id = $2)`, [conversationId, senderId])).rows[0];
      if (!c) throw notFound("Conversation");
      if (c.deleted_at) throw new AppError("MEMBER_DELETED", "Ce membre a supprimé son compte.", 409);
      const flagged = detectOffPlatform(text);
      const at = ts(now());
      const row = await withTx(pool, async (tx) => {
        const m = (await tx.query(
          `insert into messages (conversation_id, sender_id, kind, body, flagged, flag_reason, created_at) values ($1, $2, 'text', $3, $4, $5, $6) returning id`,
          [conversationId, senderId, text, flagged !== null, flagged, at])).rows[0];
        await tx.query(`update conversations set last_message_at = $2 where id = $1`, [conversationId, at]);
        const other = c.buyer_id === senderId ? c.seller_id : c.buyer_id;
        const info = (await tx.query(
          `select (select title from items where id = cv.item_id) as title, (select display_name from profiles where id = $2) as sender from conversations cv where cv.id = $1`,
          [conversationId, senderId])).rows[0];
        await notifyTx(tx, { userId: other, kind: "message_received", payload: { conversationId, itemTitle: info?.title ?? "Article", senderName: info?.sender ?? "Un membre" }, groupKey: `conv:${conversationId}` });
        return m;
      });
      const me = (await pool.query(`select display_name from profiles where id = $1`, [senderId])).rows[0];
      return { id: row.id as string, mine: true, kind: "text" as const, body: text, photoUrl: null, senderName: me?.display_name ?? null, flagged: flagged !== null, createdAt: at.getTime() };
    },

    // ---- agent B : photos de preuve et de messagerie
    async sendPhotoMessage(conversationId, senderId, input) {
      if (!isUuid(conversationId) || !isUuid(senderId)) throw notFound("Conversation");
      const text = (input.body ?? "").trim();
      if (text.length > MESSAGE_MAX) throw new AppError("VALIDATION", "Un message est limité à 2 000 caractères.", 422, { body: "Un message est limité à 2 000 caractères." });
      const photo = decodePhotoDataUrl(input.photo);
      if (!photo) throw new AppError("VALIDATION", "Une photo est invalide ou trop lourde.", 422, { photo: PHOTO_INVALID_MESSAGE });
      const c = (await pool.query(
        `select c.buyer_id, c.seller_id, p.deleted_at, me.display_name as my_name from conversations c
         join profiles p on p.id = case when c.buyer_id = $2 then c.seller_id else c.buyer_id end
         join profiles me on me.id = $2
         where c.id = $1 and (c.buyer_id = $2 or c.seller_id = $2)`, [conversationId, senderId])).rows[0];
      if (!c) throw notFound("Conversation");
      if (c.deleted_at) throw new AppError("MEMBER_DELETED", "Ce membre a supprimé son compte.", 409);
      const flagged = detectOffPlatform(text);
      const at = ts(now());
      const row = await withTx(pool, async (tx) => {
        const m = (await tx.query(
          `insert into messages (conversation_id, sender_id, kind, body, flagged, flag_reason, created_at) values ($1, $2, 'image', $3, $4, $5, $6) returning id`,
          [conversationId, senderId, text, flagged !== null, flagged, at])).rows[0];
        const ph = (await tx.query(
          `insert into private_photos (owner_id, mime, size, content, message_id, created_at) values ($1,$2,$3,$4,$5,$6) returning id`,
          [senderId, photo.mime, photo.bytes.length, photo.bytes, m.id, at])).rows[0];
        await tx.query(`update conversations set last_message_at = $2 where id = $1`, [conversationId, at]);
        // agent F : une photo reçue notifie comme un message (même regroupement par conversation)
        const other = c.buyer_id === senderId ? c.seller_id : c.buyer_id;
        const title = (await tx.query(`select i.title from conversations cv join items i on i.id = cv.item_id where cv.id = $1`, [conversationId])).rows[0]?.title;
        await notifyTx(tx, { userId: other, kind: "message_received", payload: { conversationId, itemTitle: title ?? "Article", senderName: c.my_name as string }, groupKey: `conv:${conversationId}` });
        return { id: m.id as string, photoId: ph.id as string };
      });
      return { id: row.id, mine: true, kind: "image" as const, body: text, photoUrl: privatePhotoUrl(row.photoId), senderName: c.my_name as string, flagged: flagged !== null, createdAt: at.getTime() };
    },

    async addDisputeEvidence(disputeId, authorId, input) {
      await disputeViewOf(pool, disputeId, authorId); // 404 pour un tiers
      const note = (input.note ?? "").trim();
      if (note.length > 500) throw new AppError("VALIDATION", "La note est limitée à 500 caractères.", 422, { note: "La note est limitée à 500 caractères." });
      const photo = decodePhotoDataUrl(input.photo);
      if (!photo) throw new AppError("VALIDATION", "Une photo est invalide ou trop lourde.", 422, { photo: PHOTO_INVALID_MESSAGE });
      await withTx(pool, async (c) => {
        // Verrou sur le litige : deux envois simultanés ne peuvent pas dépasser la limite.
        const d = (await c.query(`select status from disputes where id = $1 for update`, [disputeId])).rows[0];
        if (!d) throw notFound("Litige");
        if (d.status !== "open") throw new AppError("INVALID_STATE", "Ce litige est clos.", 409);
        const n = (await c.query(`select count(*)::int as n from dispute_evidence where dispute_id = $1 and author_id = $2 and storage_path is not null`, [disputeId, authorId])).rows[0].n as number;
        if (n >= MAX_EVIDENCE_PER_MEMBER) throw new AppError("EVIDENCE_LIMIT", `Tu as déjà ajouté ${MAX_EVIDENCE_PER_MEMBER} photos à ce litige : c'est le maximum.`, 409);
        const at = ts(now());
        const photoId = randomUUID();
        const e = (await c.query(
          `insert into dispute_evidence (dispute_id, author_id, storage_path, note, created_at) values ($1,$2,$3,$4,$5) returning id`,
          [disputeId, authorId, `pp:${photoId}`, note || null, at])).rows[0];
        await c.query(
          `insert into private_photos (id, owner_id, mime, size, content, evidence_id, created_at) values ($1,$2,$3,$4,$5,$6,$7)`,
          [photoId, authorId, photo.mime, photo.bytes.length, photo.bytes, e.id, at]);
        // agent F : l'autre partie est prévenue (les deux parties si c'est l'assistance)
        const order = await loadOrder(c, (await c.query(`select order_id from disputes where id = $1`, [disputeId])).rows[0].order_id as string);
        const title = await orderTitleOf(c, order.id);
        await notifyParties(c, order, () => ({ kind: "dispute_evidence", payload: { orderId: order.id, disputeId, itemTitle: title }, eventKey: `dispute_evidence:${e.id}` }), undefined, authorId);
      });
      return disputeViewOf(pool, disputeId, authorId);
    },

    async getPrivatePhoto(id, viewerId) {
      if (!isUuid(id) || !isUuid(viewerId)) return null;
      // Une seule requête décide de l'accès : participant de la conversation du message, ou partie / assistance du litige de la preuve.
      const r = await pool.query(
        `select pp.mime, pp.content from private_photos pp
         left join messages m on m.id = pp.message_id
         left join conversations cv on cv.id = m.conversation_id
         left join dispute_evidence ev on ev.id = pp.evidence_id
         left join disputes d on d.id = ev.dispute_id
         left join orders o on o.id = d.order_id
         join profiles v on v.id = $2 and v.deleted_at is null
         where pp.id = $1 and (
           (pp.message_id is not null and $2 in (cv.buyer_id, cv.seller_id))
           or (pp.evidence_id is not null and ($2 in (o.buyer_id, o.seller_id) or v.role in ('support', 'admin')))
         )`, [id, viewerId]);
      return r.rows[0] ? { mime: r.rows[0].mime as string, bytes: r.rows[0].content as Buffer } : null;
    },

    async openDispute(orderId, userId, input) {
      if (!isUuid(orderId) || !isUuid(userId)) throw notFound("Commande");
      const text = input.description.trim();
      const jobs: SmsJob[] = [];
      const id = await withTx(pool, async (c) => {
        const order = await loadOrder(c, orderId, true);
        if (order.buyerId !== userId && order.sellerId !== userId) throw notFound("Commande");
        if (order.status === "disputed") throw new AppError("DISPUTE_EXISTS", "Un litige est déjà ouvert sur cette commande.", 409);
        if (order.status === "delivered") {
          // ---- agent D : après « reçu » (livraison par coursier), litige possible pour l'acheteur seul, pendant la fenêtre de réclamation
          if (order.buyerId !== userId) throw new AppError("INVALID_STATE", "Après la livraison, seul l'acheteur peut ouvrir un litige.", 409);
          if (order.autoReleaseAt == null || now() >= order.autoReleaseAt) throw new AppError("INVALID_STATE", "La fenêtre de réclamation est terminée.", 409);
        } else if (order.status !== "paid" && order.status !== "in_delivery") throw new AppError("INVALID_STATE", "Un litige ne peut être ouvert que sur une commande payée et pas encore remise.", 409);
        if (text.length < 10) throw new AppError("VALIDATION", "Décris le problème en quelques mots (10 caractères au moins).", 422, { description: "Décris le problème en quelques mots (10 caractères au moins)." });
        if (text.length > 2000) throw new AppError("VALIDATION", "La description est limitée à 2 000 caractères.", 422, { description: "La description est limitée à 2 000 caractères." });
        if (!["not_received", "damaged", "not_as_described", "other"].includes(input.reason)) throw new AppError("VALIDATION", "Choisis le motif du problème.", 422, { reason: "Choisis le motif du problème." });
        await c.query(`update orders set status = 'disputed' where id = $1`, [orderId]);
        const d = (await c.query(
          `insert into disputes (order_id, opened_by, reason, description, status, opened_at, updated_at) values ($1,$2,$3,$4,'open',$5,$5) returning id`,
          [orderId, userId, input.reason, text, ts(now())])).rows[0];
        const other = userId === order.buyerId ? order.sellerId : order.buyerId;
        await notifyTx(c, { userId: other, kind: "dispute_opened", payload: { orderId, disputeId: d.id, itemTitle: await orderTitleOf(c, orderId) }, eventKey: `dispute_opened:${d.id}` }, jobs);
        return d.id as string;
      });
      fireSms(jobs);
      return disputeViewOf(pool, id, userId);
    },

    async getOrderDispute(orderId, viewerId) {
      if (!isUuid(orderId) || !isUuid(viewerId)) throw notFound("Commande");
      const o = (await pool.query(`select buyer_id, seller_id from orders where id = $1`, [orderId])).rows[0];
      if (!o || (o.buyer_id !== viewerId && o.seller_id !== viewerId)) throw notFound("Commande");
      const d = (await pool.query(`select id from disputes where order_id = $1 order by opened_at desc limit 1`, [orderId])).rows[0];
      return d ? disputeViewOf(pool, d.id, viewerId) : null;
    },

    async getDisputeById(disputeId, viewerId) {
      return disputeViewOf(pool, disputeId, viewerId);
    },

    async addDisputeNote(disputeId, authorId, note) {
      const v = await disputeViewOf(pool, disputeId, authorId); // 404 pour un tiers
      if (v.status !== "open") throw new AppError("INVALID_STATE", "Ce litige est clos.", 409);
      const text = note.trim();
      if (text.length < 1 || text.length > 1000) throw new AppError("VALIDATION", "Un message fait entre 1 et 1 000 caractères.", 422, { note: "Un message fait entre 1 et 1 000 caractères." });
      await withTx(pool, async (c) => {
        const ev = (await c.query(`insert into dispute_evidence (dispute_id, author_id, note, created_at) values ($1,$2,$3,$4) returning id`, [disputeId, authorId, text, ts(now())])).rows[0];
        const order = await loadOrder(c, (await c.query(`select order_id from disputes where id = $1`, [disputeId])).rows[0].order_id);
        const title = await orderTitleOf(c, order.id);
        await notifyParties(c, order, () => ({ kind: "dispute_message", payload: { orderId: order.id, disputeId, itemTitle: title }, eventKey: `dispute_message:${ev.id}` }), undefined, authorId);
      });
      return disputeViewOf(pool, disputeId, authorId);
    },

    // ---- agent G : frais de livraison par coursier
    async getCourierFeeMode() {
      return (await getFees()).courierFeeMode;
    },
    async setCourierFeeMode(adminId, mode) {
      await requireRole(pool, adminId, ["admin"]);
      if (!COURIER_FEE_MODES.includes(mode)) throw new AppError("VALIDATION", "Mode inconnu.", 422);
      await pool.query(
        `insert into settings (key, value, updated_at) values ('courier_fee_mode', $1, now()) on conflict (key) do update set value = excluded.value, updated_at = now()`,
        [JSON.stringify(mode)]);
      getFees.invalidate();
      return mode;
    },
    async listCourierDues(staffId) {
      await requireRole(pool, staffId, ["support", "admin"]);
      const r = await pool.query(
        `select l.ref_id as order_id, l.currency, -sum(l.amount_minor) as due, o.completed_at, o.created_at, s.courier_name, s.courier_phone,
           (select i.title from order_items oi join items i on i.id = oi.item_id where oi.order_id = o.id order by i.id limit 1) as item_title
         from ledger_entries l join orders o on o.id = l.ref_id left join shipments s on s.order_id = o.id
         where l.account = 'shipping_payable' group by l.ref_id, l.currency, o.id, s.courier_name, s.courier_phone having sum(l.amount_minor) < 0
         order by coalesce(o.completed_at, o.created_at) limit 500`);
      return r.rows.map((x): CourierDue => ({
        orderId: x.order_id, itemTitle: x.item_title ?? "Article", currency: x.currency, amountMinor: Number(x.due),
        courierName: x.courier_name ?? null, courierPhone: x.courier_phone ?? null, releasedAt: (x.completed_at ?? x.created_at).getTime(),
      }));
    },
    async settleCourierFee(staffId, orderId) {
      await requireRole(pool, staffId, ["support", "admin"]);
      return withTx(pool, async (c) => {
        const order = await loadOrder(c, orderId, true); // verrou de la commande : deux règlements simultanés se sérialisent
        const due = -Number((await c.query(`select coalesce(sum(amount_minor), 0) as s from ledger_entries where account = 'shipping_payable' and ref_id = $1`, [orderId])).rows[0].s);
        if (due <= 0) throw new AppError("INVALID_STATE", "Aucun frais de livraison à régler pour cette commande.", 409);
        await c.query(`insert into courier_settlements (order_id, settled_by, amount_minor, currency, settled_at) values ($1,$2,$3,$4,$5)`, [orderId, staffId, due, order.currency, ts(now())]);
        await post(c, courierSettleEntries(ctx("order", orderId, order.currency), due));
        return { orderId, amountMinor: due, currency: order.currency };
      });
    },

    async listOpenDisputes(staffId) {
      await requireRole(pool, staffId, ["support", "admin"]);
      const r = await pool.query(
        `select d.id, d.order_id, d.reason, d.opened_at, o.total_minor, o.currency,
           (select i.title from order_items oi join items i on i.id = oi.item_id where oi.order_id = o.id order by i.id limit 1) as item_title
         from disputes d join orders o on o.id = d.order_id where d.status = 'open' order by d.opened_at limit 200`);
      return r.rows.map((x): DisputeSummary => ({ id: x.id, orderId: x.order_id, reason: x.reason, openedAt: x.opened_at.getTime(), itemTitle: x.item_title ?? "Article", totalMinor: Number(x.total_minor), currency: x.currency }));
    },

    async resolveDispute(staffId, disputeId, outcome: DisputeOutcome, note) {
      await requireRole(pool, staffId, ["support", "admin"]);
      if (!isUuid(disputeId)) throw notFound("Litige");
      let refund: { providerRef: string; amountMinor: number } | null = null;
      const jobs: SmsJob[] = [];
      await withTx(pool, async (c) => {
        const d = (await c.query(`select * from disputes where id = $1 for update`, [disputeId])).rows[0];
        if (!d) throw notFound("Litige");
        if (d.status !== "open") throw new AppError("INVALID_STATE", "Ce litige est déjà clos.", 409);
        const order = await loadOrder(c, d.order_id, true);
        if (order.status !== "disputed") throw new AppError("INVALID_STATE", "La commande n'est plus en litige.", 409);
        const at = ts(now());
        if (outcome === "refund_buyer") {
          refund = await refundEscrowTx(c, order);
          await c.query(`update orders set status = 'refunded' where id = $1`, [order.id]);
        } else {
          await c.query(`update shipments set status = 'delivered', delivered_confirmed_by = 'auto' where order_id = $1`, [order.id]).catch(() => undefined);
          await c.query(`update orders set status = 'completed', completed_at = $2, delivered_at = coalesce(delivered_at, $2) where id = $1`, [order.id, at]);
          await post(c, releaseEntries(ctx("order", order.id, order.currency), { sellerId: order.sellerId, itemsMinor: order.itemsMinor, shippingMinor: order.shippingMinor, feeMinor: order.protectionFeeMinor, courierFeeMode: (await getFees()).courierFeeMode }));
        }
        await c.query(`update disputes set status = $2, resolved_by = $3, resolved_at = $4, updated_at = $4 where id = $1`,
          [disputeId, outcome === "refund_buyer" ? "resolved_refund" : "resolved_release", staffId, at]);
        const text = (note ?? "").trim();
        if (text) await c.query(`insert into dispute_evidence (dispute_id, author_id, note, created_at) values ($1,$2,$3,$4)`, [disputeId, staffId, text.slice(0, 1000), at]);
        const title = await orderTitleOf(c, order.id);
        await notifyParties(c, order, () => ({ kind: "dispute_resolved", payload: { orderId: order.id, disputeId, itemTitle: title, outcome }, eventKey: `dispute_resolved:${disputeId}` }), jobs, staffId);
      });
      fireSms(jobs);
      if (refund) await refundAtProvider(refund);
      return disputeViewOf(pool, disputeId, staffId);
    },

    async expireStalePaidOrders() {
      const fees = await getFees();
      const cutoff = ts(now() - fees.unhandedOrderMs);
      const ids = (await pool.query(`select id from orders where status in ('paid','in_delivery') and not (status = 'in_delivery' and delivery_method = 'courier') and paid_at <= $1 order by paid_at limit 200`, [cutoff])).rows.map((r) => r.id as string);
      let n = 0;
      for (const id of ids) {
        let refund: { providerRef: string; amountMinor: number } | null = null;
        const done = await withTx(pool, async (c) => {
          const order = await loadOrder(c, id, true);
          if (order.status !== "paid" && order.status !== "in_delivery") return false; // changé entre-temps (litige, remise)
          refund = await refundEscrowTx(c, order);
          await c.query(`update orders set status = 'cancelled', cancelled_at = $2 where id = $1`, [id, ts(now())]);
          await closePendingTx(c, id);
          const title = await orderTitleOf(c, id);
          await notifyParties(c, order, (role) => ({ kind: "order_cancelled", payload: { orderId: id, itemTitle: title, role, auto: true, refunded: true }, eventKey: `order_cancelled:${id}` }));
          return true;
        });
        if (done) { n++; if (refund) await refundAtProvider(refund); }
      }
      return n;
    },

    async createReview(orderId, authorId, input) {
      if (!isUuid(orderId) || !isUuid(authorId)) throw notFound("Commande");
      const comment = input.comment.trim();
      return withTx(pool, async (c) => {
        const order = await loadOrder(c, orderId, true);
        if (order.buyerId !== authorId && order.sellerId !== authorId) throw notFound("Commande");
        if (order.status !== "completed") throw new AppError("INVALID_STATE", "Tu pourras donner ton avis une fois la vente terminée.", 409);
        if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) throw new AppError("VALIDATION", "Choisis une note de 1 à 5.", 422, { rating: "Choisis une note de 1 à 5." });
        if (comment.length > 500) throw new AppError("VALIDATION", "Un avis est limité à 500 caractères.", 422, { comment: "Un avis est limité à 500 caractères." });
        const targetId = authorId === order.buyerId ? order.sellerId : order.buyerId;
        const at = ts(now());
        let row;
        try {
          row = (await c.query(`insert into reviews (order_id, author_id, target_id, rating, comment, created_at) values ($1,$2,$3,$4,$5,$6) returning id`,
            [orderId, authorId, targetId, input.rating, comment || null, at])).rows[0];
        } catch (e) {
          if (pgCode(e) === "23505") throw new AppError("REVIEW_EXISTS", "Tu as déjà donné ton avis sur cette commande.", 409);
          throw e;
        }
        await c.query(
          `update profiles set rating_avg = round(((coalesce(rating_avg, 0) * rating_count + $2) / (rating_count + 1))::numeric, 2), rating_count = rating_count + 1 where id = $1`,
          [targetId, input.rating]);
        await notifyTx(c, { userId: targetId, kind: "review_received", payload: { orderId, itemTitle: await orderTitleOf(c, orderId), rating: input.rating }, eventKey: `review:${row.id}` });
        const me = (await c.query(`select display_name from profiles where id = $1`, [authorId])).rows[0];
        return { id: row.id as string, orderId, authorName: me.display_name as string, rating: input.rating, comment, createdAt: at.getTime() } as Review;
      });
    },

    async getMyReview(orderId, authorId) {
      if (!isUuid(orderId) || !isUuid(authorId)) throw notFound("Commande");
      const o = (await pool.query(`select buyer_id, seller_id from orders where id = $1`, [orderId])).rows[0];
      if (!o || (o.buyer_id !== authorId && o.seller_id !== authorId)) throw notFound("Commande");
      const r = (await pool.query(`select r.*, p.display_name from reviews r join profiles p on p.id = r.author_id where r.order_id = $1 and r.author_id = $2`, [orderId, authorId])).rows[0];
      return r ? { id: r.id, orderId, authorName: r.display_name, rating: r.rating, comment: r.comment ?? "", createdAt: r.created_at.getTime() } : null;
    },

    async listReviews(userId) {
      if (!isUuid(userId)) return [];
      const r = await pool.query(
        `select r.*, p.display_name from reviews r join profiles p on p.id = r.author_id where r.target_id = $1 order by r.created_at desc limit 30`, [userId]);
      return r.rows.map((x): Review => ({ id: x.id, orderId: x.order_id, authorName: x.display_name, rating: x.rating, comment: x.comment ?? "", createdAt: x.created_at.getTime() }));
    },

    async createReport(reporterId, input) {
      if (!isUuid(reporterId)) throw notFound("Compte");
      if (!isUuid(input.targetId)) throw notFound(input.targetType === "item" ? "Annonce" : "Membre");
      if (!(await roleOf(pool, reporterId))) throw notFound("Compte");
      if (input.targetType === "item") {
        const it = (await pool.query(`select seller_id, status from items where id = $1`, [input.targetId])).rows[0];
        if (!it || it.status === "draft" || it.status === "removed") throw notFound("Annonce");
        if (it.seller_id === reporterId) throw new AppError("OWN_TARGET", "Tu ne peux pas signaler ta propre annonce.", 409);
      } else {
        if (!(await roleOf(pool, input.targetId))) throw notFound("Membre");
        if (input.targetId === reporterId) throw new AppError("OWN_TARGET", "Tu ne peux pas te signaler toi-même.", 409);
      }
      const details = input.details.trim();
      if (details.length > 1000) throw new AppError("VALIDATION", "Les précisions sont limitées à 1 000 caractères.", 422, { details: "Les précisions sont limitées à 1 000 caractères." });
      const dup = (await pool.query(`select id from reports where reporter_id = $1 and target_type = $2 and target_id = $3 and status = 'open'`, [reporterId, input.targetType, input.targetId])).rows[0];
      if (dup) return { id: dup.id as string, created: false };
      const r = (await pool.query(
        `insert into reports (reporter_id, target_type, target_id, reason, details, created_at) values ($1,$2,$3,$4,$5,$6) returning id`,
        [reporterId, input.targetType, input.targetId, input.reason, details || null, ts(now())])).rows[0];
      return { id: r.id as string, created: true };
    },

    async listReports(staffId, status = "open") {
      await requireRole(pool, staffId, ["moderator", "support", "admin"]);
      const ids = (await pool.query(`select id from reports where status = $1 order by created_at limit 200`, [status])).rows.map((r) => r.id as string);
      return Promise.all(ids.map((id) => reportViewOf(pool, id)));
    },

    async handleReport(staffId, reportId, action: ReportAction) {
      await requireRole(pool, staffId, ["moderator", "support", "admin"]);
      if (!isUuid(reportId)) throw notFound("Signalement");
      await withTx(pool, async (c) => {
        const r = (await c.query(`select * from reports where id = $1 for update`, [reportId])).rows[0];
        if (!r) throw notFound("Signalement");
        if (r.status !== "open") throw new AppError("INVALID_STATE", "Ce signalement est déjà traité.", 409);
        let status: "actioned" | "dismissed" = "actioned";
        let suspended: { userId: string; until: number } | null = null;
        if (action === "dismiss") status = "dismissed";
        else if (action === "hide_item") {
          if (r.target_type !== "item") throw new AppError("VALIDATION", "Seule une annonce peut être masquée.", 422);
          const hid = (await c.query(`update items set status = 'hidden', updated_at = $2 where id = $1 and status = 'active' returning id, seller_id, title`, [r.target_id, ts(now())])).rows[0];
          // agent F : le vendeur est prévenu, sans le détail du signalement (ni motif, ni auteur)
          if (hid && hid.seller_id !== staffId) await notifyTx(c, { userId: hid.seller_id, kind: "listing_hidden", payload: { itemId: hid.id, itemTitle: hid.title }, eventKey: `listing_hidden:${reportId}` });
        } else {
          const userId = r.target_type === "user" ? r.target_id : (await c.query(`select seller_id from items where id = $1`, [r.target_id])).rows[0]?.seller_id;
          if (!userId) throw notFound("Membre");
          await c.query(`insert into sanctions (user_id, kind, reason, starts_at, ends_at, created_by) values ($1,'suspension',$2,$3,$4,$5)`,
            [userId, `signalement ${r.reason}`, ts(now()), ts(now() + 7 * ONE_DAY), staffId]);
          await c.query(`delete from sessions where user_id = $1`, [userId]);
          suspended = { userId, until: now() + 7 * ONE_DAY };
        }
        await c.query(`update reports set status = $2, handled_by = $3 where id = $1`, [reportId, status, staffId]);
        if (suspended) await notifyTx(c, { userId: (suspended as { userId: string }).userId, kind: "suspension", payload: { until: (suspended as { until: number }).until }, eventKey: `suspension:${reportId}` });
        if (r.reporter_id !== staffId) await notifyTx(c, { userId: r.reporter_id, kind: "report_handled", payload: {}, eventKey: `report_handled:${reportId}` });
      });
      return reportViewOf(pool, reportId);
    },

    async getWallet(userId) {
      const r = await pool.query(
        `select account, currency, coalesce(sum(amount_minor), 0) as s from ledger_entries where user_id = $1 and account in ('seller_available','payout_pending') group by account, currency`, [userId]);
      const e = await pool.query(
        `select id, created_at, currency, amount_minor, ref_type from ledger_entries where user_id = $1 and account = 'seller_available' order by created_at desc, id limit 100`, [userId]);
      const balances = (["USD", "CDF"] as Currency[])
        .map((currency) => {
          const sum = (a: string) => -Number(r.rows.find((x) => x.account === a && x.currency === currency)?.s ?? 0);
          return { currency, availableMinor: sum("seller_available"), pendingMinor: sum("payout_pending") };
        })
        .filter((b) => b.availableMinor !== 0 || b.pendingMinor !== 0 || e.rows.some((x) => x.currency === b.currency));
      const entries: Wallet["entries"] = e.rows.map((x) => ({
        id: x.id, at: x.created_at.getTime(), currency: x.currency, amountMinor: -x.amount_minor,
        label: x.ref_type === "order" ? "Vente" : x.ref_type === "order_shipping" ? "Frais de livraison à remettre au coursier" : x.ref_type === "payout" ? (x.amount_minor > 0 ? "Retrait" : "Retrait annulé") : "Ajustement",
      }));
      return { balances, entries };
    },

    async requestPayout(userId, input) {
      const fees = await getFees();
      if (input.currency !== "USD" && input.currency !== "CDF") throw new AppError("VALIDATION", "Devise non prise en charge.", 422);
      if (!METHODS.includes(input.method)) throw new AppError("VALIDATION", "Moyen de retrait non pris en charge.", 422);
      const msisdn = normalizeDrcPhone(input.msisdn);
      if (!msisdn) throw new AppError("PHONE_INVALID", "Numéro de téléphone invalide.", 422);
      const amount = input.amountMinor;
      if (!Number.isInteger(amount) || amount <= 0) throw new AppError("VALIDATION", "Indique un montant valide.", 422);
      if (input.currency === "CDF" && amount % 100 !== 0) throw new AppError("VALIDATION", "Le montant en francs doit être un nombre entier.", 422);
      if (amount < fees.payout.minMinor[input.currency]) throw new AppError("BELOW_MINIMUM", "Le montant est inférieur au minimum de retrait.", 422);
      const fee = payoutFee(amount, fees);
      let created: { payout: Payout; isNew: boolean };
      try {
        created = await withTx(pool, async (c) => {
          const dup = (await c.query(`select * from payouts where idempotency_key = $1`, [input.idempotencyKey])).rows[0];
          if (dup) {
            if (dup.user_id !== userId) throw new AppError("IDEMPOTENCY_CONFLICT", "Clé d'idempotence déjà utilisée.", 409);
            return { payout: payoutOf(dup), isNew: false };
          }
          // Verrou consultatif PAR MEMBRE : deux retraits simultanés ne peuvent pas dépenser deux fois le même solde.
          await c.query(`select pg_advisory_xact_lock(hashtext($1))`, [`wallet:${userId}`]);
          if ((await walletBalance(c, userId, "seller_available", input.currency)) < amount + fee)
            throw new AppError("INSUFFICIENT_FUNDS", "Ton solde disponible est insuffisant (frais de retrait inclus).", 409);
          const p = (await c.query(
            `insert into payouts (user_id, amount_minor, fee_minor, currency, method, msisdn, status, idempotency_key, requested_at)
             values ($1,$2,$3,$4,$5,$6,'requested',$7,$8) returning *`,
            [userId, amount, fee, input.currency, input.method, msisdn, input.idempotencyKey, ts(now())])).rows[0];
          await post(c, payoutRequestEntries(ctx("payout", p.id, input.currency), { userId, amountMinor: amount, feeMinor: fee }));
          return { payout: payoutOf(p), isNew: true };
        });
      } catch (e) {
        if (pgCode(e) === "23505") { // deux requêtes simultanées avec la même clé : on renvoie la première
          const dup = (await pool.query(`select * from payouts where idempotency_key = $1 and user_id = $2`, [input.idempotencyKey, userId])).rows[0];
          if (dup) return payoutOf(dup);
        }
        throw e;
      }
      if (!created.isNew) return created.payout;
      let providerRef: string;
      try {
        ({ providerRef } = await provider.initiatePayout({ payoutId: created.payout.id, amountMinor: amount, currency: input.currency, method: input.method, msisdn, idempotencyKey: input.idempotencyKey }));
      } catch (e) {
        // Le fournisseur n'a pas pris la demande : on recrédite immédiatement le membre.
        await withTx(pool, async (c) => {
          await c.query(`update payouts set status = 'failed', failure_code = 'PROVIDER_ERROR' where id = $1`, [created.payout.id]);
          await post(c, payoutFailedEntries(ctx("payout", created.payout.id, input.currency), { userId, amountMinor: amount, feeMinor: fee }));
        });
        console.error("[payout] fournisseur indisponible", (e as Error).message);
        throw new AppError("PSP_UNAVAILABLE", "Le retrait est indisponible pour le moment. Ton solde n'a pas été débité.", 502);
      }
      const u = (await pool.query(`update payouts set provider = $3, provider_ref = $2, status = 'processing' where id = $1 returning *`, [created.payout.id, providerRef, provider.name])).rows[0];
      if (provider instanceof FakeMobileMoneyProvider) {
        const ok = FakeMobileMoneyProvider.outcomeFor(msisdn) === "succeeded";
        schedule({ eventId: `evt_${randomUUID()}`, type: ok ? "payout.succeeded" : "payout.failed", providerRef, failureCode: ok ? undefined : "ACCOUNT_BLOCKED" });
      }
      return payoutOf(u);
    },

    // ---- agent C : notifications
    async listNotifications(userId, o) {
      if (!isUuid(userId)) return { items: [], unreadCount: 0 };
      const limit = Math.max(1, Math.min(o?.limit ?? NOTIFICATIONS_PAGE_LIMIT, NOTIFICATIONS_PAGE_LIMIT));
      const [rows, cnt] = await Promise.all([
        pool.query(`select id, kind, payload, read_at, created_at from notifications where user_id = $1 order by (read_at is not null), created_at desc, id limit $2`, [userId, limit]),
        pool.query(`select count(*)::int as n from notifications where user_id = $1 and read_at is null`, [userId]),
      ]);
      return {
        items: rows.rows.map((r): NotificationItem => ({ id: r.id, kind: r.kind, payload: r.payload ?? {}, read: r.read_at !== null, createdAt: r.created_at.getTime() })),
        unreadCount: cnt.rows[0].n,
      };
    },
    async countUnreadNotifications(userId) {
      if (!isUuid(userId)) return 0;
      return (await pool.query(`select count(*)::int as n from notifications where user_id = $1 and read_at is null`, [userId])).rows[0].n;
    },
    async markNotificationRead(userId, notificationId) {
      if (!isUuid(userId) || !isUuid(notificationId)) throw notFound("Notification");
      const r = await pool.query(`update notifications set read_at = coalesce(read_at, $3) where id = $1 and user_id = $2 returning id`, [notificationId, userId, ts(now())]);
      if (!r.rowCount) throw notFound("Notification");
    },
    async markAllNotificationsRead(userId) {
      if (!isUuid(userId)) return 0;
      return (await pool.query(`update notifications set read_at = $2 where user_id = $1 and read_at is null`, [userId, ts(now())])).rowCount ?? 0;
    },
    async getNotificationPreferences(userId) {
      if (!isUuid(userId) || !(await roleOf(pool, userId))) throw notFound("Compte");
      const r = (await pool.query(`select sms_orders, sms_disputes from notification_preferences where user_id = $1`, [userId])).rows[0];
      return r ? { orders: r.sms_orders, disputes: r.sms_disputes } : { ...DEFAULT_SMS_PREFERENCES };
    },
    async updateNotificationPreferences(userId, patch) {
      if (!isUuid(userId) || !(await roleOf(pool, userId))) throw notFound("Compte");
      const r = (await pool.query(
        `insert into notification_preferences (user_id, sms_orders, sms_disputes, updated_at)
         values ($1, coalesce($2::boolean, true), coalesce($3::boolean, true), $4)
         on conflict (user_id) do update set sms_orders = coalesce($2::boolean, notification_preferences.sms_orders),
           sms_disputes = coalesce($3::boolean, notification_preferences.sms_disputes), updated_at = $4
         returning sms_orders, sms_disputes`,
        [userId, patch.orders ?? null, patch.disputes ?? null, ts(now())])).rows[0];
      return { orders: r.sms_orders, disputes: r.sms_disputes } as SmsPreferences;
    },
    async purgeOldNotifications() {
      return (await pool.query(`delete from notifications where read_at is not null and read_at < $1`, [ts(now() - NOTIFICATIONS_RETENTION_DAYS * ONE_DAY)])).rowCount ?? 0;
    },
    // ---- fin agent C : notifications

    // ---- agent J : lots (panier d'un même vendeur)
    async getCart(userId) {
      if (!isUuid(userId)) throw notFound("Compte");
      return cartOf(pool, userId);
    },
    async addToCart(userId, itemId) {
      if (!isUuid(userId)) throw notFound("Compte");
      if (!isUuid(itemId)) throw notFound("Article");
      const fees = await getFees(); // avant la transaction : ne jamais demander une 2e connexion du pool en tenant la première
      return withTx(pool, async (c) => {
        // Verrou par membre : le plafond de 20 articles tient même si deux ajouts arrivent en même temps.
        await c.query(`select pg_advisory_xact_lock(hashtext($1))`, [`cart:${userId}`]);
        const me = (await c.query(`select 1 from profiles where id = $1 and deleted_at is null`, [userId])).rows[0];
        if (!me) throw notFound("Compte");
        const it = (await c.query(`select id, seller_id, status from items where id = $1`, [itemId])).rows[0];
        if (!it || it.status === "draft") throw notFound("Article");
        if (it.seller_id === userId) throw new AppError("SELF_PURCHASE", "Tu ne peux pas ajouter ton propre article au panier.", 409);
        const have = (await c.query(`select 1 from cart_items where user_id = $1 and item_id = $2`, [userId, itemId])).rowCount;
        if (have) throw new AppError("ALREADY_IN_CART", "Cet article est déjà dans ton panier.", 409);
        if (it.status !== "active") throw new AppError("ITEM_UNAVAILABLE", it.status === "sold" ? "Cet article est déjà vendu." : "Cet article n'est plus disponible.", 409);
        const n = (await c.query(`select count(*)::int as n from cart_items where user_id = $1`, [userId])).rows[0].n as number;
        if (n >= CART_MAX_ITEMS) throw new AppError("CART_FULL", `Ton panier est plein (${CART_MAX_ITEMS} articles au plus).`, 409);
        await c.query(`insert into cart_items (user_id, item_id, added_at) values ($1,$2,$3)`, [userId, itemId, ts(now())]);
        return cartOf(c, userId, fees);
      });
    },
    async removeFromCart(userId, itemId) {
      if (!isUuid(userId)) throw notFound("Compte");
      if (isUuid(itemId)) await pool.query(`delete from cart_items where user_id = $1 and item_id = $2`, [userId, itemId]);
      return cartOf(pool, userId);
    },
    // ---- fin agent J

    // ---- agent H : découverte
    async addFavourite(userId, itemId) {
      if (!isUuid(userId)) throw notFound("Compte");
      if (!isUuid(itemId)) throw notFound("Annonce");
      return withTx(pool, async (c) => {
        const me = (await c.query(`select 1 from profiles where id = $1 and deleted_at is null`, [userId])).rows[0];
        if (!me) throw notFound("Compte");
        const it = (await c.query(`select seller_id, status from items where id = $1`, [itemId])).rows[0];
        if (!it || !FAVOURABLE.includes(it.status)) throw notFound("Annonce");
        if (it.seller_id === userId) throw new AppError("CANNOT_FAVOURITE_OWN", "Tu ne peux pas mettre ta propre annonce en favori.", 409);
        await c.query(`insert into favourites (user_id, item_id, created_at) values ($1, $2, $3) on conflict do nothing`, [userId, itemId, ts(now())]);
        const n = (await c.query(`select count(*)::int as n from favourites where item_id = $1`, [itemId])).rows[0].n as number;
        return { favourited: true as const, favouriteCount: n };
      });
    },
    async removeFavourite(userId, itemId) {
      if (!isUuid(userId) || !isUuid(itemId)) return { favourited: false as const, favouriteCount: 0 };
      await pool.query(`delete from favourites where user_id = $1 and item_id = $2`, [userId, itemId]);
      const n = (await pool.query(`select count(*)::int as n from favourites where item_id = $1`, [itemId])).rows[0].n as number;
      return { favourited: false as const, favouriteCount: n };
    },
    async listFavourites(userId) {
      if (!isUuid(userId)) return [];
      const fees = await getFees();
      const r = await pool.query(
        `select ${CARD_COLS("$1")}
         from favourites fv join items i on i.id = fv.item_id left join areas a on a.id = i.area_id
         where fv.user_id = $1 and i.status = any($2::text[])
         order by fv.created_at desc, fv.item_id desc limit 200`,
        [userId, FAVOURABLE],
      );
      return r.rows.map((x) => cardOf(x, fees));
    },
    async getFollows(userId) {
      return followsOf(pool, userId);
    },
    async addFollow(userId, kind, value) {
      if (!isUuid(userId)) throw notFound("Compte");
      const label = cleanFollowValue(kind, value);
      const key = followKey(label);
      return withTx(pool, async (c) => {
        const me = (await c.query(`select 1 from profiles where id = $1 and deleted_at is null`, [userId])).rows[0];
        if (!me) throw notFound("Compte");
        await c.query(`select pg_advisory_xact_lock(hashtext($1))`, [`follow:${userId}`]); // le plafond tient même avec deux ajouts simultanés
        const exists = (await c.query(`select 1 from member_follows where user_id = $1 and kind = $2 and value_key = $3`, [userId, kind, key])).rowCount;
        if (!exists) {
          const n = (await c.query(`select count(*)::int as n from member_follows where user_id = $1 and kind = $2`, [userId, kind])).rows[0].n as number;
          if (n >= FOLLOW_MAX) throw followLimitError(kind);
          await c.query(`insert into member_follows (user_id, kind, value_key, label, created_at) values ($1,$2,$3,$4,$5)`, [userId, kind, key, label, ts(now())]);
        }
        return followsOf(c, userId);
      });
    },
    async removeFollow(userId, kind, value) {
      if (!isUuid(userId)) return { brands: [], sizes: [] };
      await pool.query(`delete from member_follows where user_id = $1 and kind = $2 and value_key = $3`, [userId, kind, followKey(cleanLine(String(value ?? "")))]);
      return followsOf(pool, userId);
    },
    async listForYou(userId, o) {
      if (!isUuid(userId)) return [];
      const f = await followsOf(pool, userId);
      if (!f.brands.length && !f.sizes.length) return [];
      const fees = await getFees();
      const limit = Math.min(Math.max(o?.limit ?? FOR_YOU_MAX, 1), FOR_YOU_MAX);
      const r = await pool.query(
        `select ${CARD_COLS("$1")}
         from items i left join areas a on a.id = i.area_id
         where i.status = 'active' and i.seller_id <> $1
           and (exists (select 1 from member_follows m where m.user_id = $1 and m.kind = 'brand' and m.value_key = regexp_replace(trim(unaccent(lower(coalesce(i.brand, '')))), '\\s+', ' ', 'g'))
             or exists (select 1 from member_follows m where m.user_id = $1 and m.kind = 'size' and m.value_key = regexp_replace(trim(unaccent(lower(coalesce(i.size_label, '')))), '\\s+', ' ', 'g')))
         order by ${RECENT_ORDER} limit ${limit}`,
        [userId],
      );
      return r.rows.map((x) => cardOf(x, fees));
    },
    // ---- fin agent H

    async listPayouts(userId) {
      const r = await pool.query(`select * from payouts where user_id = $1 order by requested_at desc limit 100`, [userId]);
      return r.rows.map(payoutOf);
    },

    // ---- agent E : articles interdits
    async listProhibitedRules() {
      return (await prohibited.list()).map(publicRule);
    },
    // ---- fin agent E
    // ---- agent D : livraison par coursier
    async quoteShipping(itemId, destAreaId): Promise<ShippingQuote> {
      if (!isUuid(itemId)) throw notFound("Annonce");
      const it = (await pool.query(
        `select i.currency, coalesce(i.area_id, p.area_id) as origin from items i join profiles p on p.id = i.seller_id where i.id = $1 and i.status in ('active','reserved')`, [itemId])).rows[0];
      if (!it) throw notFound("Annonce");
      const fees = await getFees();
      const zone = await zoneFor(pool, it.origin, destAreaId);
      return { shippingMinor: shippingFee(zone, it.currency, fees), currency: it.currency, zone };
    },

    async shipOrder(orderId, sellerId, input) {
      if (!isUuid(orderId)) throw notFound("Commande");
      const name = input.courierName.trim();
      const phone = normalizeDrcPhone(input.courierPhone);
      const jobs: SmsJob[] = [];
      await withTx(pool, async (c) => {
        const order = await loadOrder(c, orderId, true);
        if (order.sellerId !== sellerId) throw notFound("Commande");
        if (order.deliveryMethod !== "courier") throw new AppError("INVALID_STATE", "Cette commande est en remise en main propre.", 409);
        if (order.status !== "paid") throw new AppError("INVALID_STATE", "Tu pourras remettre le colis au coursier une fois la commande payée.", 409);
        if (name.length < 2 || name.length > 80) throw new AppError("VALIDATION", "Indique le nom du coursier.", 422, { courierName: "Indique le nom du coursier." });
        if (!phone) throw new AppError("VALIDATION", "Numéro du coursier invalide.", 422, { courierPhone: "Numéro du coursier invalide." });
        const ship = (await c.query(`select id from shipments where order_id = $1 for update`, [orderId])).rows[0];
        if (!ship) throw new AppError("INVALID_STATE", "Aucune expédition pour cette commande.", 409);
        await c.query(
          `update shipments set courier_name = $2, courier_phone = $3, tracking_ref = $4, status = 'handed_to_courier' where id = $1`,
          [ship.id, name, phone, input.trackingRef?.trim().slice(0, 60) || null]);
        await c.query(`update orders set status = 'in_delivery', in_delivery_at = $2 where id = $1`, [orderId, ts(now())]);
        await logShipment(c, ship.id, orderId, "handed_to_courier", sellerId);
        await notifyTx(c, { userId: order.buyerId, kind: "parcel_handed", payload: { orderId, itemTitle: await orderTitleOf(c, orderId), role: "buyer" }, eventKey: `parcel_handed:${orderId}` }, jobs); // agent F
      });
      fireSms(jobs);
      return buildView(pool, await loadOrder(pool, orderId), sellerId);
    },

    async markInTransit(orderId, sellerId) {
      if (!isUuid(orderId)) throw notFound("Commande");
      await withTx(pool, async (c) => {
        const order = await loadOrder(c, orderId, true);
        if (order.sellerId !== sellerId) throw notFound("Commande");
        const ship = (await c.query(`select id, status from shipments where order_id = $1 for update`, [orderId])).rows[0];
        if (order.deliveryMethod !== "courier" || !ship || order.status !== "in_delivery" || ship.status !== "handed_to_courier")
          throw new AppError("INVALID_STATE", "Le colis doit d'abord être remis au coursier.", 409);
        await c.query(`update shipments set status = 'in_transit' where id = $1`, [ship.id]);
        await logShipment(c, ship.id, orderId, "in_transit", sellerId);
        await notifyTx(c, { userId: order.buyerId, kind: "parcel_in_transit", payload: { orderId, itemTitle: await orderTitleOf(c, orderId), role: "buyer" }, eventKey: `parcel_in_transit:${orderId}` }); // agent F
      });
      return buildView(pool, await loadOrder(pool, orderId), sellerId);
    },

    async confirmReceived(orderId, buyerId) {
      if (!isUuid(orderId)) throw notFound("Commande");
      const fees = await getFees();
      await withTx(pool, async (c) => {
        const order = await loadOrder(c, orderId, true);
        if (order.buyerId !== buyerId) throw notFound("Commande");
        const ship = (await c.query(`select id from shipments where order_id = $1 for update`, [orderId])).rows[0];
        if (order.deliveryMethod !== "courier" || !ship) throw new AppError("INVALID_STATE", "Cette commande n'est pas livrée par coursier.", 409);
        if (order.status !== "in_delivery") throw new AppError("INVALID_STATE", "Le colis n'est pas encore parti : tu pourras confirmer la réception ensuite.", 409);
        await c.query(`update shipments set status = 'delivered', delivered_confirmed_by = 'buyer' where id = $1`, [ship.id]);
        await c.query(`update orders set status = 'delivered', delivered_at = $2, auto_release_at = $3 where id = $1`, [orderId, ts(now()), ts(now() + fees.claimWindowMs)]);
        await logShipment(c, ship.id, orderId, "received", buyerId);
        await notifyTx(c, { userId: order.sellerId, kind: "parcel_received", payload: { orderId, itemTitle: await orderTitleOf(c, orderId), role: "seller" }, eventKey: `parcel_received:${orderId}` }); // agent F
      });
      return buildView(pool, await loadOrder(pool, orderId), buyerId);
    },

    async reportParcelLost(orderId, userId, input) {
      if (!isUuid(orderId) || !isUuid(userId)) throw notFound("Commande");
      const text = (input?.description ?? "").trim() || LOST_DEFAULT_TEXT;
      const id = await withTx(pool, async (c) => {
        const order = await loadOrder(c, orderId, true);
        if (order.buyerId !== userId && order.sellerId !== userId) throw notFound("Commande");
        const ship = (await c.query(`select id from shipments where order_id = $1 for update`, [orderId])).rows[0];
        if (order.deliveryMethod !== "courier" || !ship) throw new AppError("INVALID_STATE", "Cette commande n'est pas livrée par coursier.", 409);
        if (order.status !== "in_delivery") throw new AppError("INVALID_STATE", "Le colis ne peut être signalé perdu qu'une fois remis au coursier et tant qu'il n'est pas reçu.", 409);
        if (text.length < 10) throw new AppError("VALIDATION", "Décris le problème en quelques mots (10 caractères au moins).", 422, { description: "Décris le problème en quelques mots (10 caractères au moins)." });
        if (text.length > 2000) throw new AppError("VALIDATION", "La description est limitée à 2 000 caractères.", 422, { description: "La description est limitée à 2 000 caractères." });
        await c.query(`update orders set status = 'disputed' where id = $1`, [orderId]);
        const d = (await c.query(
          `insert into disputes (order_id, opened_by, reason, description, status, opened_at, updated_at) values ($1,$2,'not_received',$3,'open',$4,$4) returning id`,
          [orderId, userId, text, ts(now())])).rows[0];
        await c.query(`update shipments set status = 'lost_suspected' where id = $1`, [ship.id]);
        await logShipment(c, ship.id, orderId, "lost_reported", userId);
        const other = userId === order.buyerId ? order.sellerId : order.buyerId;
        await notifyTx(c, { userId: other, kind: "parcel_lost", payload: { orderId, disputeId: d.id, itemTitle: await orderTitleOf(c, orderId) }, eventKey: `parcel_lost:${d.id}` }); // agent F
        return d.id as string;
      });
      return disputeViewOf(pool, id, userId);
    },

    // ---- agent F : rappels et expirations notifiés
    async notifyExpiredCancelRequests(o) {
      const fees = await getFees();
      const at = o?.at ?? now();
      const rows = (await pool.query(
        `select r.id, r.order_id from order_cancel_requests r join orders o on o.id = r.order_id
         where r.status = 'pending' and r.requested_at <= $1 and o.status in ('paid','in_delivery') order by r.requested_at limit 200`, [ts(at - fees.cancelRequestTtlMs)])).rows;
      let n = 0;
      for (const r of rows) {
        const fresh = await withTx(pool, async (c) => {
          const order = await loadOrder(c, r.order_id as string, true);
          if (order.status !== "paid" && order.status !== "in_delivery") return false; // acceptée, retirée ou commande close entre-temps
          const still = (await c.query(`select 1 from order_cancel_requests where id = $1 and status = 'pending'`, [r.id])).rowCount;
          if (!still) return false;
          const title = await orderTitleOf(c, order.id);
          const key = `cancel_expired:${r.id}`;
          const before = (await c.query(`select count(*)::int as n from notifications where event_key = $1`, [key])).rows[0].n as number;
          await notifyParties(c, order, (role) => ({ kind: "cancel_expired", payload: { orderId: order.id, itemTitle: title, role }, eventKey: key }));
          const after = (await c.query(`select count(*)::int as n from notifications where event_key = $1`, [key])).rows[0].n as number;
          return after > before; // rejouée : rien de nouveau
        });
        if (fresh) n++;
      }
      return n;
    },

    async remindClaimWindows(o) {
      const fees = await getFees();
      const at = o?.at ?? now();
      const rows = (await pool.query(
        `select id from orders where status = 'delivered' and delivery_method = 'courier' and auto_release_at > $1 and auto_release_at <= $2 order by auto_release_at limit 200`,
        [ts(at), ts(at + fees.claimWindowMs / 2)])).rows;
      let n = 0;
      for (const r of rows) {
        const fresh = await withTx(pool, async (c) => {
          const order = await loadOrder(c, r.id as string, true);
          if (order.status !== "delivered") return false;
          const key = `claim_reminder:${order.id}`;
          const before = (await c.query(`select count(*)::int as n from notifications where event_key = $1`, [key])).rows[0].n as number;
          await notifyTx(c, { userId: order.buyerId, kind: "claim_reminder", payload: { orderId: order.id, itemTitle: await orderTitleOf(c, order.id), role: "buyer" }, eventKey: key });
          const after = (await c.query(`select count(*)::int as n from notifications where event_key = $1`, [key])).rows[0].n as number;
          return after > before;
        });
        if (fresh) n++;
      }
      return n;
    },
    // ---- fin agent F

    async releaseDeliveredOrders(o) {
      const at = o?.at ?? now();
      const ids = (await pool.query(
        `select id from orders where status = 'delivered' and delivery_method = 'courier' and auto_release_at <= $1 order by auto_release_at limit 200`, [ts(at)])).rows.map((r) => r.id as string);
      let n = 0;
      for (const id of ids) {
        const done = await withTx(pool, async (c) => {
          // Verrou de ligne puis revérification : deux exécutions simultanées, un litige ou une acceptation entre-temps ne libèrent jamais deux fois.
          const order = await loadOrder(c, id, true);
          if (order.status !== "delivered" || order.autoReleaseAt == null || order.autoReleaseAt > at) return false;
          await c.query(`update orders set status = 'completed', completed_at = $2 where id = $1`, [id, ts(now())]);
          await post(c, releaseEntries(ctx("order", id, order.currency), { sellerId: order.sellerId, itemsMinor: order.itemsMinor, shippingMinor: order.shippingMinor, feeMinor: order.protectionFeeMinor, courierFeeMode: (await getFees()).courierFeeMode }));
          const ship = (await c.query(`select id from shipments where order_id = $1`, [id])).rows[0];
          if (ship) await logShipment(c, ship.id, id, "auto_released", null);
          const title = await orderTitleOf(c, id);
          await notifyParties(c, order, (role) => ({ kind: "order_auto_released", payload: { orderId: id, itemTitle: title, role }, eventKey: `order_auto_released:${id}` })); // agent F
          return true;
        });
        if (done) n++;
      }
      return n;
    },

    async refundStaleCourierOrders(o) {
      const fees = await getFees();
      const at = o?.at ?? now();
      const ids = (await pool.query(
        `select id from orders where status = 'in_delivery' and delivery_method = 'courier' and in_delivery_at <= $1 order by in_delivery_at limit 200`, [ts(at - fees.courierStaleMs)])).rows.map((r) => r.id as string);
      let n = 0;
      for (const id of ids) {
        let refund: { providerRef: string; amountMinor: number } | null = null;
        const done = await withTx(pool, async (c) => {
          const order = await loadOrder(c, id, true);
          if (order.status !== "in_delivery") return false; // reçu, signalé perdu ou annulé entre-temps
          refund = await refundEscrowTx(c, order);
          await c.query(`update orders set status = 'cancelled', cancelled_at = $2 where id = $1`, [id, ts(now())]);
          const ship = (await c.query(`update shipments set status = 'lost_suspected' where order_id = $1 returning id`, [id])).rows[0];
          if (ship) await logShipment(c, ship.id, id, "auto_refunded", null);
          const title = await orderTitleOf(c, id);
          await notifyParties(c, order, (role) => ({ kind: "parcel_auto_refunded", payload: { orderId: id, itemTitle: title, role }, eventKey: `parcel_auto_refunded:${id}` })); // agent F
          return true;
        });
        if (done) { n++; if (refund) await refundAtProvider(refund); }
      }
      return n;
    },
  };

  async function refundAtProvider(r: { providerRef: string; amountMinor: number }) {
    try {
      await provider.refund(r);
    } catch (e) {
      // L'écriture comptable est déjà faite : on garde une trace pour que l'exploitation relance le remboursement chez le PSP.
      console.error("[refund] échec chez le fournisseur", (e as Error).message);
      await pool.query(`insert into audit_log (action, target_type, meta) values ('refund_failed', 'payment', $1)`, [JSON.stringify(r)]).catch(() => undefined);
    }
  }

  return api;
}

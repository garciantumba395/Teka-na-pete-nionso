import { FEES } from "../../fees";
import { seedAreas, seedCategories, seedItems, seedUsers } from "../seed";
import { seedProhibitedRules } from "./prohibited";
import type { Pool } from "./pool";

// Fuseaux : ouest de la RDC (dont Kinshasa) UTC+1, est UTC+2, pas d'heure d'été. À VÉRIFIER (zones IANA).
const WEST = new Set(["Kinshasa", "Kongo Central", "Kwango", "Kwilu", "Mai-Ndombe", "Équateur", "Mongala", "Nord-Ubangi", "Sud-Ubangi", "Tshuapa"]);

/**
 * Données de référence (zones, catégories, paramètres). Idempotent : peut être rejoué à chaque déploiement.
 * Les identifiants sont déterministes (seedId) : les mêmes en développement, en test et en production.
 */
export async function seedReference(pool: Pool): Promise<void> {
  const areas = seedAreas();
  for (const a of areas) {
    const tz = a.kind === "province" && !WEST.has(a.name) ? "Africa/Lubumbashi" : "Africa/Kinshasa";
    await pool.query(
      `insert into areas (id, parent_id, kind, name, tz, lat, lng) values ($1,$2,$3,$4,$5,$6,$7) on conflict (id) do nothing`,
      [a.id, a.parentId, a.kind, a.name, tz, a.lat, a.lng],
    );
  }
  let order = 0;
  for (const c of seedCategories()) {
    await pool.query(
      `insert into categories (id, parent_id, slug, name, is_sellable, sort_order) values ($1,$2,$3,$4,$5,$6) on conflict (id) do nothing`,
      [c.id, c.parentId, c.slug, JSON.stringify({ fr: c.name }), c.isSellable, order++],
    );
  }
  const settings: Record<string, unknown> = {
    buyer_protection: { pct_bps: FEES.buyerProtection.pctBps, fixed_minor: FEES.buyerProtection.fixedMinor, _placeholder: true },
    payout_fee: { pct_bps: FEES.payout.pctBps, min_minor: FEES.payout.minMinor, _placeholder: true },
    max_item_value_usd_minor: FEES.maxItemValueUsdMinor,
    order_payment_ttl_minutes: FEES.orderPaymentTtlMs / 60_000,
    handover_max_attempts: FEES.handoverMaxAttempts,
    handover_lock_minutes: FEES.handoverLockMs / 60_000,
    max_photos: FEES.maxPhotos,
    claim_window_hours: FEES.claimWindowMs / 3_600_000,
    courier_stale_days: FEES.courierStaleMs / 86_400_000,
    courier_fee_mode: FEES.courierFeeMode,
    shipping_grid: { ...FEES.shippingGrid, _placeholder: true },
  };
  for (const [key, value] of Object.entries(settings)) {
    await pool.query(`insert into settings (key, value) values ($1, $2) on conflict (key) do nothing`, [key, JSON.stringify(value)]);
  }
  await seedProhibitedRules(pool); // agent E : articles interdits
}

/** Données de DÉMONSTRATION (faux membres, fausses annonces). Jamais en production. */
export async function seedDemo(pool: Pool, now: number = Date.now()): Promise<void> {
  if (process.env.NODE_ENV === "production") throw new Error("Les données de démonstration sont interdites en production.");
  const users = seedUsers(now);
  for (const u of users) {
    await pool.query(
      `insert into profiles (id, phone, phone_verified_at, display_name, bio, area_id, verification_level, rating_avg, rating_count, created_at, role)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) on conflict (id) do nothing`,
      [u.id, u.phone, new Date(u.createdAt), u.displayName, u.bio, u.areaId, u.verificationLevel, u.ratingAvg, u.ratingCount, new Date(u.createdAt), u.role ?? "member"],
    );
  }
  for (const it of seedItems(now, seedAreas())) {
    const r = await pool.query(
      `insert into items (id, seller_id, category_id, title, description, condition, size_label, brand, price_minor, currency, status, area_id, lat, lng, published_at, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'active',$11,$12,$13,$14,$15) on conflict (id) do nothing returning id`,
      [it.id, it.sellerId, it.categoryId, it.title, it.description, it.condition, it.sizeLabel, it.brand, it.priceMinor, it.currency, it.areaId, it.lat, it.lng,
        it.publishedAt ? new Date(it.publishedAt) : null, new Date(it.createdAt)],
    );
    if (r.rowCount === 0) continue;
    let pos = 0;
    for (const url of it.photos) {
      // Photos de démonstration : illustrations SVG générées dans le code (aucune image d'un tiers).
      const svg = Buffer.from(decodeURIComponent(url.slice(url.indexOf(",") + 1)), "utf8");
      const b = await pool.query(`insert into photo_blobs (owner_id, mime, size, content) values ($1,'image/svg+xml',$2,$3) returning id`, [it.sellerId, svg.length, svg]);
      await pool.query(`insert into item_photos (item_id, storage_path, position, bytes) values ($1,$2,$3,$4)`, [it.id, `db:${b.rows[0].id}`, pos++, svg.length]);
    }
  }
}

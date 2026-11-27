-- 0001_core : schéma du domaine (tables, contraintes, triggers, index, fonctions).
-- Dérivé de replica/schema.sql (testé : replica/db/). Cette migration est la référence de déploiement.
-- Différences avec schema.sql : profiles.id n'est plus lié à auth.users ; profiles.phone est nullable ; profiles.deleted_at.
-- Les politiques RLS « Supabase » de schema.sql ne sont PAS reprises : l'application accède à la base par le serveur
-- (rôle propriétaire) et les autorisations sont appliquées dans la couche de données. Voir 0003 (refus par défaut).

-- replica/schema.sql
-- Marketplace de seconde main, pilote RDC. PostgreSQL 15+ (cible : Supabase).
-- Règles : temps en timestamptz (UTC), argent en entiers (unités mineures ISO 4217)
-- + devise, statuts en text + check, FK avec règle on delete explicite.
-- Autorisation : RLS pour les lectures et les écritures "propriétaire".
-- Tout ce qui touche à l'argent, aux statuts de commande et à la modération
-- s'écrit UNIQUEMENT côté serveur (rôle service), jamais depuis le client.
-- Valeurs marquées PLACEHOLDER : à décider, ne viennent pas de Vinted.

create extension if not exists pg_trgm;
create extension if not exists unaccent;

create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

-- ---------------------------------------------------------------- géographie
create table areas (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references areas(id) on delete restrict,
  kind text not null check (kind in ('country','province','city','commune','quartier')),
  name text not null,
  tz text not null default 'Africa/Kinshasa',       -- RDC : ouest UTC+1, est UTC+2, pas d'heure d'été
  lat numeric(9,6),
  lng numeric(9,6),
  created_at timestamptz not null default now(),
  unique nulls not distinct (parent_id, kind, name)
);
create index on areas (parent_id);

-- ------------------------------------------------------------------- membres
create table profiles (
  id uuid primary key default gen_random_uuid(),  -- identité propre à l'application (pas de dépendance à Supabase Auth)
  phone text unique check (phone ~ '^\+[1-9][0-9]{7,14}$'),  -- nul après suppression du compte
  phone_verified_at timestamptz,
  display_name text not null check (char_length(display_name) between 2 and 40),
  avatar_path text,
  bio text check (char_length(bio) <= 500),
  preferred_lang text not null default 'fr' check (preferred_lang in ('fr','en','sw','ln','kg','lua')),
  country_code char(2) not null default 'CD',
  area_id uuid references areas(id) on delete set null,
  role text not null default 'member' check (role in ('member','moderator','support','admin')),
  status text not null default 'active' check (status in ('active','suspended','banned')),
  verification_level text not null default 'none' check (verification_level in ('none','phone','id')),
  is_pro boolean not null default false,
  holiday_mode boolean not null default false,
  rating_avg numeric(3,2) check (rating_avg between 1 and 5),
  rating_count integer not null default 0 check (rating_count >= 0),
  deleted_at timestamptz,                  -- compte supprimé : profil anonymisé, commandes conservées
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on profiles (area_id);

create table pro_profiles (
  user_id uuid primary key references profiles(id) on delete cascade,
  business_name text not null,
  registration_number text not null,     -- RCCM / Id. Nat. / NIF : formats à confirmer avec un juriste local
  tax_id text,
  address text not null,
  return_policy text,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table identity_verifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  doc_type text not null check (doc_type in ('voter_card','passport','driver_license','national_id')),
  doc_path text not null,                 -- bucket PRIVÉ, URLs signées courtes, purge après revue
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewed_by uuid references profiles(id) on delete set null,
  reviewed_at timestamptz,
  purge_after timestamptz,
  created_at timestamptz not null default now()
);
create index on identity_verifications (user_id);
create index on identity_verifications (status) where status = 'pending';

-- ------------------------------------------------------------------ catalogue
create table categories (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references categories(id) on delete restrict,
  slug text not null unique,
  name jsonb not null,                    -- {"fr": "...", "en": "..."}
  size_scheme text,                       -- ex. clothing, shoes, kids, none
  is_sellable boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index on categories (parent_id);

create table items (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references profiles(id) on delete restrict,
  category_id uuid not null references categories(id) on delete restrict,
  title text not null check (char_length(title) between 3 and 80),
  description text not null default '' check (char_length(description) <= 2000),
  condition text not null check (condition in ('new_with_tags','new','very_good','good','satisfactory')),
  size_label text,
  brand text,
  materials text[] not null default '{}' check (cardinality(materials) <= 3),
  price_minor bigint not null check (price_minor > 0),   -- plafond : table settings, vérifié côté serveur
  currency char(3) not null check (currency in ('CDF','USD')),
  status text not null default 'draft'
    check (status in ('draft','active','reserved','sold','hidden','removed')),
  hidden_reason text,
  fix_deadline timestamptz,               -- annonce masquée : délai pour corriger
  area_id uuid references areas(id) on delete set null,
  -- Position APPROXIMATIVE pour la recherche par rayon. Arrondie côté serveur à 0,01° (≈ 1 km) :
  -- on ne stocke jamais l'emplacement exact du vendeur.
  lat numeric(8,5) check (lat between -90 and 90),
  lng numeric(8,5) check (lng between -180 and 180),
  search tsvector,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on items (seller_id, status);
create index on items (category_id, status, published_at desc);
create index on items (area_id, status, published_at desc);
create index on items (status, published_at desc);
create index items_search_idx on items using gin (search);
create index items_title_trgm_idx on items using gin (title gin_trgm_ops);
create index on items (fix_deadline) where status = 'hidden';
create index items_geo_idx on items (lat, lng) where status = 'active' and lat is not null;

-- Distance en km (haversine), sans PostGIS. Utiliser une boîte englobante sur (lat, lng) pour
-- préfiltrer via l'index, puis distance_km() pour trancher.
create or replace function distance_km(lat1 double precision, lng1 double precision,
                                       lat2 double precision, lng2 double precision)
returns double precision language sql immutable parallel safe as $$
  select 2 * 6371.0088 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)))
$$;

create or replace function items_search_update() returns trigger
language plpgsql as $$
begin
  new.search :=
    setweight(to_tsvector('simple', unaccent(coalesce(new.title, ''))), 'A') ||
    setweight(to_tsvector('simple', unaccent(coalesce(new.brand, ''))), 'B') ||
    setweight(to_tsvector('simple', unaccent(coalesce(new.description, ''))), 'C');
  return new;
end $$;
create trigger items_search_trg before insert or update of title, brand, description
  on items for each row execute function items_search_update();

create table item_photos (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references items(id) on delete cascade,
  storage_path text not null,
  position smallint not null check (position between 0 and 19),   -- 20 photos max
  width integer,
  height integer,
  bytes integer check (bytes > 0),
  created_at timestamptz not null default now(),
  unique (item_id, position)
);

create table favourites (
  user_id uuid not null references profiles(id) on delete cascade,
  item_id uuid not null references items(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, item_id)
);
create index on favourites (item_id);

-- ----------------------------------------------------------------- messagerie
create table conversations (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references items(id) on delete cascade,
  buyer_id uuid not null references profiles(id) on delete cascade,
  seller_id uuid not null references profiles(id) on delete cascade,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  unique (item_id, buyer_id),
  constraint conv_parties_differ check (buyer_id <> seller_id)
);
create index on conversations (buyer_id, last_message_at desc);
create index on conversations (seller_id, last_message_at desc);

create table offers (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  item_id uuid not null references items(id) on delete cascade,
  buyer_id uuid not null references profiles(id) on delete cascade,
  amount_minor bigint not null check (amount_minor > 0),
  currency char(3) not null check (currency in ('CDF','USD')),
  status text not null default 'pending'
    check (status in ('pending','accepted','declined','expired','withdrawn')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index on offers (conversation_id, created_at desc);
create index on offers (expires_at) where status = 'pending';

create table messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  sender_id uuid references profiles(id) on delete set null,   -- null = message système
  kind text not null default 'text' check (kind in ('text','offer','system','image')),
  body text not null check (char_length(body) <= 2000),
  offer_id uuid references offers(id) on delete set null,
  flagged boolean not null default false,       -- hors-plateforme : numéro, lien de paiement, etc.
  flag_reason text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index on messages (conversation_id, created_at);
create index on messages (flagged) where flagged;

-- --------------------------------------------------------- paramètres et taux
create table settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create table exchange_rates (
  id uuid primary key default gen_random_uuid(),
  base char(3) not null,
  quote char(3) not null,
  rate numeric(18,6) not null check (rate > 0),
  source text not null,
  fetched_at timestamptz not null default now()
);
create index on exchange_rates (base, quote, fetched_at desc);

-- ------------------------------------------------------------------ commandes
create table orders (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references profiles(id) on delete restrict,
  seller_id uuid not null references profiles(id) on delete restrict,
  status text not null default 'pending_payment'
    check (status in ('pending_payment','paid','in_delivery','delivered','completed',
                      'disputed','refunded','cancelled','expired')),
  currency char(3) not null check (currency in ('CDF','USD')),   -- une devise par commande
  items_minor bigint not null check (items_minor > 0),
  shipping_minor bigint not null default 0 check (shipping_minor >= 0),
  protection_fee_minor bigint not null default 0 check (protection_fee_minor >= 0),
  total_minor bigint not null,
  fx_rate_id uuid references exchange_rates(id) on delete restrict,  -- taux figé si conversion
  delivery_method text not null check (delivery_method in ('hand_delivery','courier','relay_point')),
  delivery_area_id uuid references areas(id) on delete set null,
  delivery_landmark text,                  -- adressage informel : repère décrit par l'acheteur
  delivery_lat numeric(9,6),
  delivery_lng numeric(9,6),
  payment_expires_at timestamptz,
  paid_at timestamptz,
  in_delivery_at timestamptz,
  delivered_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  auto_release_at timestamptz,             -- delivered_at + fenêtre de réclamation (settings)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orders_total_matches check (total_minor = items_minor + shipping_minor + protection_fee_minor),
  constraint orders_parties_differ check (buyer_id <> seller_id)
);
create index on orders (buyer_id, created_at desc);
create index on orders (seller_id, created_at desc);
create index on orders (status, payment_expires_at) where status = 'pending_payment';
create index on orders (auto_release_at) where status = 'delivered';

create or replace function orders_guard_transition() returns trigger
language plpgsql as $$
begin
  if new.status = old.status then return new; end if;
  if not (
    (old.status = 'pending_payment' and new.status in ('paid','cancelled','expired')) or
    (old.status = 'paid'            and new.status in ('in_delivery','delivered','cancelled','disputed')) or
    (old.status = 'in_delivery'     and new.status in ('delivered','disputed','cancelled')) or
    (old.status = 'delivered'       and new.status in ('completed','disputed')) or
    (old.status = 'disputed'        and new.status in ('completed','refunded'))
  ) then
    raise exception 'invalid order transition % -> %', old.status, new.status
      using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger orders_transition_trg before update of status on orders
  for each row execute function orders_guard_transition();

create table order_items (
  order_id uuid not null references orders(id) on delete cascade,
  item_id uuid not null references items(id) on delete restrict,
  price_minor bigint not null check (price_minor > 0),
  currency char(3) not null check (currency in ('CDF','USD')),
  is_open boolean not null default true,    -- false quand la commande est annulée, expirée ou remboursée
  primary key (order_id, item_id)
);
-- Un article ne peut être que dans UNE commande ouverte : c'est la base qui tranche la course.
create unique index order_items_one_open_per_item on order_items (item_id) where is_open;

create or replace function orders_close_items() returns trigger
language plpgsql as $$
begin
  if new.status in ('cancelled','expired','refunded') and old.status <> new.status then
    update order_items set is_open = false where order_id = new.id;
    update items set status = 'active', updated_at = now()
      where id in (select item_id from order_items where order_id = new.id) and status = 'reserved';
  elsif new.status = 'completed' and old.status <> 'completed' then
    update items set status = 'sold', updated_at = now()
      where id in (select item_id from order_items where order_id = new.id);
  end if;
  return null;
end $$;
create trigger orders_close_items_trg after update of status on orders
  for each row execute function orders_close_items();

create table shipments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references orders(id) on delete cascade,
  method text not null check (method in ('hand_delivery','courier','relay_point')),
  status text not null default 'pending'
    check (status in ('pending','ready','handed_to_courier','in_transit','delivered','lost_suspected','returned')),
  courier_name text,
  courier_phone text,
  tracking_ref text,
  pickup_area_id uuid references areas(id) on delete set null,
  pickup_landmark text,
  handover_code_hash text,                 -- code à 6 chiffres haché, jamais stocké en clair
  handover_attempts smallint not null default 0 check (handover_attempts >= 0),
  handover_locked_until timestamptz,
  delivered_confirmed_by text check (delivered_confirmed_by in ('buyer_code','courier','auto')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------------ promotion
create table bumps (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references items(id) on delete cascade,
  seller_id uuid not null references profiles(id) on delete cascade,
  tier text not null,
  price_minor bigint not null check (price_minor > 0),
  currency char(3) not null check (currency in ('CDF','USD')),
  status text not null default 'pending_payment' check (status in ('pending_payment','active','expired','cancelled')),
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now()
);
create index on bumps (item_id);
create index on bumps (ends_at) where status = 'active';

-- ------------------------------------------------------------------- paiements
create table payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id) on delete restrict,
  bump_id uuid references bumps(id) on delete restrict,
  provider text not null,                  -- agrégateur de paiement (interface PaymentProvider)
  method text not null check (method in ('mpesa','orange_money','airtel_money','africell_money','card','cash_on_delivery')),
  msisdn text,
  amount_minor bigint not null check (amount_minor > 0),
  currency char(3) not null check (currency in ('CDF','USD')),
  status text not null default 'initiated'
    check (status in ('initiated','pending_user','succeeded','failed','expired','refunded','partially_refunded')),
  provider_ref text,
  idempotency_key text not null unique,
  failure_code text,
  refunded_minor bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payments_one_target check (num_nonnulls(order_id, bump_id) = 1),
  constraint payments_refund_cap check (refunded_minor between 0 and amount_minor),
  unique (provider, provider_ref)
);
create index on payments (order_id);
create index on payments (bump_id);
create index on payments (status, created_at) where status in ('initiated','pending_user');

-- Grand livre en partie double, append-only. Convention : débit positif, crédit négatif.
create table ledger_entries (
  id uuid primary key default gen_random_uuid(),
  txn_id uuid not null,
  account text not null check (account in
    ('psp_clearing','order_escrow','seller_available','payout_pending',
     'shipping_payable','platform_revenue','psp_fees')),
  user_id uuid references profiles(id) on delete restrict,   -- null pour les comptes plateforme
  currency char(3) not null check (currency in ('CDF','USD')),
  amount_minor bigint not null check (amount_minor <> 0),
  ref_type text not null check (ref_type in ('order','payment','payout','dispute','bump','adjustment')),
  ref_id uuid not null,
  created_at timestamptz not null default now()
);
create index on ledger_entries (txn_id);
create index on ledger_entries (user_id, account, currency);
create index on ledger_entries (ref_type, ref_id);

create or replace function ledger_check_balanced() returns trigger
language plpgsql as $$
declare s bigint;
begin
  select coalesce(sum(amount_minor), 0) into s
    from ledger_entries where txn_id = new.txn_id and currency = new.currency;
  if s <> 0 then
    raise exception 'ledger txn % (%) unbalanced by %', new.txn_id, new.currency, s;
  end if;
  return null;
end $$;
create constraint trigger ledger_balanced after insert on ledger_entries
  deferrable initially deferred for each row execute function ledger_check_balanced();

create or replace function ledger_append_only() returns trigger
language plpgsql as $$
begin raise exception 'ledger_entries is append-only'; end $$;
create trigger ledger_no_update before update or delete on ledger_entries
  for each row execute function ledger_append_only();

create table payouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete restrict,
  amount_minor bigint not null check (amount_minor > 0),
  fee_minor bigint not null default 0 check (fee_minor >= 0),
  currency char(3) not null check (currency in ('CDF','USD')),
  method text not null check (method in ('mpesa','orange_money','airtel_money','africell_money')),
  msisdn text not null,
  status text not null default 'requested'
    check (status in ('requested','processing','paid','failed','cancelled')),
  provider text,
  provider_ref text,
  idempotency_key text not null unique,
  failure_code text,
  requested_at timestamptz not null default now(),
  paid_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (provider, provider_ref)
);
create index on payouts (user_id, requested_at desc);
create index on payouts (status) where status in ('requested','processing');

-- ------------------------------------------------------------ litiges et avis
create table disputes (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete restrict,
  opened_by uuid not null references profiles(id) on delete restrict,
  reason text not null check (reason in ('not_received','damaged','not_as_described','other')),
  description text not null check (char_length(description) <= 2000),
  status text not null default 'open'
    check (status in ('open','awaiting_seller','awaiting_return','return_in_transit',
                      'resolved_refund','resolved_release','resolved_partial','closed')),
  return_required boolean not null default false,
  return_deadline timestamptz,
  response_deadline timestamptz,
  resolution_amount_minor bigint check (resolution_amount_minor >= 0),
  resolved_by uuid references profiles(id) on delete set null,
  resolved_at timestamptz,
  opened_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index disputes_one_open_per_order on disputes (order_id)
  where status in ('open','awaiting_seller','awaiting_return','return_in_transit');
create index on disputes (status, opened_at);

create table dispute_evidence (
  id uuid primary key default gen_random_uuid(),
  dispute_id uuid not null references disputes(id) on delete cascade,
  author_id uuid not null references profiles(id) on delete restrict,
  storage_path text,
  note text check (char_length(note) <= 1000),
  created_at timestamptz not null default now(),
  constraint evidence_not_empty check (storage_path is not null or note is not null)
);
create index on dispute_evidence (dispute_id);

create table reviews (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete restrict,
  author_id uuid not null references profiles(id) on delete restrict,
  target_id uuid not null references profiles(id) on delete restrict,
  rating smallint not null check (rating between 1 and 5),
  comment text check (char_length(comment) <= 500),
  created_at timestamptz not null default now(),
  unique (order_id, author_id),
  constraint review_not_self check (author_id <> target_id)
);
create index on reviews (target_id, created_at desc);

-- ------------------------------------------------------ modération et système
create table reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references profiles(id) on delete cascade,
  target_type text not null check (target_type in ('item','user','message','order')),
  target_id uuid not null,
  reason text not null,
  details text check (char_length(details) <= 1000),
  status text not null default 'open' check (status in ('open','actioned','dismissed')),
  handled_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on reports (status, created_at);
create index on reports (target_type, target_id);

create table sanctions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  kind text not null check (kind in ('item_hidden','suspension','ban')),
  reason text not null,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on sanctions (user_id, starts_at desc);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  kind text not null,
  payload jsonb not null default '{}',
  channels_sent text[] not null default '{}',     -- push, sms, whatsapp
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index on notifications (user_id, created_at desc);

create table devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  token text not null unique,
  platform text not null check (platform in ('android','ios','web')),
  created_at timestamptz not null default now()
);
create index on devices (user_id);

create table webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_id text not null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (provider, event_id)               -- idempotence : un webhook arrive souvent deux fois
);

create table audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references profiles(id) on delete set null,
  action text not null,
  target_type text,
  target_id uuid,
  meta jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index on audit_log (target_type, target_id);
create index on audit_log (actor_id, created_at desc);

-- updated_at automatique
create trigger profiles_updated  before update on profiles      for each row execute function set_updated_at();
create trigger pro_updated       before update on pro_profiles  for each row execute function set_updated_at();
create trigger items_updated     before update on items         for each row execute function set_updated_at();
create trigger orders_updated    before update on orders        for each row execute function set_updated_at();
create trigger shipments_updated before update on shipments     for each row execute function set_updated_at();
create trigger payments_updated  before update on payments      for each row execute function set_updated_at();
create trigger payouts_updated   before update on payouts       for each row execute function set_updated_at();
create trigger disputes_updated  before update on disputes      for each row execute function set_updated_at();


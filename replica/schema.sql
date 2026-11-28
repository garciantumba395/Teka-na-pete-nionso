-- replica/schema.sql : SOURCE DE CONCEPTION (testée dans replica/db/).
-- Le schéma DÉPLOYÉ est dans db/migrations/ (0001_core dérive de ce fichier ; sans dépendance à Supabase Auth).
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
  id uuid primary key references auth.users(id) on delete restrict,  -- anonymiser, ne pas supprimer
  phone text not null unique check (phone ~ '^\+[1-9][0-9]{7,14}$'),
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

-- ============================================================ ACCÈS (RLS)
create or replace function is_order_party(p_order uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from orders o
                 where o.id = p_order and auth.uid() in (o.buyer_id, o.seller_id));
$$;

create or replace function is_conversation_party(p_conv uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from conversations c
                 where c.id = p_conv and auth.uid() in (c.buyer_id, c.seller_id));
$$;

create or replace function is_dispute_party(p_dispute uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from disputes d join orders o on o.id = d.order_id
                 where d.id = p_dispute and auth.uid() in (o.buyer_id, o.seller_id));
$$;

alter table areas                  enable row level security;
alter table profiles               enable row level security;
alter table pro_profiles           enable row level security;
alter table identity_verifications enable row level security;
alter table categories             enable row level security;
alter table items                  enable row level security;
alter table item_photos            enable row level security;
alter table favourites             enable row level security;
alter table conversations          enable row level security;
alter table offers                 enable row level security;
alter table messages               enable row level security;
alter table settings               enable row level security;
alter table exchange_rates         enable row level security;
alter table orders                 enable row level security;
alter table order_items            enable row level security;
alter table shipments              enable row level security;
alter table bumps                  enable row level security;
alter table payments               enable row level security;
alter table ledger_entries         enable row level security;
alter table payouts                enable row level security;
alter table disputes               enable row level security;
alter table dispute_evidence       enable row level security;
alter table reviews                enable row level security;
alter table reports                enable row level security;
alter table sanctions              enable row level security;
alter table notifications          enable row level security;
alter table devices                enable row level security;
alter table webhook_events         enable row level security;
alter table audit_log              enable row level security;
-- settings, webhook_events, audit_log, sanctions : RLS sans politique = refus total (serveur seulement).

-- référentiels en lecture publique
create policy areas_read       on areas          for select using (true);
create policy categories_read  on categories     for select using (true);
create policy fx_read          on exchange_rates for select using (true);

-- profils : ligne complète visible par son propriétaire ; le public passe par la vue
create policy profiles_self_read on profiles for select using (id = auth.uid());
-- colonnes modifiables par le membre : le reste (role, status, verification_level, rating) = serveur
revoke update on profiles from authenticated;
grant update (display_name, avatar_path, bio, preferred_lang, area_id, holiday_mode) on profiles to authenticated;
create policy profiles_self_update on profiles for update using (id = auth.uid()) with check (id = auth.uid());

create view public_profiles as
  select id, display_name, avatar_path, bio, area_id, is_pro, verification_level,
         rating_avg, rating_count, holiday_mode, status, created_at
  from profiles where status <> 'banned';
grant select on public_profiles to anon, authenticated;

create policy pro_read on pro_profiles for select using (verified_at is not null or user_id = auth.uid());
create policy pro_write on pro_profiles for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy idv_own_read   on identity_verifications for select using (user_id = auth.uid());
create policy idv_own_insert on identity_verifications for insert with check (user_id = auth.uid());

-- annonces : visibles si publiques ; le vendeur voit les siennes.
-- Le client ne touche QUE aux brouillons. Publier ou modifier une annonce active passe par l'API
-- serveur, qui vérifie le plafond de valeur, la catégorie autorisée et le texte.
create policy items_read on items for select
  using (status in ('active','reserved','sold') or seller_id = auth.uid());
create policy items_insert on items for insert
  with check (seller_id = auth.uid() and status = 'draft');
create policy items_update on items for update
  using (seller_id = auth.uid() and status = 'draft')
  with check (seller_id = auth.uid() and status = 'draft');
create policy items_delete on items for delete using (seller_id = auth.uid() and status = 'draft');

create policy photos_read on item_photos for select
  using (exists (select 1 from items i where i.id = item_id
                 and (i.status in ('active','reserved','sold') or i.seller_id = auth.uid())));
create policy photos_write on item_photos for all
  using (exists (select 1 from items i where i.id = item_id and i.seller_id = auth.uid()))
  with check (exists (select 1 from items i where i.id = item_id and i.seller_id = auth.uid()));

create policy fav_own on favourites for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy conv_read   on conversations for select using (auth.uid() in (buyer_id, seller_id));
create policy conv_insert on conversations for insert with check (buyer_id = auth.uid());

create policy msg_read   on messages for select using (is_conversation_party(conversation_id));
create policy msg_insert on messages for insert
  with check (sender_id = auth.uid() and kind in ('text','image') and is_conversation_party(conversation_id));

create policy offers_read   on offers for select using (is_conversation_party(conversation_id));
create policy offers_insert on offers for insert with check (buyer_id = auth.uid() and is_conversation_party(conversation_id));

-- argent et commandes : lecture par les parties, AUCUNE écriture cliente
create policy orders_read    on orders      for select using (auth.uid() in (buyer_id, seller_id));
create policy oitems_read    on order_items for select using (is_order_party(order_id));
create policy shipments_read on shipments   for select using (is_order_party(order_id));
create policy bumps_read     on bumps       for select using (seller_id = auth.uid());
create policy payments_read  on payments    for select
  using ((order_id is not null and is_order_party(order_id))
         or exists (select 1 from bumps b where b.id = bump_id and b.seller_id = auth.uid()));
create policy ledger_read    on ledger_entries for select using (user_id = auth.uid());
create policy payouts_read   on payouts     for select using (user_id = auth.uid());

create policy disputes_read   on disputes for select using (is_order_party(order_id));
create policy evidence_read   on dispute_evidence for select using (is_dispute_party(dispute_id));
create policy evidence_insert on dispute_evidence for insert
  with check (author_id = auth.uid() and is_dispute_party(dispute_id));

create policy reviews_read on reviews for select using (true);   -- création = serveur (commande terminée)

create policy reports_insert on reports for insert with check (reporter_id = auth.uid());
create policy reports_read   on reports for select using (reporter_id = auth.uid());

create policy notif_read   on notifications for select using (user_id = auth.uid());
create policy notif_update on notifications for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy devices_own  on devices for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ====================================================== PRIVILÈGES (défense en profondeur)
-- Supabase accorde par défaut tous les droits à anon/authenticated et ne compte que sur la RLS.
-- On retire explicitement ce qui ne doit JAMAIS venir du client.
revoke all on all tables in schema public from anon;
grant select on areas, categories, items, item_photos, exchange_rates, reviews, pro_profiles,
  public_profiles to anon;

revoke insert, update, delete, truncate on
  orders, order_items, shipments, bumps, payments, ledger_entries, payouts,
  disputes, reviews, exchange_rates, areas, categories
  from authenticated;
-- Tables purement serveur : aucun accès client, ni lecture ni écriture.
revoke all on settings, webhook_events, audit_log, sanctions from authenticated;

-- =================================================================== SEED

-- Paramètres de départ. PLACEHOLDER : à décider, à valider avec le PSP et un juriste.
insert into settings (key, value) values
  ('max_photos',               '20'),
  ('max_materials',            '3'),
  ('max_item_value_usd_minor', '100000'),
  ('claim_window_hours',       '48'),
  ('return_window_business_days', '5'),
  ('lost_parcel_business_days',   '10'),
  ('order_payment_ttl_minutes',   '15'),
  ('offer_ttl_hours',             '48'),
  ('hidden_fix_deadline_hours',   '24'),
  ('handover_max_attempts',       '5'),
  ('buyer_protection', '{"_placeholder": true, "pct_bps": 0, "fixed_minor": {"USD": 0, "CDF": 0}}'),
  ('payout_min_minor', '{"_placeholder": true, "USD": 500, "CDF": 10000}');

-- Géographie : pays, 26 provinces (fuseaux IANA à vérifier), 24 communes de Kinshasa.
insert into areas (kind, name, tz) values ('country', 'République démocratique du Congo', 'Africa/Kinshasa');

insert into areas (parent_id, kind, name, tz)
select c.id, 'province', v.n, v.tz
from areas c,
     (values
       ('Kinshasa','Africa/Kinshasa'), ('Kongo Central','Africa/Kinshasa'),
       ('Kwango','Africa/Kinshasa'), ('Kwilu','Africa/Kinshasa'),
       ('Mai-Ndombe','Africa/Kinshasa'), ('Équateur','Africa/Kinshasa'),
       ('Mongala','Africa/Kinshasa'), ('Nord-Ubangi','Africa/Kinshasa'),
       ('Sud-Ubangi','Africa/Kinshasa'), ('Tshuapa','Africa/Kinshasa'),
       ('Kasaï','Africa/Lubumbashi'), ('Kasaï-Central','Africa/Lubumbashi'),
       ('Kasaï-Oriental','Africa/Lubumbashi'), ('Lomami','Africa/Lubumbashi'),
       ('Sankuru','Africa/Lubumbashi'), ('Maniema','Africa/Lubumbashi'),
       ('Sud-Kivu','Africa/Lubumbashi'), ('Nord-Kivu','Africa/Lubumbashi'),
       ('Ituri','Africa/Lubumbashi'), ('Haut-Uélé','Africa/Lubumbashi'),
       ('Bas-Uélé','Africa/Lubumbashi'), ('Tshopo','Africa/Lubumbashi'),
       ('Tanganyika','Africa/Lubumbashi'), ('Haut-Lomami','Africa/Lubumbashi'),
       ('Lualaba','Africa/Lubumbashi'), ('Haut-Katanga','Africa/Lubumbashi')
     ) as v(n, tz)
where c.kind = 'country';

insert into areas (parent_id, kind, name, tz)
select p.id, 'commune', v.n, 'Africa/Kinshasa'
from areas p,
     unnest(array['Bandalungwa','Barumbu','Bumbu','Gombe','Kalamu','Kasa-Vubu','Kimbanseke',
                  'Kinshasa','Kintambo','Kisenso','Lemba','Limete','Lingwala','Makala','Maluku',
                  'Masina','Matete','Mont-Ngafula','Ndjili','Ngaba','Ngaliema','Ngiri-Ngiri',
                  'Nsele','Selembao']) as v(n)
where p.kind = 'province' and p.name = 'Kinshasa';

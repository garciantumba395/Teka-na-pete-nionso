-- 0002_backend : tables propres à l'implémentation serveur (sessions, codes SMS, limites de débit, photos).

-- Sessions : jeton aléatoire opaque dans un cookie HttpOnly. Seule son empreinte SHA-256 est stockée.
create table sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  token_hash text not null unique,
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index on sessions (user_id);
create index on sessions (expires_at);

-- Codes SMS à usage unique. Le code n'est jamais stocké en clair (HMAC avec un secret serveur).
create table otp_codes (
  phone text primary key check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  code_hash text not null,
  attempts smallint not null default 0 check (attempts >= 0),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index on otp_codes (expires_at);

-- Limitation de débit à fenêtre fixe. Les clés ne contiennent jamais d'adresse IP ni de téléphone en clair.
create table rate_limits (
  key text primary key,
  window_start timestamptz not null,
  count integer not null check (count >= 0)
);
create index on rate_limits (window_start);

-- Photos : stockées en base tant qu'aucun stockage objet n'est configuré (interface prévue pour changer).
create table photo_blobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id) on delete cascade,
  mime text not null check (mime in ('image/jpeg', 'image/png', 'image/webp', 'image/svg+xml')),
  size integer not null check (size > 0 and size <= 600000),
  content bytea not null,
  created_at timestamptz not null default now()
);
create index on photo_blobs (owner_id);

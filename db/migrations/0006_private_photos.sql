-- 0006_private_photos : photos jointes aux messages et aux preuves de litige.
-- Contrairement à photo_blobs (photos d'annonces, publiques), ces photos ne sont lisibles que par les
-- participants de la conversation ou du litige (et l'assistance pour un litige) : le contrôle se fait dans
-- la route de service, à partir du lien vers le message ou la preuve.
create table private_photos (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id) on delete cascade,
  mime text not null check (mime in ('image/jpeg', 'image/png', 'image/webp')),
  size integer not null check (size > 0 and size <= 450000),
  content bytea not null,
  message_id uuid references messages(id) on delete cascade,
  evidence_id uuid references dispute_evidence(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint private_photo_one_target check (num_nonnulls(message_id, evidence_id) = 1)
);
-- Une photo par message, une par preuve.
create unique index private_photos_message_idx on private_photos (message_id) where message_id is not null;
create unique index private_photos_evidence_idx on private_photos (evidence_id) where evidence_id is not null;
create index on private_photos (owner_id);

-- Même traitement que 0003 : refus par défaut pour toute API publique de base de données.
alter table private_photos enable row level security;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table public.private_photos from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on table public.private_photos from authenticated';
  end if;
end $$;

-- 0011_member_follows : marques et tailles que suit un membre (fil « Pour toi » de l'accueil).
-- Une ligne = une marque ou une taille. `value_key` est la clé de comparaison (sans accent, sans casse, espaces réduits),
-- calculée par le serveur ; `label` garde la saisie nettoyée pour l'affichage. Unicité par (membre, type, clé) : suivre deux
-- fois la même marque, « Zéphyr » et « zephyr » par exemple, ne crée qu'une ligne. Le plafond de 10 par type est vérifié par
-- le serveur sous verrou (voir addFollow). Les favoris existent déjà (table `favourites`, 0001) : rien à ajouter pour eux.
create table member_follows (
  user_id    uuid not null references profiles(id) on delete cascade,
  kind       text not null check (kind in ('brand', 'size')),
  value_key  text not null check (char_length(value_key) between 1 and 40),
  label      text not null check (char_length(label) between 1 and 40),
  seq        bigint generated always as identity,   -- ordre d'ajout, pour un affichage stable
  created_at timestamptz not null default now(),
  primary key (user_id, kind, value_key)
);
create index member_follows_lookup_idx on member_follows (kind, value_key);

-- Index de tri « les plus aimés » et de lecture des favoris d'un membre.
create index if not exists favourites_user_created_idx on favourites (user_id, created_at desc);

-- Même traitement que 0003 : RLS activée sans politique, rien de lisible par les rôles d'API publique.
alter table member_follows enable row level security;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table public.member_follows from anon';
    execute format('revoke all on sequence %s from anon', pg_get_serial_sequence('public.member_follows', 'seq'));
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on table public.member_follows from authenticated';
    execute format('revoke all on sequence %s from authenticated', pg_get_serial_sequence('public.member_follows', 'seq'));
  end if;
end $$;

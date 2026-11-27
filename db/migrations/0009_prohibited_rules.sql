-- 0009_prohibited_rules : catalogue des articles interdits, rechargeable sans redéployer.
-- Une ligne = une règle : libellé et message en français, mots-clés (comparés sans accent ni casse, avec limites de mots),
-- exceptions (expressions légitimes qui contiennent un mot interdit). Les mots-clés ne sortent jamais de l'API publique.
-- Le jeu de règles par défaut est inséré par la donnée de référence (seedReference, à partir du code) ; une table vide
-- retombe sur ce même jeu dans le code. LISTE À FAIRE VALIDER PAR UN JURISTE LOCAL avant le lancement public.
create table prohibited_rules (
  id           text primary key check (id ~ '^[a-z0-9-]{2,40}$'),
  label        text not null check (char_length(label) between 1 and 120),
  message      text not null check (char_length(message) between 1 and 500),
  keywords     text[] not null check (cardinality(keywords) > 0),
  except_phrases text[] not null default '{}',
  active       boolean not null default true,
  sort_order   integer not null default 0,
  updated_at   timestamptz not null default now()
);
create index prohibited_rules_active_idx on prohibited_rules (sort_order) where active;

-- Même traitement que 0003 : RLS activée sans politique, rien de lisible par les rôles d'API publique.
alter table prohibited_rules enable row level security;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table public.prohibited_rules from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on table public.prohibited_rules from authenticated';
  end if;
end $$;

-- 0003_rls_deny_default : refus par défaut pour toute API publique de base de données.
-- Sur Supabase, les tables du schéma public sont exposées par l'API REST avec la clé « anon ».
-- RLS activée SANS politique = aucune ligne lisible ni modifiable par anon/authenticated.
-- L'application se connecte avec le rôle PROPRIÉTAIRE des tables (ou un rôle BYPASSRLS), qui n'est pas soumis à la RLS.
-- Toute nouvelle table doit recevoir ce même traitement dans sa migration.
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' and tablename <> 'schema_migrations' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on all tables in schema public from anon';
    execute 'revoke all on all sequences in schema public from anon';
    execute 'revoke all on all functions in schema public from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on all tables in schema public from authenticated';
    execute 'revoke all on all sequences in schema public from authenticated';
    execute 'revoke all on all functions in schema public from authenticated';
  end if;
end $$;

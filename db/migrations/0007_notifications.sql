-- 0007_notifications : centre de notifications internes, regroupement des messages, préférences SMS.
-- La table notifications existe depuis 0001 (user_id, kind, payload, channels_sent, read_at, created_at) : on la réutilise.

-- Idempotence : une notification d'événement est identifiée par (membre, clé d'événement), ex. « order_paid:<commande> ».
-- Rejouer l'événement (webhook en double, tâche relancée) ne crée donc jamais de doublon.
alter table notifications add column event_key text;
create unique index notifications_event_key_uq on notifications (user_id, event_key) where event_key is not null;

-- Regroupement : une seule notification NON LUE par groupe (ex. « conv:<conversation> » pour les messages).
-- Dès qu'elle est lue, le groupe suivant crée une nouvelle notification.
alter table notifications add column group_key text;
create unique index notifications_group_unread_uq on notifications (user_id, group_key) where group_key is not null and read_at is null;

-- Pastille de non-lus (comptage par membre) et purge des notifications lues.
create index notifications_unread_idx on notifications (user_id, created_at desc) where read_at is null;
create index notifications_read_purge_idx on notifications (read_at) where read_at is not null;

-- Préférences : seuls les SMS se règlent, par catégorie. Les notifications internes ne se désactivent pas.
-- Absence de ligne = valeurs par défaut (SMS critiques activés).
create table notification_preferences (
  user_id uuid primary key references profiles(id) on delete cascade,
  sms_orders boolean not null default true,
  sms_disputes boolean not null default true,
  updated_at timestamptz not null default now()
);

-- Même traitement que 0003 : RLS activée sans politique, aucun accès par l'API publique de base de données.
alter table notification_preferences enable row level security;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table public.notification_preferences from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on table public.notification_preferences from authenticated';
  end if;
end $$;

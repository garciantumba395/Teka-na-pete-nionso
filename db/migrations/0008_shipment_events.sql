-- 0008_shipment_events : historique horodaté des étapes d'une livraison par coursier local.
-- Une ligne par étape (paiement reçu, remis au coursier, en route, reçu, colis signalé perdu, libération ou
-- remboursement automatique). Le coursier n'a pas de compte : c'est le vendeur ou l'acheteur qui agit (actor_id).
create table shipment_events (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references shipments(id) on delete cascade,
  order_id uuid not null references orders(id) on delete cascade,
  kind text not null
    check (kind in ('paid','handed_to_courier','in_transit','received','lost_reported','auto_released','auto_refunded')),
  actor_id uuid references profiles(id) on delete set null,
  note text check (char_length(note) <= 500),
  created_at timestamptz not null default now(),
  seq bigint generated always as identity   -- ordre d'insertion stable (même milliseconde)
);
create index shipment_events_order_idx on shipment_events (order_id, seq);

-- Refus par défaut pour l'API publique de base de données (voir 0003) : RLS activée SANS politique.
alter table shipment_events enable row level security;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table public.shipment_events from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on table public.shipment_events from authenticated';
  end if;
end $$;

-- Livraison par coursier : c'est l'acheteur qui confirme la réception (nouvelle valeur « buyer »).
alter table shipments drop constraint shipments_delivered_confirmed_by_check;
alter table shipments add constraint shipments_delivered_confirmed_by_check
  check (delivered_confirmed_by in ('buyer_code','buyer','courier','auto'));

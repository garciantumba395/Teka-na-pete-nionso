-- 0005_cancel_requests : demande d'annulation de l'acheteur après paiement (agent A : annulation encadrée).
-- Après paiement et avant remise, l'acheteur ne peut plus annuler seul : il demande l'annulation, le vendeur accepte ou refuse.
-- Les statuts de commande ne changent pas (orders_guard_transition reste valable) : l'état de la demande vit dans cette table.
create table order_cancel_requests (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete restrict,
  requested_by uuid not null references profiles(id) on delete restrict,
  -- pending : en attente ; accepted : le vendeur a accepté (commande annulée, acheteur remboursé) ; declined : refusée ;
  -- withdrawn : retirée par l'acheteur ; closed : devenue sans objet (remise par code, annulation du vendeur, délai de commande dépassé).
  -- Une demande « pending » trop ancienne est traitée comme un refus À LA LECTURE (délai dans settings.cancel_request_days) : aucune écriture d'argent.
  status text not null default 'pending' check (status in ('pending','accepted','declined','withdrawn','closed')),
  requested_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references profiles(id) on delete restrict,
  constraint order_cancel_requests_resolved check ((status = 'pending') = (resolved_at is null))
);
-- Une seule demande en attente par commande (double clic, requêtes concurrentes).
create unique index order_cancel_requests_one_pending on order_cancel_requests (order_id) where status = 'pending';
create index order_cancel_requests_order_idx on order_cancel_requests (order_id, requested_at desc);
-- Même traitement que 0003 : RLS activée sans politique = refus par défaut pour l'API publique de base de données.
alter table order_cancel_requests enable row level security;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table public.order_cancel_requests from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on table public.order_cancel_requests from authenticated';
  end if;
end $$;

-- 0010_courier_fees : règlement des frais de livraison par coursier.
-- (1) Nouveau compte du grand livre `courier_paid` : contrepartie du règlement du coursier par la plateforme
--     (débit de shipping_payable, crédit de courier_paid), utilisé seulement quand settings.courier_fee_mode = 'platform'.
-- (2) Nouveau type de référence `order_shipping` : la part « livraison » versée au vendeur à la libération (mode 'seller')
--     est une ligne séparée de la part « articles », pour que l'historique du portefeuille les distingue.
-- Le grand livre reste append-only et équilibré par devise (trigger 0001 inchangé).
alter table ledger_entries drop constraint ledger_entries_account_check;
alter table ledger_entries add constraint ledger_entries_account_check check (account in
  ('psp_clearing','order_escrow','seller_available','payout_pending',
   'shipping_payable','platform_revenue','psp_fees','courier_paid'));
alter table ledger_entries drop constraint ledger_entries_ref_type_check;
alter table ledger_entries add constraint ledger_entries_ref_type_check check (ref_type in
  ('order','order_shipping','payment','payout','dispute','bump','adjustment'));

-- Règlement : au plus UN règlement par commande (idempotence et protection contre le double clic), tracé avec son auteur.
create table courier_settlements (
  order_id uuid primary key references orders(id) on delete restrict,
  settled_by uuid not null references profiles(id) on delete restrict,
  amount_minor bigint not null check (amount_minor > 0),
  currency char(3) not null check (currency in ('CDF','USD')),
  settled_at timestamptz not null default now()
);
alter table courier_settlements enable row level security;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table public.courier_settlements from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on table public.courier_settlements from authenticated';
  end if;
end $$;

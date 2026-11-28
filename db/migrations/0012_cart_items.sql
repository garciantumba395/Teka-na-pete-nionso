-- 0012_cart_items : panier d'un membre (lots d'articles d'un même vendeur).
-- Un article n'apparaît qu'une fois par panier (clé primaire). Le panier ne réserve RIEN : la réservation se fait
-- à la commande, en une seule transaction pour tous les articles du lot (tout ou rien).
-- Nettoyage : à la suppression d'un article ou d'un compte (cascade), à la commande (les articles commandés sortent du
-- panier) ; un article devenu indisponible reste affiché comme tel jusqu'à ce que le membre le retire.
create table cart_items (
  user_id uuid not null references profiles(id) on delete cascade,
  item_id uuid not null references items(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (user_id, item_id)
);
create index cart_items_item_idx on cart_items (item_id);

-- Refus par défaut pour l'API publique de base de données (voir 0003) : RLS activée SANS politique.
alter table cart_items enable row level security;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table public.cart_items from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on table public.cart_items from authenticated';
  end if;
end $$;

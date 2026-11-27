\set ON_ERROR_STOP on
begin;
insert into auth.users(id) values
 ('00000000-0000-0000-0000-0000000000a1'),('00000000-0000-0000-0000-0000000000b1'),('00000000-0000-0000-0000-0000000000b2');
insert into profiles(id,phone,display_name) values
 ('00000000-0000-0000-0000-0000000000a1','+243810000001','Vendeur'),
 ('00000000-0000-0000-0000-0000000000b1','+243820000002','Acheteur1'),
 ('00000000-0000-0000-0000-0000000000b2','+243990000003','Acheteur2');
insert into categories(slug,name) values ('robes','{"fr":"Robes"}');
insert into items(id,seller_id,category_id,title,description,condition,price_minor,currency,status,brand)
 select '00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000a1',id,'Robe wax taille M','Très bon état','very_good',2500,'USD','active','Ankara' from categories;
select 'search_trigger', (search is not null and search @@ plainto_tsquery('simple', unaccent('très wax'))) from items;

-- A. deux acheteurs, même article : la base doit refuser le second
insert into orders(id,buyer_id,seller_id,currency,items_minor,total_minor,delivery_method)
 values ('00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000a1','USD',2500,2500,'hand_delivery');
insert into order_items(order_id,item_id,price_minor,currency) values ('00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000c1',2500,'USD');
insert into orders(id,buyer_id,seller_id,currency,items_minor,total_minor,delivery_method)
 values ('00000000-0000-0000-0000-0000000000d2','00000000-0000-0000-0000-0000000000b2','00000000-0000-0000-0000-0000000000a1','USD',2500,2500,'hand_delivery');
do $$ begin
  insert into order_items(order_id,item_id,price_minor,currency) values ('00000000-0000-0000-0000-0000000000d2','00000000-0000-0000-0000-0000000000c1',2500,'USD');
  raise notice 'FAIL A: double reservation accepted';
exception when unique_violation then raise notice 'PASS A: second buyer rejected by unique index'; end $$;

-- B. transition invalide
do $$ begin
  update orders set status='completed' where id='00000000-0000-0000-0000-0000000000d1';
  raise notice 'FAIL B: pending_payment -> completed accepted';
exception when check_violation then raise notice 'PASS B: invalid transition rejected'; end $$;

-- C. total incohérent
do $$ begin
  insert into orders(buyer_id,seller_id,currency,items_minor,shipping_minor,total_minor,delivery_method)
   values ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000a1','USD',2500,100,2500,'hand_delivery');
  raise notice 'FAIL C: bad total accepted';
exception when check_violation then raise notice 'PASS C: total mismatch rejected'; end $$;

-- D. annulation : l'article redevient actif et libre
update items set status='reserved' where id='00000000-0000-0000-0000-0000000000c1';
update orders set status='cancelled' where id='00000000-0000-0000-0000-0000000000d1';
select 'D_item_back_to_active', status from items where id='00000000-0000-0000-0000-0000000000c1';
select 'D_slot_freed', not is_open from order_items where order_id='00000000-0000-0000-0000-0000000000d1';
insert into order_items(order_id,item_id,price_minor,currency) values ('00000000-0000-0000-0000-0000000000d2','00000000-0000-0000-0000-0000000000c1',2500,'USD');
select 'D_second_buyer_can_now_reserve', true;

-- E. cycle complet -> sold
update orders set status='paid' where id='00000000-0000-0000-0000-0000000000d2';
update orders set status='delivered' where id='00000000-0000-0000-0000-0000000000d2';
update orders set status='completed' where id='00000000-0000-0000-0000-0000000000d2';
select 'E_item_sold', status from items where id='00000000-0000-0000-0000-0000000000c1';

-- F. grand livre : écriture équilibrée acceptée, déséquilibrée refusée, ajout seul
insert into ledger_entries(txn_id,account,user_id,currency,amount_minor,ref_type,ref_id) values
 ('00000000-0000-0000-0000-0000000000e1','psp_clearing',null,'USD',2500,'order','00000000-0000-0000-0000-0000000000d2'),
 ('00000000-0000-0000-0000-0000000000e1','order_escrow',null,'USD',-2500,'order','00000000-0000-0000-0000-0000000000d2');
set constraints all immediate;
select 'F_balanced_ok', true;
do $$ begin
  insert into ledger_entries(txn_id,account,currency,amount_minor,ref_type,ref_id) values
   ('00000000-0000-0000-0000-0000000000e2','psp_clearing','USD',100,'adjustment','00000000-0000-0000-0000-0000000000d2');
  set constraints all immediate;
  raise notice 'FAIL F: unbalanced ledger accepted';
exception when others then raise notice 'PASS F: unbalanced ledger rejected (%)', sqlerrm; end $$;
do $$ begin
  update ledger_entries set amount_minor = 1;
  raise notice 'FAIL G: ledger update accepted';
exception when others then raise notice 'PASS G: ledger append-only (%)', sqlerrm; end $$;

-- H. paiement : une seule cible
do $$ begin
  insert into payments(provider,method,amount_minor,currency,idempotency_key) values ('x','mpesa',100,'USD','k1');
  raise notice 'FAIL H: payment without target accepted';
exception when check_violation then raise notice 'PASS H: payment needs exactly one target'; end $$;

-- I. RLS
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b1',true);
select 'I_buyer1_sees_orders(expect 1)', count(*) from orders;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b2',true);
select 'I_buyer2_sees_orders(expect 1)', count(*) from orders;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',true);
select 'I_seller_sees_orders(expect 2)', count(*) from orders;
do $$ begin update orders set status='completed'; raise notice 'FAIL J: client updated orders';
exception when insufficient_privilege then raise notice 'PASS J: client cannot write orders'; end $$;
do $$ begin insert into ledger_entries(txn_id,account,currency,amount_minor,ref_type,ref_id) values (gen_random_uuid(),'seller_available','USD',-1,'adjustment',gen_random_uuid());
 raise notice 'FAIL J2: client wrote ledger'; exception when insufficient_privilege then raise notice 'PASS J2: client cannot write ledger'; end $$;
do $$ begin update profiles set role='admin' where id='00000000-0000-0000-0000-0000000000a1';
 raise notice 'FAIL K: member changed own role'; exception when insufficient_privilege then raise notice 'PASS K: role column not updatable by member'; end $$;
do $$ begin insert into items(seller_id,category_id,title,condition,price_minor,currency,status)
  select '00000000-0000-0000-0000-0000000000a1',id,'Directement actif','good',99999999,'USD','active' from categories;
 raise notice 'FAIL L: client published an active item'; exception when insufficient_privilege or check_violation or others then raise notice 'PASS L: client cannot insert an active item (%)', sqlerrm; end $$;
do $$ begin perform 1 from settings; raise notice 'FAIL M: client read settings'; exception when insufficient_privilege then raise notice 'PASS M: settings not readable by client'; end $$;
reset role;
set local role anon;
do $$ begin perform 1 from orders; raise notice 'FAIL N: anon read orders'; exception when insufficient_privilege then raise notice 'PASS N: anon cannot read orders'; end $$;
select 'N_anon_sees_public_items(expect 1: sold items stay visible)', count(*) from items;
select 'N_anon_public_profiles', count(*) from public_profiles;
rollback;

# Tests du schéma

`../schema.sql` est testé sur PostgreSQL 16 avec un faux schéma `auth` (émulation Supabase).

```bash
createdb t
psql -d t -f test_stub_supabase.sql      # rôles anon/authenticated + auth.uid()
psql -d t -c "alter default privileges in schema public grant all on tables to anon, authenticated"
psql -d t -v ON_ERROR_STOP=1 -f ../schema.sql
psql -d t -At -f test_behaviour.sql | grep -E "PASS|FAIL|ERROR"
```

Attendu : uniquement des lignes `PASS`. Couvre : double réservation d'un article, machine d'états des commandes,
cohérence des totaux, grand livre équilibré et en ajout seul, droits clients (commandes, grand livre, paramètres, rôle).

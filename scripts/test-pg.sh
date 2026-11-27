#!/usr/bin/env bash
# Lance les tests contre un PostgreSQL JETABLE (aucune donnée existante n'est touchée).
#  - Si DATABASE_URL_TEST est déjà défini (CI avec un service PostgreSQL) : l'utilise tel quel.
#  - Sinon : démarre un cluster temporaire avec les binaires PG_BIN (par défaut /usr/lib/postgresql/16/bin), puis le supprime.
set -euo pipefail
if [[ -n "${DATABASE_URL_TEST:-}" ]]; then
  exec npx vitest run "$@"
fi
PG_BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
D="$(mktemp -d /var/tmp/pgtest.XXXXXX)"
PORT="${PG_TEST_PORT:-5544}"
cleanup() { su postgres -c "$PG_BIN/pg_ctl -D $D/data -m immediate stop" >/dev/null 2>&1 || true; rm -rf "$D"; }
trap cleanup EXIT
chown postgres "$D"; chmod 700 "$D"
su postgres -c "$PG_BIN/initdb -D $D/data -A trust >/dev/null"
su postgres -c "$PG_BIN/pg_ctl -D $D/data -o '-p $PORT -k $D -c fsync=off' -l $D/log -w start" >/dev/null
psql -h "$D" -p "$PORT" -U postgres -q -c "create database app_test"
export DATABASE_URL_TEST="postgres://postgres@127.0.0.1:$PORT/app_test"
npx vitest run "$@"

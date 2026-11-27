#!/usr/bin/env bash
# Prépare un serveur de développement propre (couche factice ou PostgreSQL), lance une commande contre lui, puis nettoie.
#   scripts/e2e-server.sh fake [commande…]     (défaut : npx playwright test)
#   scripts/e2e-server.sh pg   [commande…]     base PostgreSQL JETABLE créée puis supprimée
#   E2E_DATABASE_URL_BASE=postgres://… scripts/e2e-server.sh pg …   utilise un serveur PostgreSQL existant (crée app_e2e)
#   PORT=3101 PG_TEST_PORT=5571 scripts/e2e-server.sh …   ports distincts pour tester en parallèle depuis plusieurs copies de travail
# `next start` (production) refuse volontairement les fournisseurs factices : on utilise donc `next dev`.
set -uo pipefail
cd "$(dirname "$0")/.."
MODE="${1:-fake}"; shift || true
CMD=("$@"); [[ ${#CMD[@]} -eq 0 ]] && CMD=(npx playwright test)
PORT="${PORT:-3100}"; PG_BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"; PGPORT="${PG_TEST_PORT:-5566}"
TMPD=""; SERVER_PID=""

# Libère SEULEMENT le port de ce serveur : plusieurs copies de travail peuvent tester en parallèle (un port et un PG_TEST_PORT chacune).
free_port() {
  local pids; pids="$(lsof -ti "tcp:$PORT" -sTCP:LISTEN 2>/dev/null || true)"
  [[ -n "$pids" ]] && kill $pids 2>/dev/null; return 0
}

cleanup() {
  [[ -n "$SERVER_PID" ]] && { pkill -P "$SERVER_PID" 2>/dev/null; kill "$SERVER_PID" 2>/dev/null; }; free_port
  if [[ -n "$TMPD" ]]; then su postgres -c "$PG_BIN/pg_ctl -D $TMPD/data -m immediate stop" >/dev/null 2>&1; rm -rf "$TMPD"; fi
}
trap cleanup EXIT

free_port
for i in $(seq 1 20); do curl -s -o /dev/null --max-time 1 "http://localhost:$PORT/" || break; sleep 0.5; done
rm -rf .next/dev

export CRON_SECRET="e2e-cron-secret-0123456789abcdef" DEV_FIXED_OTP=123456 SMS_CONSOLE_QUIET=1 BASE_URL="http://localhost:$PORT"
if [[ "$MODE" == "pg" ]]; then
  if [[ -n "${E2E_DATABASE_URL_BASE:-}" ]]; then
    BASE="${E2E_DATABASE_URL_BASE%/}"
    psql "$BASE/postgres" -q -c "drop database if exists app_e2e with (force)" -c "create database app_e2e" || exit 1
  else
    TMPD="$(mktemp -d /var/tmp/pge2e.XXXXXX)"; chown postgres "$TMPD"; chmod 700 "$TMPD"
    su postgres -c "$PG_BIN/initdb -D $TMPD/data -A trust >/dev/null" && su postgres -c "$PG_BIN/pg_ctl -D $TMPD/data -o '-p $PGPORT -k $TMPD -c fsync=off' -l $TMPD/log -w start" >/dev/null || exit 1
    BASE="postgres://postgres@127.0.0.1:$PGPORT"
    psql -h "$TMPD" -p "$PGPORT" -U postgres -q -c "create database app_e2e" || exit 1
  fi
  export DATABASE_URL="$BASE/app_e2e" E2E_DATABASE_URL="$BASE/app_e2e" DATA_LAYER=pg
  npx tsx scripts/db.ts migrate >/dev/null && npx tsx scripts/db.ts seed-demo >/dev/null || { echo "préparation de la base échouée"; exit 1; }
else
  export DATA_LAYER=fake; unset E2E_DATABASE_URL
fi

(nohup npx next dev -p "$PORT" > /tmp/e2e-server.log 2>&1 & echo $! > /tmp/e2e-server.pid); SERVER_PID="$(cat /tmp/e2e-server.pid)"
for i in $(seq 1 90); do curl -s -o /dev/null -w "%{http_code}" "http://localhost:$PORT/api/health" 2>/dev/null | grep -q 200 && break; sleep 1; done
# préchauffage : le mode dev compile à la demande, la première requête de chaque route est lente
for p in / /search /signin /sell /wallet /me /orders/x /items/x /members/x /inbox /api/v1/categories /api/v1/areas; do curl -s -o /dev/null "http://localhost:$PORT$p"; done; sleep 2
echo "serveur prêt : mode=$MODE, $BASE_URL"
"${CMD[@]}"; RC=$?
exit $RC

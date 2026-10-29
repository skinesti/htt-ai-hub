#!/bin/sh
# Local throwaway Postgres for development and tests (never production).
# Usage: sh scripts/local-db.sh [start|stop]
# Data lives in .local/pg (gitignored). Listens on 127.0.0.1:54329 with no password (local trust only).
set -e
# Use the project-local Postgres from the embedded-postgres dev dependency when present.
BIN="$(cd "$(dirname "$0")/.." && pwd)/node_modules/@embedded-postgres/darwin-arm64/native/bin"
if [ -x "$BIN/pg_ctl" ]; then PATH="$BIN:$PATH"; fi
cd "$(dirname "$0")/.."
DATA=.local/pg
PORT=54329
if [ "${1:-start}" = "stop" ]; then
  pg_ctl -D "$DATA" stop -m fast
  exit 0
fi
mkdir -p .local
if [ ! -f "$DATA/PG_VERSION" ]; then
  initdb -D "$DATA" -U postgres --auth=trust --no-instructions >/dev/null
fi
if ! pg_ctl -D "$DATA" status >/dev/null 2>&1; then
  pg_ctl -D "$DATA" -l .local/pg.log -o "-p $PORT -c listen_addresses=127.0.0.1 -k $PWD/.local" start >/dev/null
fi
psql -h 127.0.0.1 -p $PORT -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname='htt_dev'" | grep -q 1 || createdb -h 127.0.0.1 -p $PORT -U postgres htt_dev
echo "Local Postgres running. Use DATABASE_URL=postgres://postgres@127.0.0.1:$PORT/htt_dev"

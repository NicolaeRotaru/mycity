#!/usr/bin/env bash
# =============================================================================
# Ricostruisce il database da zero su un Postgres locale.
# =============================================================================
# Applica l'impalcatura Supabase e poi TUTTE le migrazioni nell'ordine vero.
# Serve ai test RLS: girano contro lo schema reale, senza chiavi e senza rete.
#
# Uso:  tests/sql/harness/apply.sh [nome_database]
# Vuole le variabili standard di Postgres (PGHOST, PGUSER, ...) e un utente
# che possa creare database.
#
# Esce con codice diverso da zero se una migrazione non si applica: una
# migrazione che non gira e' un difetto, non un dettaglio.
# =============================================================================
set -euo pipefail

DB="${1:-mycity_test}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
MIG="$ROOT/migrations"

echo "▶ ricostruisco $DB"
psql -q -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS $DB WITH (FORCE);" >/dev/null
psql -q -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE $DB;" >/dev/null

echo "▶ impalcatura Supabase"
psql -q -d "$DB" -v ON_ERROR_STOP=1 -f "$HERE/00_shim_supabase.sql" >/dev/null

echo "▶ migrazioni"
failed=0
applied=0
# sort -V tiene l'ordine naturale e mette 108 prima di 108b
for f in $(ls "$MIG"/*.sql | sort -V); do
  name="$(basename "$f")"
  if out="$(psql -q -d "$DB" -v ON_ERROR_STOP=1 -f "$f" 2>&1)"; then
    applied=$((applied + 1))
    # Registra la migrazione come applicata, come fa Supabase: cosi' il
    # controllo di deriva (`npm run db:check-drift`) ha qualcosa da confrontare.
    # Il nome e' la parte DOPO il numero, senza estensione: e' la forma che lo
    # script si aspetta.
    versione="${name%%_*}"
    nome="${name#*_}"; nome="${nome%.sql}"
    psql -q -d "$DB" -c "INSERT INTO supabase_migrations.schema_migrations (version, name)
                         VALUES ('$versione', '$nome')
                         ON CONFLICT (version) DO NOTHING" >/dev/null 2>&1 || true
  else
    failed=$((failed + 1))
    echo "  ✗ $name"
    echo "$out" | grep -E "^psql:|ERROR" | head -3 | sed 's/^/      /'
  fi
done

echo "▶ applicate $applied · fallite $failed"
[ "$failed" -eq 0 ] || exit 1

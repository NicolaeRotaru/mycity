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
#
# 28/11/2026 (R11-005) — SALTA_MIGRAZIONI=<file>: un nome di file per riga (per
# esempio quelle che il controllo della deriva trova mancanti in produzione,
# MANCANTI_ESPORTA di scripts/check-migration-drift.mjs). Quelle non si applicano
# e non si registrano: il database ricostruito e' quello che la produzione ha
# davvero, non «tutti i file». Senza la variabile, come prima. Un file indicato
# che non si legge ferma tutto: ricostruire «tutti i file» al posto di «come la
# produzione» sarebbe proprio il verde che non prova niente.
# =============================================================================
set -euo pipefail

DB="${1:-mycity_test}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
MIG="$ROOT/migrations"
SALTA="${SALTA_MIGRAZIONI:-}"
if [ -n "$SALTA" ] && [ ! -r "$SALTA" ]; then
  echo "✗ SALTA_MIGRAZIONI=$SALTA non si legge: non ricostruisco niente"
  exit 1
fi

echo "▶ ricostruisco $DB"
psql -q -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS $DB WITH (FORCE);" >/dev/null
psql -q -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE $DB;" >/dev/null

echo "▶ impalcatura Supabase"
psql -q -d "$DB" -v ON_ERROR_STOP=1 -f "$HERE/00_shim_supabase.sql" >/dev/null

echo "▶ migrazioni"
failed=0
applied=0
skipped=0
# 5/11/2026 — Byte per byte (LC_ALL=C), come lo script del rilascio e il generatore dei tipi:
# 108_ prima di 108b_. Il commento di prima diceva cosi' di sort -V, che invece li invertiva.
for f in $(ls "$MIG"/*.sql | LC_ALL=C sort); do
  name="$(basename "$f")"
  if [ -n "$SALTA" ] && grep -qxF "$name" "$SALTA"; then
    skipped=$((skipped + 1))
    echo "  ↷ $name (saltata: SALTA_MIGRAZIONI)"
    continue
  fi
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
[ -z "$SALTA" ] || echo "▶ saltate $skipped (SALTA_MIGRAZIONI)"
[ "$failed" -eq 0 ] || exit 1

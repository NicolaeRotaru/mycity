#!/usr/bin/env bash
# =============================================================================
# `applica-migrazioni-mancanti.sh` non deve schiantarsi sul database di produzione
# =============================================================================
# Uso:  tests/sql/harness/lo-script-non-si-schianta-sul-database-nato-prima-del-registro.sh [nome_database]
#       (serve un Postgres raggiungibile: PGHOST/PGPORT/PGUSER come per gli altri harness)
#
# IL DIFETTO CHE QUESTO CONTROLLO TIENE CHIUSO (misurato il 7/9/2026).
#
# La scheda del difetto bloccante «la produzione e' indietro di ventuno
# migrazioni» prescrive come riparazione: «lanciare una volta
# scripts/applica-migrazioni-mancanti.sh contro produzione (idempotente,
# provato in CI)». Contro la produzione VERA quello script moriva sul primo
# file, senza applicare niente:
#
#   ▶ applico 001_create_tables.sql
#   psql: ERROR:  relation "profiles" already exists      (uscita 3)
#
# Perche': la produzione e' nata PRIMA che esistesse il registro delle
# migrazioni. Il suo `schema_migrations` ha 90 righe con version a timestamp
# (20260529013234) e name descrittivo, mentre i file si chiamano `001_...`.
# La regola di salto (`version = '001' OR name = 'create_tables'`) non trova
# niente, quindi la 001 risulta da applicare — e la 001 crea `public.profiles`
# senza IF NOT EXISTS, su un database che quella tabella ce l'ha da mesi.
#
# Sul database di PROVA il difetto non si vedeva: `apply.sh` costruisce da zero
# registrando ogni file col suo numero, quindi li salta tutti. Solo un database
# con la forma della produzione puo' fallire nel modo in cui falliva la
# produzione — per questo qui la produzione si RICOSTRUISCE, non si simula con
# una variabile.
#
# COSA PRETENDE QUESTO CONTROLLO:
#   1. lo script si ferma con uscita 2 (rifiuto pulito), non 3 (schianto psql);
#   2. spiega che il database ha una storia precedente al registro;
#   3. NON applica niente: il conteggio delle migrazioni registrate non cambia.
# Senza il controllo preventivo dentro lo script, il punto 1 e' rosso.
# =============================================================================
set -uo pipefail

DB="${1:-mycity_nato_prima_del_registro}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
MIG="$ROOT/migrations"

fallito=0
rosso() { echo "  ✗ $1"; fallito=1; }
verde() { echo "  ✓ $1"; }

echo "▶ ricostruisco un database con la forma della produzione: $DB"
psql -q -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS $DB WITH (FORCE);" >/dev/null 2>&1
psql -q -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE $DB;" >/dev/null
psql -q -d "$DB" -v ON_ERROR_STOP=1 -f "$HERE/00_shim_supabase.sql" >/dev/null

# (a) tutti gli oggetti esistono — come in produzione
for f in $(ls "$MIG"/*.sql | sort -V); do
  psql -q -d "$DB" -v ON_ERROR_STOP=1 --single-transaction -f "$f" >/dev/null 2>&1 \
    || { echo "  ! non ho potuto costruire il database di prova su $(basename "$f")"; exit 1; }
done

# (b) ma il registro NON conosce i numeri dei file: solo nomi storici, come in
#     produzione. E' questa la forma che fa fallire lo script.
psql -q -d "$DB" -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
CREATE SCHEMA IF NOT EXISTS supabase_migrations;
CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
  version text PRIMARY KEY, name text, statements text[]
);
TRUNCATE supabase_migrations.schema_migrations;
INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES
  ('20260529013234','payout_reversal_and_disputes'),
  ('20260531005009','atomic_stock_reservation'),
  ('20260828230000','129p_ponte_produzione_catalogo_visibile');
SQL

prima="$(psql -X -A -t -d "$DB" -c "SELECT count(*) FROM supabase_migrations.schema_migrations")"
esiste_profiles="$(psql -X -A -t -d "$DB" -c "SELECT to_regclass('public.profiles') IS NOT NULL")"
[ "$esiste_profiles" = "t" ] || { echo "  ! la prova non regge: profiles non esiste"; exit 1; }

echo "▶ lancio lo script come farebbe chi ripara la produzione"
uscita=0
SUPABASE_DB_URL="${SUPABASE_DB_URL_PROVA:-postgresql:///$DB}" \
  bash "$ROOT/scripts/applica-migrazioni-mancanti.sh" >/tmp/applica-prova.log 2>&1 || uscita=$?

echo "▶ verdetto (uscita: $uscita)"

# 1. rifiuto pulito, non schianto
if [ "$uscita" = "2" ]; then
  verde "si e' fermato con un rifiuto pulito (uscita 2)"
else
  rosso "uscita $uscita invece di 2 — non e' un rifiuto pulito"
  if grep -q "already exists" /tmp/applica-prova.log; then
    rosso "  ha provato ad applicare e si e' schiantato: $(grep -m1 'ERROR:' /tmp/applica-prova.log)"
  fi
fi

# 2. spiega perche'
if grep -q "storia precedente al registro" /tmp/applica-prova.log; then
  verde "ha spiegato che il database ha una storia precedente al registro"
else
  rosso "non ha spiegato il motivo del rifiuto"
fi

# 3. non ha toccato niente
dopo="$(psql -X -A -t -d "$DB" -c "SELECT count(*) FROM supabase_migrations.schema_migrations")"
if [ "$prima" = "$dopo" ]; then
  verde "non ha applicato niente (registro fermo a $dopo righe)"
else
  rosso "ha toccato il registro: da $prima a $dopo righe"
fi

psql -q -d postgres -c "DROP DATABASE IF EXISTS $DB WITH (FORCE);" >/dev/null 2>&1

if [ "$fallito" = "0" ]; then
  echo "✅ lo script si rifiuta invece di schiantarsi"
  exit 0
fi
echo "❌ il difetto e' aperto: lo script si schianta sul database di produzione"
echo "--- log ---"; tail -15 /tmp/applica-prova.log
exit 1

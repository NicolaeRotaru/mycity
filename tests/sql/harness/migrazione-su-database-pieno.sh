#!/usr/bin/env bash
# =============================================================================
# Le migrazioni devono reggere un database che ha già dentro degli ordini
# =============================================================================
# Uso:  tests/sql/harness/migrazione-su-database-pieno.sh [nome_database]
#
# IL BUCO CHE QUESTO CONTROLLO CHIUDE.
#
# `apply.sh` ricostruisce il database da zero: le migrazioni girano una dopo
# l'altra su tabelle VUOTE. Una migrazione che riscrive righe esistenti, lì,
# non riscrive niente — e passa comunque.
#
# È successo davvero. La 124 riempie `gross_total_cents` sugli ordini già
# presenti. Su `orders` vuota quella riga toccava zero righe, e
# `enforce_order_update_rules` è un grilletto PER RIGA: su zero righe non
# scatta mai. Tutte le prove verdi. Applicata al primo database con dentro un
# ordine vero, la stessa riga si è fermata sul posto:
#
#   ERROR: 42501: orders: modifica di un campo protetto non consentita
#   CONTEXT: PL/pgSQL function enforce_order_update_rules() line 27 at RAISE
#
# Era in transazione, quindi non si è rotto niente. Ma nessuna prova l'aveva
# vista, e non l'avrebbe vista mai: una tabella vuota non può fallire nel modo
# in cui fallisce una tabella piena.
#
# COSA FA QUI. Costruisce il database fermandosi PRIMA dell'ultima migrazione,
# ci mette dentro un ordine vero, poi applica l'ultima. Se si ferma, questo
# controllo è rosso. È il giro che fa un database di produzione, non quello che
# fa una ricostruzione da zero.
#
# Il controllo guarda l'ULTIMA migrazione per numero: quella nuova è sempre
# quella che non ha mai visto dati veri. Le precedenti sono già passate su un
# database vivo almeno una volta.
# =============================================================================
set -uo pipefail

DB="${1:-mycity_pieno}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
MIG="$ROOT/migrations"

ULTIMA="$(ls "$MIG"/*.sql | sort -V | tail -1)"
NOME_ULTIMA="$(basename "$ULTIMA")"

echo "▶ ricostruisco $DB fermandomi prima di $NOME_ULTIMA"
psql -q -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS $DB WITH (FORCE);" >/dev/null
psql -q -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE $DB;" >/dev/null
psql -q -d "$DB" -v ON_ERROR_STOP=1 -f "$HERE/00_shim_supabase.sql" >/dev/null

for f in $(ls "$MIG"/*.sql | sort -V); do
  [ "$f" = "$ULTIMA" ] && break
  if ! out="$(psql -q -d "$DB" -v ON_ERROR_STOP=1 -f "$f" 2>&1)"; then
    echo "  ✗ $(basename "$f") non si applica nemmeno su un database vuoto"
    echo "$out" | grep -E "^psql:|ERROR" | head -3 | sed 's/^/      /'
    exit 1
  fi
done

echo "▶ ci metto dentro un ordine vero"
if ! out="$(psql -q -d "$DB" -v ON_ERROR_STOP=1 -f "$HERE/seed-ordine-vero.sql" 2>&1)"; then
  echo "  ✗ non riesco a creare l'ordine di partenza"
  echo "$out" | grep -E "^psql:|ERROR" | head -5 | sed 's/^/      /'
  exit 1
fi

ordini="$(psql -tA -d "$DB" -c "SELECT count(*) FROM public.orders")"
if [ "$ordini" -lt 1 ]; then
  # Senza dati dentro, questo controllo non prova niente: meglio rosso che
  # un verde che non ha guardato.
  echo "  ✗ la tabella ordini è vuota: il controllo non proverebbe niente"
  exit 1
fi
echo "  ordini in tabella: $ordini"

echo "▶ applico $NOME_ULTIMA su un database che ha dentro dei dati"
if out="$(psql -q -d "$DB" -v ON_ERROR_STOP=1 -f "$ULTIMA" 2>&1)"; then
  echo "✓ $NOME_ULTIMA regge un database con dentro degli ordini"
  psql -q -d postgres -c "DROP DATABASE IF EXISTS $DB WITH (FORCE);" >/dev/null 2>&1
  exit 0
fi

echo "✗ $NOME_ULTIMA si ferma su un database con dentro degli ordini"
echo "$out" | grep -E "^psql:|ERROR|CONTEXT" | head -6 | sed 's/^/    /'
echo ""
echo "  In produzione questa migrazione non si applicherebbe. Se è una"
echo "  riscrittura di righe esistenti su una colonna protetta, le serve la"
echo "  chiave del progetto: PERFORM set_config('mycity.allow_order_write','1',true)"
echo "  dentro un blocco DO, come fanno le funzioni del progetto."
psql -q -d postgres -c "DROP DATABASE IF EXISTS $DB WITH (FORCE);" >/dev/null 2>&1
exit 1

#!/usr/bin/env bash
# =============================================================================
# La 160 deve applicarsi su un database che ha dentro un ordine ANNULLATO
# =============================================================================
# Uso:  tests/sql/harness/la-160-regge-un-ordine-annullato.sh [nome_database]
#
# IL BUCO CHE QUESTO CONTROLLO CHIUDE.
#
# `migrazione-su-database-pieno.sh` mette in tabella un ordine `NEW` e prova
# l'ultima migrazione. Bastava per la 124, che riscrive TUTTI gli ordini. Non
# basta per una migrazione che riscrive solo gli ANNULLATI: il suo
# `WHERE delivery_status = 'CANCELED'` su un ordine `NEW` tocca zero righe, e
# `enforce_order_update_rules` è un grilletto PER RIGA — su zero righe non
# scatta. Verde, e la migrazione in produzione si sarebbe fermata sul posto:
#
#   ERROR: 42501: orders: modifica di un campo protetto non consentita
#
# Un ordine annullato in tabella non è un dettaglio del seed: è la condizione
# che rende la prova capace di fallire.
#
# COSA PROVA, IN TRE PASSI.
#   ① La migrazione si applica su un database con dentro un ordine annullato.
#   ② Il riempimento ha DAVVERO toccato quella riga (se `stock_restored_at`
#      restasse vuoto, il passo ① sarebbe verde senza aver provato niente).
#   ③ Due chiamate di fila a `restore_stock_for_order` rimettono la merce a
#      scaffale UNA volta sola: 10 pezzi + 3 = 13, non 16.
# =============================================================================
set -uo pipefail

DB="${1:-mycity_prova_160}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
MIG="$ROOT/migrations"
LA160="$MIG/160_la_merce_torna_a_scaffale_una_volta_sola.sql"

pulisci() { psql -q -d postgres -c "DROP DATABASE IF EXISTS $DB WITH (FORCE);" >/dev/null 2>&1; }
muori()   { echo "✗ $1"; pulisci; exit 1; }

[ -f "$LA160" ] || muori "non trovo $LA160"

echo "▶ ricostruisco $DB fermandomi prima della 160"
pulisci
psql -q -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE $DB;" >/dev/null || exit 1
psql -q -d "$DB" -v ON_ERROR_STOP=1 -f "$HERE/00_shim_supabase.sql" >/dev/null 2>&1
for f in $(ls "$MIG"/*.sql | sort -V); do
  [ "$f" = "$LA160" ] && break
  if ! out="$(psql -q -d "$DB" -v ON_ERROR_STOP=1 -f "$f" 2>&1)"; then
    echo "$out" | grep -E "^psql:|ERROR" | head -3 | sed 's/^/      /'
    muori "$(basename "$f") non si applica nemmeno su un database vuoto"
  fi
done

echo "▶ ci metto dentro un ordine ANNULLATO"
if ! out="$(psql -q -d "$DB" -v ON_ERROR_STOP=1 -f "$HERE/seed-ordine-annullato.sql" 2>&1)"; then
  echo "$out" | grep -E "^psql:|ERROR" | head -5 | sed 's/^/      /'
  muori "non riesco a creare gli ordini di partenza"
fi

annullati="$(psql -tA -d "$DB" -c "SELECT count(*) FROM public.orders WHERE delivery_status = 'CANCELED'")"
if [ "${annullati:-0}" -lt 1 ]; then
  # Senza un ordine annullato dentro, questo controllo è verde per finta.
  muori "nessun ordine annullato in tabella: il controllo non proverebbe niente"
fi
echo "  ordini annullati in tabella: $annullati"

echo "▶ ① applico la 160"
if ! out="$(psql -q -d "$DB" -v ON_ERROR_STOP=1 -f "$LA160" 2>&1)"; then
  echo "$out" | grep -E "^psql:|ERROR|CONTEXT" | head -6 | sed 's/^/    /'
  echo ""
  echo "  In produzione questa migrazione non si applicherebbe. Se riscrive"
  echo "  righe esistenti su una colonna protetta le serve la chiave del"
  echo "  progetto: PERFORM set_config('mycity.allow_order_write','1',true)"
  echo "  dentro un blocco DO, come fanno la 094 e le RPC del backend."
  muori "la 160 si ferma su un database con dentro un ordine annullato"
fi
echo "  ok, si applica"

echo "▶ ② il riempimento ha toccato davvero la riga?"
riempiti="$(psql -tA -d "$DB" -c "SELECT count(*) FROM public.orders WHERE delivery_status='CANCELED' AND stock_restored_at IS NOT NULL")"
[ "${riempiti:-0}" -eq "$annullati" ] || muori "riempiti $riempiti ordini su $annullati: il passo ① era verde senza aver scritto niente"
echo "  ok, $riempiti su $annullati"

echo "▶ ③ due chiamate rimettono la merce a scaffale una volta sola"
prima="$(psql -tA -d "$DB" -c "SELECT stock FROM public.products WHERE id='b0000000-0000-0000-0000-0000000000a1'")"
psql -q -d "$DB" -v ON_ERROR_STOP=1 -c "SELECT public.restore_stock_for_order('a0000000-0000-0000-0000-0000000000c2');" >/dev/null 2>&1 \
  || muori "la prima chiamata a restore_stock_for_order si è fermata"
psql -q -d "$DB" -v ON_ERROR_STOP=1 -c "SELECT public.restore_stock_for_order('a0000000-0000-0000-0000-0000000000c2');" >/dev/null 2>&1 \
  || muori "la seconda chiamata a restore_stock_for_order si è fermata"
dopo="$(psql -tA -d "$DB" -c "SELECT stock FROM public.products WHERE id='b0000000-0000-0000-0000-0000000000a1'")"
atteso=$(( prima + 3 ))
[ "$dopo" = "$atteso" ] || muori "magazzino: partiva da $prima, doveva arrivare a $atteso, è arrivato a $dopo"
echo "  ok, da $prima a $dopo (non a $(( prima + 6 )))"

echo "✓ la 160 regge un ordine annullato e la merce torna a scaffale una volta sola"
pulisci
exit 0

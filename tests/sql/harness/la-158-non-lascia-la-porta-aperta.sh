#!/usr/bin/env bash
# =============================================================================
# La 158 non deve lasciare, in NESSUN momento, una porta aperta agli anonimi
# =============================================================================
# Uso:  tests/sql/harness/la-158-non-lascia-la-porta-aperta.sh [nome_database]
#
# IL BUCO CHE QUESTO CONTROLLO CHIUDE.
#
# La 158 crea `registra_spesa_ai`, che è SECURITY DEFINER: gira coi permessi di
# chi la possiede, non di chi la chiama. Postgres, su ogni funzione nuova, dà
# il permesso di eseguirla a PUBLIC — cioè anche ad `anon`, il visitatore senza
# account. Il permesso lo si toglie ventotto righe più in basso.
#
# Finché quelle due cose stanno in due transazioni diverse, fra l'una e l'altra
# c'è una finestra: se il collegamento cade lì in mezzo, resta committata una
# funzione che chiunque può chiamare dal browser. E quella funzione scrive il
# freno di spesa dell'AI: `anon` ci mette 99.999.999 centesimi e il modello si
# spegne per tutti. Rieseguire il file dopo chiude il permesso ma NON toglie i
# centesimi: il danno non torna indietro da solo.
#
# COSA FA QUESTO CONTROLLO. Non prova un'interruzione: le prova TUTTE. Taglia
# la migrazione alla fine di ogni istruzione, la applica troncata su una copia
# pulita del database, e a ogni taglio prova a chiamare la funzione come `anon`.
# Se una sola volta ci riesce, è rosso.
#
# Il database di partenza è fatto SENZA la 131, perché è così che è la
# produzione: lì la funzione non esiste ancora, e `CREATE OR REPLACE` su una
# funzione che non c'era nasce con i permessi aperti. Dove la 131 è già passata
# la finestra non si apre — ed è per questo che nessuno l'aveva vista.
# =============================================================================
set -uo pipefail

BASE="${1:-mycity_prova_158}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
MIG="$ROOT/migrations"
LA158="$MIG/158_il_conto_della_spesa_ai_esiste_anche_in_produzione.sql"
TMP="$(mktemp -d)"
COPIA="${BASE}_c"

pulisci() {
  psql -q -d postgres -c "DROP DATABASE IF EXISTS $COPIA WITH (FORCE);" >/dev/null 2>&1
  psql -q -d postgres -c "DROP DATABASE IF EXISTS $BASE WITH (FORCE);"  >/dev/null 2>&1
  rm -rf "$TMP"
}
muori() { echo "✗ $1"; pulisci; exit 1; }

[ -f "$LA158" ] || muori "non trovo $LA158"

echo "▶ ricostruisco $BASE come la produzione: senza la 131 e senza la 158"
psql -q -d postgres -c "DROP DATABASE IF EXISTS $BASE WITH (FORCE);" >/dev/null 2>&1
psql -q -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE $BASE;" >/dev/null || exit 1
psql -q -d "$BASE" -v ON_ERROR_STOP=1 -f "$HERE/00_shim_supabase.sql" >/dev/null 2>&1
for f in $(ls "$MIG"/*.sql | sort -V); do
  nome="$(basename "$f")"
  case "$nome" in 131_*|158_*|159_*|160_*) continue ;; esac
  if ! out="$(psql -q -d "$BASE" -v ON_ERROR_STOP=1 -f "$f" 2>&1)"; then
    echo "$out" | grep -E "^psql:|ERROR" | head -3 | sed 's/^/      /'
    muori "$nome non si applica nemmeno su un database vuoto"
  fi
done

gia="$(psql -tA -d "$BASE" -c "SELECT count(*) FROM pg_proc WHERE proname='registra_spesa_ai'")"
[ "${gia:-1}" -eq 0 ] || muori "la funzione c'è già: il database di partenza non somiglia alla produzione, il controllo non proverebbe niente"

# Fine di ogni istruzione: riga che chiude con ';' fuori dai blocchi $$ e che
# non è un commento. Si guardano solo le righe prima del COMMIT.
mapfile -t TAGLI < <(awk '
  { riga = $0 }
  riga ~ /^[[:space:]]*--/ { next }
  { n = gsub(/\$\$/, "&"); if (n % 2 == 1) dentro = !dentro }
  dentro == 0 && riga ~ /;[[:space:]]*$/ { print NR }
' "$LA158")

[ "${#TAGLI[@]}" -ge 5 ] || muori "trovati solo ${#TAGLI[@]} punti di taglio: il controllo non guarderebbe abbastanza"
echo "▶ provo ${#TAGLI[@]} interruzioni, una alla fine di ogni istruzione"

rossi=0
for riga in "${TAGLI[@]}"; do
  sed -n "1,${riga}p" "$LA158" > "$TMP/troncata.sql"
  psql -q -d postgres -c "DROP DATABASE IF EXISTS $COPIA WITH (FORCE);" >/dev/null 2>&1
  psql -q -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE $COPIA TEMPLATE $BASE;" >/dev/null || muori "non riesco a copiare $BASE"
  # L'interruzione: il file si ferma qui. Quello che era da salvare, è salvato.
  psql -q -d "$COPIA" -f "$TMP/troncata.sql" >/dev/null 2>&1

  # La prova vera non è leggere i permessi: è provarci come `anon`.
  psql -q -d "$COPIA" -c "SET ROLE anon; SELECT public.registra_spesa_ai(current_date, 99999999);" >/dev/null 2>&1
  entrato=$?
  sporco="$(psql -tA -d "$COPIA" -c "SELECT COALESCE(max(cents),0) FROM public.ai_spend_daily" 2>/dev/null || echo 0)"
  if [ "$entrato" -eq 0 ] || [ "${sporco:-0}" != "0" ]; then
    echo "  ✗ interrotta alla riga $riga → anon è entrato e ha scritto ${sporco} centesimi nel tetto di spesa"
    rossi=$((rossi + 1))
  fi
done
psql -q -d postgres -c "DROP DATABASE IF EXISTS $COPIA WITH (FORCE);" >/dev/null 2>&1

[ "$rossi" -eq 0 ] || muori "$rossi interruzioni su ${#TAGLI[@]} lasciano la porta aperta agli anonimi"
echo "  ok, nessuna delle ${#TAGLI[@]} interruzioni lascia entrare anon"

echo "▶ e applicata per intero deve funzionare davvero"
if ! out="$(psql -q -d "$BASE" -v ON_ERROR_STOP=1 -f "$LA158" 2>&1)"; then
  echo "$out" | grep -E "^psql:|ERROR" | head -4 | sed 's/^/    /'
  muori "la 158 non si applica"
fi
esiste="$(psql -tA -d "$BASE" -c "SELECT count(*) FROM pg_proc WHERE proname IN ('registra_spesa_ai','spesa_ai_di_oggi')")"
[ "${esiste:-0}" -eq 2 ] || muori "dopo l'applicazione le due funzioni non ci sono: il controllo di prima era verde per finta"
apertoAnon="$(psql -tA -d "$BASE" -c "SELECT has_function_privilege('anon','public.registra_spesa_ai(date,bigint)','EXECUTE')")"
[ "$apertoAnon" = "f" ] || muori "anon può ancora eseguire registra_spesa_ai"
apertoServizio="$(psql -tA -d "$BASE" -c "SELECT has_function_privilege('service_role','public.registra_spesa_ai(date,bigint)','EXECUTE')")"
[ "$apertoServizio" = "t" ] || muori "il service_role NON può eseguire registra_spesa_ai: la migrazione ha chiuso troppo"
echo "  ok: le due funzioni ci sono, anon fuori, service_role dentro"

echo "✓ la 158 è tutto-o-niente: nessuna interruzione lascia la porta aperta"
pulisci
exit 0

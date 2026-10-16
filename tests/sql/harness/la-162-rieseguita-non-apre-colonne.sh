#!/usr/bin/env bash
# =============================================================================
# Rieseguire la 162 non apre al browser nessuna colonna dei resi
# =============================================================================
# Uso:  tests/sql/harness/la-162-rieseguita-non-apre-colonne.sh [nome_database]
#
# IL BUCO CHE QUESTO CONTROLLO CHIUDE (riesame del 16/10/2026).
#
# La 162 toglie al browser il permesso di leggere l'IBAN dei resi e gli ridà
# le altre colonne una per una. La prima versione l'elenco lo CALCOLAVA al
# momento: «tutte le colonne di returns tranne refund_iban». Una colonna
# privata aggiunta ai resi dopo la 162 nasceva chiusa, come promette la
# migrazione — ma bastava rieseguire la 162 in un ripasso (il progetto l'ha
# gia' fatto una volta in produzione, dal 003 al 079 il 9 settembre) e il
# GRANT calcolato la apriva a negozio e cliente. Il controllo in fondo alla
# migrazione guardava solo l'IBAN e non se ne accorgeva.
#
# COSA PROVA.
#   ① Ricostruito il database, il browser non legge ne' l'IBAN ne' il nome
#      dell'intestatario (senza questo il resto sarebbe verde per finta).
#   ② Si aggiungono ai resi due colonne «di domani»: una privata (chiusa, come
#      nasce) e una che una migrazione successiva apre con un GRANT esplicito.
#   ③ Si riesegue la 162, due volte di fila: deve andare a buon fine.
#   ④ La privata resta chiusa. Quella aperta dopo si richiude: rieseguire la
#      162 chiude, non apre — il verso giusto in cui sbagliare, e chi rifa' un
#      ripasso riapplica anche le migrazioni dopo. L'IBAN resta chiuso.
# =============================================================================
set -uo pipefail

DB="${1:-mycity_prova_162}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
LA162="$(ls "$ROOT"/migrations/162_*.sql)"

butta_il_database() { psql -q -d postgres -c "DROP DATABASE IF EXISTS $DB WITH (FORCE);" >/dev/null 2>&1; }
muori() { echo "✗ $1"; butta_il_database; exit 1; }
legge() {
  psql -X -tA -d "$DB" -c "SELECT has_column_privilege('authenticated', 'public.returns', '$1', 'SELECT')"
}

echo "▶ ricostruisco $DB con tutte le migrazioni"
bash "$HERE/apply.sh" "$DB" >/dev/null || muori "il database non si ricostruisce"

echo "▶ ① dopo la ricostruzione"
[ "$(legge refund_iban)" = "f" ] || muori "il browser legge l'IBAN dei resi"
[ "$(legge refund_intestatario)" = "f" ] || muori "il browser legge il nome dell'intestatario"
[ "$(legge status)" = "t" ] || muori "il browser non legge lo stato dei resi: la prova sarebbe verde per finta"

echo "▶ ② due colonne di domani"
psql -X -q -d "$DB" -v ON_ERROR_STOP=1 -c "
  ALTER TABLE public.returns ADD COLUMN colonna_privata_di_domani text;
  ALTER TABLE public.returns ADD COLUMN colonna_aperta_dopo text;
  GRANT SELECT (colonna_aperta_dopo) ON public.returns TO authenticated;" >/dev/null || muori "colonne non aggiunte"
[ "$(legge colonna_privata_di_domani)" = "f" ] || muori "la colonna privata nasce gia' aperta: la prova non misura niente"
[ "$(legge colonna_aperta_dopo)" = "t" ] || muori "il GRANT esplicito non ha aperto la colonna: la prova non misura niente"

echo "▶ ③ riapplico la 162, due volte di fila"
for giro in 1 2; do
  if ! out="$(psql -X -q -d "$DB" -v ON_ERROR_STOP=1 -f "$LA162" 2>&1)"; then
    echo "$out" | grep -E "^psql:|ERROR" | head -3 | sed 's/^/    /'
    muori "la 162 non si riapplica (giro $giro)"
  fi
done

echo "▶ ④ dopo il ripasso"
privata="$(legge colonna_privata_di_domani)"
aperta="$(legge colonna_aperta_dopo)"
iban="$(legge refund_iban)"
echo "  colonna privata di domani: $privata · colonna aperta dopo: $aperta · IBAN: $iban"
[ "$privata" = "f" ] || muori "rieseguire la 162 apre al browser una colonna nata chiusa"
[ "$aperta" = "f" ] || muori "rieseguire la 162 lascia aperta una colonna fuori dal suo elenco"
[ "$iban" = "f" ] || muori "rieseguire la 162 apre l'IBAN"
[ "$(legge status)" = "t" ] || muori "dopo il ripasso il browser non legge piu' lo stato dei resi"

butta_il_database
echo "✓ rieseguire la 162 chiude, non apre"

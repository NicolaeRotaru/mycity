#!/usr/bin/env bash
# =============================================================================
# 27/11/2026 — La 999b: il giorno in cui SDG passa dal titolare, scelto nel link del preventivo.
# =============================================================================
# Uso:  tests/sql/harness/999b-il-giorno-della-visita-di-sdg.sh [nome_database]
#
# Nicola, 27/11 verso le 17:40: nel link il titolare sceglie anche giorno e ora in cui il team creativo
# di SDG passa da lui. COSA PROVA:
#   ① la 999b si applica su una tabella con un preventivo già dentro, si può rieseguire, e il blocco
#      REVERSIBILE gira;
#   ② la visita si salva sul preventivo insieme all'accettazione;
#   ③ un'altra attività alla stessa ora è rifiutata (indice unico); a un'ora diversa passa;
#      i preventivi senza visita (NULL) non si danno fastidio;
#   ④ dal browser nessuno legge le visite (la tabella resta del server, come nella 708).
# =============================================================================
set -uo pipefail

DB="${1:-mycity_prova_999b}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
LA999B="$ROOT/migrations/999b_il_giorno_della_visita_di_sdg.sql"

pulisci() { psql -q -d postgres -c "DROP DATABASE IF EXISTS $DB WITH (FORCE);" >/dev/null 2>&1; }
muori()   { echo "✗ $1"; pulisci; exit 1; }
sql()     { psql -q -X -t -A -d "$DB" -v ON_ERROR_STOP=1 -c "$1" 2>&1; }
rifiuta() { if out="$(sql "$1")"; then muori "$2 — doveva essere rifiutato, invece è passato"; fi; echo "$out" | grep -q "$3" || muori "$2 — rifiutato per il motivo sbagliato: $out"; }

[ -f "$LA999B" ] || muori "non trovo $LA999B"
bash "$HERE/apply.sh" "$DB" >/dev/null || muori "le migrazioni non si applicano"

UNO='99999999-0000-4000-8000-000000001001'
DUE='99999999-0000-4000-8000-000000001002'
TRE='99999999-0000-4000-8000-000000001003'
sql "INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
       ('$UNO', 'uno@test.it', '{\"role\":\"seller\"}'),
       ('$DUE', 'due@test.it', '{\"role\":\"seller\"}'),
       ('$TRE', 'tre@test.it', '{\"role\":\"seller\"}');" >/dev/null || muori "utenti non creati"

# ① Indietro col blocco REVERSIBILE, un preventivo col vecchio schema, poi di nuovo la 999b (due volte).
sql "DROP INDEX IF EXISTS public.preventivi_con_codice_una_visita_per_ora;
     ALTER TABLE public.preventivi_con_codice DROP COLUMN IF EXISTS visita_il;" >/dev/null || muori "il blocco REVERSIBILE della 999b non gira"
sql "INSERT INTO public.preventivi_con_codice (seller_id, codice) VALUES
       ('$UNO', repeat('a', 64)), ('$DUE', repeat('b', 64)), ('$TRE', repeat('c', 64));" >/dev/null || muori "preventivi col vecchio schema non scritti"
psql -q -X -d "$DB" -v ON_ERROR_STOP=1 -f "$LA999B" >/dev/null 2>&1 || muori "la 999b non si applica su una tabella con preventivi"
psql -q -X -d "$DB" -v ON_ERROR_STOP=1 -f "$LA999B" >/dev/null 2>&1 || muori "la 999b non si può rieseguire"
[ "$(sql "SELECT count(*) FROM public.preventivi_con_codice WHERE visita_il IS NULL AND seller_id IN ('$UNO', '$DUE', '$TRE');")" = "3" ] || muori "i preventivi di prima non hanno la visita vuota"
echo "✓ ① si applica su una tabella piena, si può rieseguire, il blocco REVERSIBILE gira"

# ② La visita si salva con l'accettazione (come fa lib/agenzia/preventivo-col-codice.ts).
sql "UPDATE public.preventivi_con_codice SET stato = 'accettato', fascia_scelta = 'business', accettato_il = now(),
       condizioni_accettate_il = now(), visita_il = '2026-12-03T10:00:00+01:00'
     WHERE codice = repeat('a', 64) AND stato = 'aperto';" >/dev/null || muori "la visita non si salva con l'accettazione"
[ "$(sql "SELECT to_char(visita_il AT TIME ZONE 'Europe/Rome', 'YYYY-MM-DD HH24:MI') FROM public.preventivi_con_codice WHERE seller_id = '$UNO';")" = "2026-12-03 10:00" ] \
  || muori "la visita salvata non è giovedì 3 dicembre alle 10:00 di Piacenza"
echo "✓ ② la visita si salva sul preventivo"

# ③ Una sola attività per ora.
rifiuta "UPDATE public.preventivi_con_codice SET visita_il = '2026-12-03T09:00:00Z' WHERE seller_id = '$DUE';" \
  "una seconda attività alla stessa ora" "preventivi_con_codice_una_visita_per_ora"
sql "UPDATE public.preventivi_con_codice SET visita_il = '2026-12-03T14:00:00Z' WHERE seller_id = '$DUE';" >/dev/null || muori "un'altra ora dello stesso giorno è stata rifiutata"
[ "$(sql "SELECT count(*) FROM public.preventivi_con_codice WHERE visita_il IS NULL AND seller_id IN ('$UNO', '$DUE', '$TRE');")" = "1" ] || muori "il preventivo senza visita non è rimasto com'era"
echo "✓ ③ due attività non prendono la stessa ora; ore diverse e preventivi senza visita passano"

# ④ Dal browser nessuno legge le visite.
out="$(psql -q -X -t -A -d "$DB" -v ON_ERROR_STOP=1 2>&1 <<SQL
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"$UNO","role":"authenticated"}', true);
SELECT visita_il FROM public.preventivi_con_codice;
COMMIT;
SQL
)" && muori "dal browser si leggono le visite"
echo "$out" | grep -qi "permission denied\|permesso" || muori "rifiutato per il motivo sbagliato: $out"
echo "✓ ④ dal browser le visite non si leggono"

pulisci
echo "✓ la 999b regge"

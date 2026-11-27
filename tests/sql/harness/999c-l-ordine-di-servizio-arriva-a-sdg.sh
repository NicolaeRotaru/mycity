#!/usr/bin/env bash
# =============================================================================
# 27/11/2026 — La 999c: l'ordine di servizio arriva a SDG quando il titolare conferma.
# =============================================================================
# Uso:  tests/sql/harness/999c-l-ordine-di-servizio-arriva-a-sdg.sh [nome_database]
#
# COSA PROVA:
#   ① la 999c si applica su un database pieno (con un preventivo già scritto) e si può rieseguire;
#      il blocco REVERSIBILE gira e dopo si riapplica;
#   ② un'attività ha UN ordine solo: il secondo è rifiutato (chiave unica su seller_id), anche con
#      l'«ON CONFLICT DO NOTHING» che usa il sito non nasce un doppione;
#   ③ le forme sbagliate sono rifiutate: fascia che non esiste, piano dell'AD non pronto, «in corso»
#      senza il lavoro, email dell'agente con le maiuscole;
#   ④ chi legge: l'admin sì, l'account di SDG sì; il titolare (anche entrato), un altro negozio e un
#      visitatore senza accesso no;
#   ⑤ chi scrive: nessuno dal browser, nemmeno l'admin o SDG; e le colonne nuove di
#      preventivi_con_codice restano chiuse ai browser come la tabella (708).
# =============================================================================
set -uo pipefail

DB="${1:-mycity_prova_999c}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
LA999C="$ROOT/migrations/999c_l_ordine_di_servizio_arriva_a_sdg.sql"

pulisci() { psql -q -d postgres -c "DROP DATABASE IF EXISTS $DB WITH (FORCE);" >/dev/null 2>&1; }
muori()   { echo "✗ $1"; pulisci; exit 1; }
sql()     { psql -q -X -t -A -d "$DB" -v ON_ERROR_STOP=1 -c "$1" 2>&1; }
rifiuta() { if out="$(sql "$1")"; then muori "$2 — doveva essere rifiutato, invece è passato"; fi; echo "$out" | grep -q "$3" || muori "$2 — rifiutato per il motivo sbagliato: $out"; }
# Come un browser: ruolo authenticated (o anon) con l'identità data.
come()    { psql -q -X -t -A -d "$DB" -v ON_ERROR_STOP=1 2>&1 <<SQL
BEGIN;
SET LOCAL ROLE $1;
SELECT set_config('request.jwt.claims', '{"sub":"$2","role":"$1"}', true);
$3
COMMIT;
SQL
}

[ -f "$LA999C" ] || muori "non trovo $LA999C"
bash "$HERE/apply.sh" "$DB" >/dev/null || muori "le migrazioni non si applicano"

SDG='11111111-1111-1111-1111-5d9000000001'
TITOLARE='99999999-0000-4000-8000-0000000000c1'
ALTRO='99999999-0000-4000-8000-0000000000c2'
ADMIN='99999999-0000-4000-8000-0000000000c3'
CODICE="$(printf 'c%.0s' $(seq 1 64))"
PIANO='{"origine":"sito","contenuti":[]}'

sql "INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
       ('$TITOLARE', 'titolare@test.it', '{\"role\":\"seller\"}'),
       ('$ALTRO', 'altro@test.it', '{\"role\":\"seller\"}'),
       ('$ADMIN', 'nicola@test.it', '{\"role\":\"buyer\"}');" >/dev/null || muori "utenti non creati"
sql "SET mycity.allow_profile_write = '1';
     UPDATE public.profiles SET store_name = 'Caffè di Prova' WHERE id = '$TITOLARE';
     UPDATE public.profiles SET role = 'admin' WHERE id = '$ADMIN';" >/dev/null || muori "profili non preparati"
[ "$(sql "SELECT count(*) FROM public.profiles WHERE id = '$SDG';")" = "1" ] || muori "il profilo di SDG (707) non c'è"

# ① Un preventivo già scritto, indietro col REVERSIBILE, avanti di nuovo (due volte).
sql "INSERT INTO public.preventivi_con_codice (seller_id, codice, stato, fascia_scelta) VALUES ('$TITOLARE', '$CODICE', 'aperto', 'business');" >/dev/null || muori "preventivo non scritto"
sql "DROP TABLE IF EXISTS public.ordini_sdg;
     DROP INDEX IF EXISTS public.preventivi_con_codice_agente_email;
     DROP INDEX IF EXISTS public.preventivi_con_codice_lavoro;
     ALTER TABLE public.preventivi_con_codice DROP CONSTRAINT IF EXISTS preventivi_con_codice_agente_email_forma;
     ALTER TABLE public.preventivi_con_codice DROP COLUMN IF EXISTS agente_email;
     ALTER TABLE public.preventivi_con_codice DROP COLUMN IF EXISTS lavoro;" >/dev/null || muori "il blocco REVERSIBILE della 999c non gira"
psql -q -X -d "$DB" -v ON_ERROR_STOP=1 -f "$LA999C" >/dev/null 2>&1 || muori "la 999c non si applica su un database con un preventivo"
psql -q -X -d "$DB" -v ON_ERROR_STOP=1 -f "$LA999C" >/dev/null 2>&1 || muori "la 999c non si può rieseguire"
[ "$(sql "SELECT fascia_scelta FROM public.preventivi_con_codice WHERE seller_id = '$TITOLARE';")" = "business" ] || muori "il preventivo di prima è cambiato"
sql "UPDATE public.preventivi_con_codice SET lavoro = '11111111-2222-4333-8444-555555555555', agente_email = 'agente@test.it' WHERE seller_id = '$TITOLARE';" >/dev/null || muori "agente e lavoro non si scrivono sul preventivo"
echo "✓ ① si applica su un database pieno, si può rieseguire, il blocco REVERSIBILE gira"

# ② Un ordine solo per attività.
sql "INSERT INTO public.ordini_sdg (seller_id, nome_attivita, fascia, canone_centesimi, agente_email, piano)
     VALUES ('$TITOLARE', 'Caffè di Prova', 'business', 50000, 'agente@test.it', '$PIANO');" >/dev/null || muori "il primo ordine non si scrive"
rifiuta "INSERT INTO public.ordini_sdg (seller_id, nome_attivita, fascia, piano) VALUES ('$TITOLARE', 'Caffè di Prova', 'premium', '$PIANO');" \
  "un secondo ordine per la stessa attività" "ordini_sdg_seller_id_key"
sql "INSERT INTO public.ordini_sdg (seller_id, nome_attivita, fascia, piano) VALUES ('$TITOLARE', 'Caffè di Prova', 'premium', '$PIANO') ON CONFLICT (seller_id) DO NOTHING;" >/dev/null || muori "ON CONFLICT DO NOTHING si rompe"
[ "$(sql "SELECT count(*) || ':' || max(fascia) FROM public.ordini_sdg WHERE seller_id = '$TITOLARE';")" = "1:business" ] || muori "è nato un doppione, o il secondo ha cambiato il primo"
echo "✓ ② un ordine solo per attività, anche se l'accettazione si ripete"

# ③ Le forme sbagliate.
rifiuta "INSERT INTO public.ordini_sdg (seller_id, nome_attivita, fascia, piano) VALUES ('$ALTRO', 'Altro', 'oro', '$PIANO');" "una fascia che non esiste" "ordini_sdg_fascia_check"
rifiuta "INSERT INTO public.ordini_sdg (seller_id, nome_attivita, fascia, piano, piano_origine) VALUES ('$ALTRO', 'Altro', 'base', '$PIANO', 'ad');" "il piano dell'AD senza che sia pronto" "ordini_sdg_piano_ad_solo_pronto"
rifiuta "INSERT INTO public.ordini_sdg (seller_id, nome_attivita, fascia, piano, piano_completo_stato) VALUES ('$ALTRO', 'Altro', 'base', '$PIANO', 'in_corso');" "«in corso» senza il lavoro" "ordini_sdg_in_corso_col_lavoro"
rifiuta "INSERT INTO public.ordini_sdg (seller_id, nome_attivita, fascia, piano, agente_email) VALUES ('$ALTRO', 'Altro', 'base', '$PIANO', 'Agente@Test.it');" "l'email dell'agente con le maiuscole" "ordini_sdg_agente_email_check"
rifiuta "UPDATE public.preventivi_con_codice SET agente_email = 'Agente@Test.it' WHERE seller_id = '$TITOLARE';" "l'email dell'agente con le maiuscole sul preventivo" "preventivi_con_codice_agente_email_forma"
echo "✓ ③ fascia, piano dell'AD, lavoro e email sbagliati sono rifiutati"

# ④ Chi legge.
[ "$(come authenticated "$ADMIN" "SELECT count(*) FROM public.ordini_sdg;" | tail -n +2 | head -1)" = "1" ] || muori "l'admin non legge l'ordine"
[ "$(come authenticated "$SDG" "SELECT count(*) FROM public.ordini_sdg;" | tail -n +2 | head -1)" = "1" ] || muori "l'account di SDG non legge l'ordine"
[ "$(come authenticated "$TITOLARE" "SELECT count(*) FROM public.ordini_sdg;" | tail -n +2 | head -1)" = "0" ] || muori "il titolare legge l'ordine di SDG"
[ "$(come authenticated "$ALTRO" "SELECT count(*) FROM public.ordini_sdg;" | tail -n +2 | head -1)" = "0" ] || muori "un altro negozio legge l'ordine di SDG"
out="$(come anon "00000000-0000-0000-0000-000000000000" "SELECT count(*) FROM public.ordini_sdg;")" && muori "un visitatore senza accesso legge l'ordine: $out"
echo "$out" | grep -qi "permission denied" || muori "il visitatore è fermato per il motivo sbagliato: $out"
echo "✓ ④ leggono l'admin e SDG; il titolare, un altro negozio e un visitatore no"

# ⑤ Chi scrive: nessuno dal browser.
for chi in "$ADMIN" "$SDG" "$TITOLARE"; do
  out="$(come authenticated "$chi" "UPDATE public.ordini_sdg SET fascia = 'premium';")" && muori "$chi ha cambiato l'ordine dal browser"
  echo "$out" | grep -qi "permission denied" || muori "la modifica di $chi è fermata per il motivo sbagliato: $out"
  out="$(come authenticated "$chi" "INSERT INTO public.ordini_sdg (seller_id, nome_attivita, fascia, piano) VALUES ('$ALTRO', 'X', 'base', '{}');")" && muori "$chi ha scritto un ordine dal browser"
  echo "$out" | grep -qi "permission denied" || muori "l'inserimento di $chi è fermato per il motivo sbagliato: $out"
done
for chi in "$ADMIN" "$TITOLARE"; do
  out="$(come authenticated "$chi" "SELECT agente_email, lavoro FROM public.preventivi_con_codice;")" && muori "$chi legge agente e lavoro del preventivo dal browser"
  echo "$out" | grep -qi "permission denied" || muori "la lettura del preventivo di $chi è fermata per il motivo sbagliato: $out"
done
echo "✓ ⑤ dal browser nessuno scrive l'ordine; agente e lavoro del preventivo restano solo del server"

pulisci
echo "✓ la 999c regge"

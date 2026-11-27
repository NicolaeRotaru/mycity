#!/usr/bin/env bash
# =============================================================================
# 27/11/2026 — La 999: l'abbonamento in contanti sblocca la pagina del negozio.
# =============================================================================
# Uso:  tests/sql/harness/999-l-abbonamento-in-contanti.sh [nome_database]
#
# Nicola, 27/11 02:26: l'agente sceglie l'abbonamento detto dal titolare e la pagina del negozio si sblocca
# da sola in quella fascia, subito e fino alla disdetta. COSA PROVA:
#   ① la 999 si applica su una tabella che ha già un abbonamento Stripe (lo si toglie col blocco
#      REVERSIBILE, si scrive la riga Stripe col vecchio schema, si riapplica): la riga resta valida e
#      diventa `origine = 'stripe'`. E si può rieseguire;
#   ② una riga in contanti, attiva, senza niente di Stripe, si scrive; e un negozio approvato con quella
#      riga è in vetrina (`negozio_in_vetrina` della 709, senza toccarla), prima no;
#   ③ un secondo abbonamento in contanti in corso per lo stesso negozio è rifiutato (indice unico);
#      uno fermato (`canceled`) non conta;
#   ④ una riga Stripe senza il suo id, o una in contanti con un id Stripe, sono rifiutate;
#   ⑤ il negozio dal browser non può scriversi un abbonamento in contanti da solo.
# =============================================================================
set -uo pipefail

DB="${1:-mycity_prova_999}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
LA999="$ROOT/migrations/999_l_abbonamento_in_contanti.sql"

pulisci() { psql -q -d postgres -c "DROP DATABASE IF EXISTS $DB WITH (FORCE);" >/dev/null 2>&1; }
muori()   { echo "✗ $1"; pulisci; exit 1; }
sql()     { psql -q -X -t -A -d "$DB" -v ON_ERROR_STOP=1 -c "$1" 2>&1; }
rifiuta() { if out="$(sql "$1")"; then muori "$2 — doveva essere rifiutato, invece è passato"; fi; echo "$out" | grep -q "$3" || muori "$2 — rifiutato per il motivo sbagliato: $out"; }

[ -f "$LA999" ] || muori "non trovo $LA999"
bash "$HERE/apply.sh" "$DB" >/dev/null || muori "le migrazioni non si applicano"

NEGOZIO='99999999-0000-4000-8000-000000000001'
ALTRO='99999999-0000-4000-8000-000000000002'
sql "INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
       ('$NEGOZIO', 'tropico@test.it', '{\"role\":\"seller\"}'),
       ('$ALTRO', 'altro@test.it', '{\"role\":\"seller\"}');" >/dev/null || muori "utenti non creati"
sql "SET mycity.allow_profile_write = '1'; UPDATE public.profiles SET is_approved = true, approval_status = 'approved', store_name = 'El Tropico Latino' WHERE id IN ('$NEGOZIO', '$ALTRO');" >/dev/null || muori "profili non preparati"

# ① Indietro col blocco REVERSIBILE, una riga Stripe col vecchio schema, poi di nuovo la 999 (due volte).
sql "DELETE FROM public.abbonamenti_servizi WHERE origine = 'contanti';
     DROP INDEX IF EXISTS public.abbonamenti_servizi_un_contanti_in_corso;
     ALTER TABLE public.abbonamenti_servizi DROP CONSTRAINT IF EXISTS abbonamenti_servizi_contanti_senza_stripe;
     ALTER TABLE public.abbonamenti_servizi DROP CONSTRAINT IF EXISTS abbonamenti_servizi_stripe_col_suo_id;
     ALTER TABLE public.abbonamenti_servizi DROP CONSTRAINT IF EXISTS abbonamenti_servizi_origine_valida;
     ALTER TABLE public.abbonamenti_servizi ALTER COLUMN stripe_subscription_id SET NOT NULL;
     ALTER TABLE public.abbonamenti_servizi DROP COLUMN IF EXISTS origine;" >/dev/null || muori "il blocco REVERSIBILE della 999 non gira"
sql "INSERT INTO public.abbonamenti_servizi (seller_id, fascia, canone_centesimi, stripe_subscription_id, stato)
     VALUES ('$ALTRO', 'base', 30000, 'sub_vecchio', 'active');" >/dev/null || muori "riga Stripe col vecchio schema non scritta"
psql -q -X -d "$DB" -v ON_ERROR_STOP=1 -f "$LA999" >/dev/null 2>&1 || muori "la 999 non si applica su una tabella con un abbonamento Stripe"
psql -q -X -d "$DB" -v ON_ERROR_STOP=1 -f "$LA999" >/dev/null 2>&1 || muori "la 999 non si può rieseguire"
[ "$(sql "SELECT origine FROM public.abbonamenti_servizi WHERE stripe_subscription_id = 'sub_vecchio';")" = "stripe" ] || muori "la riga Stripe di prima non è diventata origine = stripe"
echo "✓ ① si applica su una tabella piena, si può rieseguire, il blocco REVERSIBILE gira"

# ② La riga in contanti si scrive, e apre la vetrina del negozio approvato.
[ "$(sql "SELECT public.negozio_in_vetrina('$NEGOZIO');")" = "f" ] || muori "il negozio senza abbonamento era già in vetrina"
sql "INSERT INTO public.abbonamenti_servizi (seller_id, fascia, canone_centesimi, origine, stato)
     VALUES ('$NEGOZIO', 'premium', 99900, 'contanti', 'active');" >/dev/null || muori "la riga in contanti non si scrive"
[ "$(sql "SELECT public.negozio_in_vetrina('$NEGOZIO');")" = "t" ] || muori "l'abbonamento in contanti non apre la vetrina"
echo "✓ ② l'abbonamento in contanti si scrive e sblocca la vetrina del negozio approvato"

# ③ Uno solo in corso per negozio; uno fermato non conta.
rifiuta "INSERT INTO public.abbonamenti_servizi (seller_id, fascia, canone_centesimi, origine, stato) VALUES ('$NEGOZIO', 'base', 30000, 'contanti', 'active');" \
  "un secondo abbonamento in contanti in corso" "abbonamenti_servizi_un_contanti_in_corso"
sql "UPDATE public.abbonamenti_servizi SET stato = 'canceled' WHERE seller_id = '$NEGOZIO' AND origine = 'contanti';" >/dev/null || muori "non si ferma"
[ "$(sql "SELECT public.negozio_in_vetrina('$NEGOZIO');")" = "f" ] || muori "fermato, il negozio è ancora in vetrina"
sql "INSERT INTO public.abbonamenti_servizi (seller_id, fascia, canone_centesimi, origine, stato) VALUES ('$NEGOZIO', 'base', 30000, 'contanti', 'active');" >/dev/null || muori "dopo averlo fermato non se ne apre uno nuovo"
[ "$(sql "SELECT count(*) FROM public.abbonamenti_servizi WHERE seller_id = '$NEGOZIO';")" = "2" ] || muori "la riga fermata è sparita (si archivia, non si cancella)"
echo "✓ ③ un solo abbonamento in contanti in corso per negozio; fermato, la vetrina si chiude e la riga resta"

# ④ Le due forme sbagliate.
rifiuta "INSERT INTO public.abbonamenti_servizi (seller_id, fascia, canone_centesimi, stato) VALUES ('$ALTRO', 'base', 30000, 'active');" \
  "una riga Stripe senza il suo id" "abbonamenti_servizi_stripe_col_suo_id"
rifiuta "INSERT INTO public.abbonamenti_servizi (seller_id, fascia, canone_centesimi, origine, stripe_subscription_id, stato) VALUES ('$ALTRO', 'base', 30000, 'contanti', 'sub_x', 'canceled');" \
  "una riga in contanti con un id Stripe" "abbonamenti_servizi_contanti_senza_stripe"
rifiuta "INSERT INTO public.abbonamenti_servizi (seller_id, fascia, canone_centesimi, origine, stato) VALUES ('$ALTRO', 'base', 30000, 'regalo', 'canceled');" \
  "un'origine che non esiste" "abbonamenti_servizi_origine_valida"
echo "✓ ④ le righe Stripe senza id e quelle in contanti con un id Stripe sono rifiutate"

# ⑤ Dal browser il negozio non si scrive l'abbonamento da solo.
out="$(psql -q -X -t -A -d "$DB" -v ON_ERROR_STOP=1 2>&1 <<SQL
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"$ALTRO","role":"authenticated"}', true);
INSERT INTO public.abbonamenti_servizi (seller_id, fascia, canone_centesimi, origine, stato) VALUES ('$ALTRO', 'premium', 99900, 'contanti', 'active');
COMMIT;
SQL
)" && muori "il negozio si è scritto da solo un abbonamento in contanti"
echo "$out" | grep -qi "permission denied\|permesso" || muori "rifiutato per il motivo sbagliato: $out"
echo "✓ ⑤ il negozio dal browser non si scrive l'abbonamento"

pulisci
echo "✓ la 999 regge"

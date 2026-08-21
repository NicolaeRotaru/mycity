#!/usr/bin/env bash
# =============================================================================
# Avvia un Supabase locale, ci applica le migrazioni, e stampa le sue chiavi
# =============================================================================
# Uso:  tests/supabase-locale/avvia.sh
#
# Scrive su $GITHUB_ENV (in CI) le tre variabili che le prove cercano:
#   NEXT_PUBLIC_SUPABASE_URL · NEXT_PUBLIC_SUPABASE_ANON_KEY · SUPABASE_SERVICE_ROLE_KEY
# Fuori dalla CI le stampa e basta, cosi' si possono esportare a mano.
#
# PERCHE' NON I SEGRETI DI UN PROGETTO COMPRATO. Vedi supabase/config.toml: un
# progetto di prova costa 10 dollari al mese e vuole tre segreti custoditi per
# sempre, chiave di servizio compresa. Questo nasce e muore dentro il giro.
#
# ⚠️ Le chiavi che stampa NON sono segrete: sono le chiavi fisse dello stack
# locale di Supabase, uguali su tutte le macchine del mondo, firmate con un
# segreto pubblico e valide solo verso 127.0.0.1. Non vanno confuse con quelle
# vere e non vanno messe in nessun segreto di GitHub.
#
# Esce con codice diverso da zero se qualcosa non parte: un ambiente di prova
# che non si alza e' un difetto, non un motivo per saltare le prove.
# =============================================================================
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
MIG="$ROOT/migrations"

DB_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"

echo "▶ avvio Supabase locale"
npx --yes supabase@2 start --workdir "$ROOT"

echo "▶ applico le migrazioni ($(ls "$MIG"/*.sql | wc -l | tr -d ' ') file)"
applicate=0
for f in $(ls "$MIG"/*.sql | sort -V); do
  if ! out="$(psql -q -d "$DB_URL" -v ON_ERROR_STOP=1 -f "$f" 2>&1)"; then
    echo "  ✗ $(basename "$f")"
    echo "$out" | grep -E "^psql:|ERROR" | head -4 | sed 's/^/      /'
    exit 1
  fi
  applicate=$((applicate + 1))
done
echo "  applicate $applicate"

# Senza dati dentro non si prova niente di quello che conta: un estraneo che
# non legge una tabella vuota non dimostra che la tabella e' protetta.
echo "▶ ci metto dentro un negozio e un ordine veri"
psql -q -d "$DB_URL" -v ON_ERROR_STOP=1 -f "$ROOT/tests/sql/harness/seed-ordine-vero.sql" >/dev/null

echo "▶ leggo le chiavi locali"
# `status -o env` stampa righe NOME="valore": e' il formato pensato per questo.
stato="$(npx --yes supabase@2 status --workdir "$ROOT" -o env)"

leggi() { echo "$stato" | grep "^$1=" | cut -d= -f2- | tr -d '"'; }

URL="$(leggi API_URL)"
ANON="$(leggi ANON_KEY)"
SR="$(leggi SERVICE_ROLE_KEY)"

if [ -z "$URL" ] || [ -z "$ANON" ] || [ -z "$SR" ]; then
  echo "✗ Supabase e' partito ma non ho letto le sue chiavi. Senza, le prove"
  echo "  si salterebbero di nuovo — ed e' proprio quello che questo pezzo"
  echo "  doveva togliere di mezzo."
  echo "$stato" | sed 's/^/    /'
  exit 1
fi

if [ -n "${GITHUB_ENV:-}" ]; then
  {
    echo "NEXT_PUBLIC_SUPABASE_URL=$URL"
    echo "NEXT_PUBLIC_SUPABASE_ANON_KEY=$ANON"
    echo "SUPABASE_SERVICE_ROLE_KEY=$SR"
  } >> "$GITHUB_ENV"
  echo "✓ Supabase locale pronto su $URL — chiavi passate al giro"
else
  echo "✓ Supabase locale pronto. Da esportare a mano:"
  echo "  export NEXT_PUBLIC_SUPABASE_URL=$URL"
  echo "  export NEXT_PUBLIC_SUPABASE_ANON_KEY=$ANON"
  echo "  export SUPABASE_SERVICE_ROLE_KEY=$SR"
fi

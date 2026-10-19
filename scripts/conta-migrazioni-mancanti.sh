#!/usr/bin/env bash
# =============================================================================
# Conta, SENZA SCRIVERE, le migrazioni che mancano al database e le confronta
# con quelle che chi avvia si aspetta.
# =============================================================================
# Uso:  SUPABASE_DB_URL=... QUANTE=48 ULTIMA=163 bash scripts/conta-migrazioni-mancanti.sh
#
# Esce 0 solo se ne mancano esattamente QUANTE e se l'ultima dell'elenco e' la
# ULTIMA (il numero davanti al nome del file). Il numero da solo non basta: il
# collaudo del 19/10 ha mostrato che 47 attese piu' una sconosciuta fanno 48
# lo stesso. Con l'ultima si vede anche una migrazione unita dopo il conto.
#
# Come conta: lancia scripts/applica-migrazioni-mancanti.sh col tetto 0. Lo
# script legge il registro, e se manca anche una sola migrazione si ferma
# PRIMA di applicarla (uscita 4) ed elenca quelle che mancano. Prima del tetto
# esegue solo «CREATE ... IF NOT EXISTS» sullo schema del registro, che su un
# database che il registro ce l'ha non tocca niente.
#
# Lo usa .github/workflows/migrazioni-a-mano.yml due volte: nel lavoro che
# conta e, subito prima di scrivere, nel lavoro che applica. Esce 1 in ogni
# caso in cui non va avanti.
# =============================================================================
set -uo pipefail

QUANTE="${QUANTE:-}"
ULTIMA="${ULTIMA:-}"

case "$QUANTE" in
  ''|*[!0-9]*)
    echo "::error::In «quante» va un numero intero (il 19/10: 48). Non ho contato niente."
    exit 1
    ;;
esac
case "$ULTIMA" in
  [0-9][0-9][0-9]|[0-9][0-9][0-9][a-z]) ;;
  *)
    echo "::error::In «ultima» va il numero dell'ultima migrazione attesa, tre cifre (il 19/10: 163). Non ho contato niente."
    exit 1
    ;;
esac

ELENCO="$(mktemp)"
USCITA=0
MASSIMO_MIGRAZIONI=0 bash scripts/applica-migrazioni-mancanti.sh > /dev/null 2> "$ELENCO" || USCITA=$?
if [ "$USCITA" != "0" ] && [ "$USCITA" != "4" ]; then
  cat "$ELENCO" >&2
  # Il motivo anche nel riepilogo, dove guarda chi ha avviato. Lo script
  # ripulisce gia' la password dall'errore di collegamento; per prudenza qui
  # non passa nessuna riga con un indirizzo dentro.
  {
    echo "## Il conto non e' partito (uscita $USCITA)"
    echo ""
    grep -v -e '://' -e '@' "$ELENCO" | tail -n 8 | sed 's/^/    /'
  } >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
  echo "::error::Lo script delle migrazioni si e' fermato prima del conto (uscita $USCITA): non ho applicato niente."
  exit 1
fi

FILE=()
while IFS= read -r riga; do
  FILE+=("${riga#    - }")
done < <(grep -E '^    - .+\.sql$' "$ELENCO" || true)
N="${#FILE[@]}"

# L'uscita 4 vuol dire «ne mancano piu' del tetto 0», cioe' almeno una: se
# l'elenco letto e' vuoto, e' cambiato il modo in cui lo script lo scrive.
if [ "$USCITA" = "4" ] && [ "$N" = "0" ]; then
  cat "$ELENCO" >&2
  echo "::error::Lo script dice che manca qualcosa, ma non sono riuscito a leggere l'elenco: non tocco il database."
  exit 1
fi

{
  echo "## Migrazioni che mancano: $N (attese: $QUANTE, l'ultima: $ULTIMA)"
  echo ""
  for f in ${FILE[@]+"${FILE[@]}"}; do echo "- $f"; done
} >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
for f in ${FILE[@]+"${FILE[@]}"}; do echo "  - $f"; done

if [ "$N" != "$QUANTE" ]; then
  echo "::error::Ne mancano $N, ma ne aspettavi $QUANTE: non tocco il database. L'elenco e' qui sopra."
  exit 1
fi
if [ "$N" -gt 0 ] && [[ "${FILE[$((N - 1))]}" != "${ULTIMA}_"* ]]; then
  echo "::error::L'ultima che manca e' ${FILE[$((N - 1))]}, ma ne aspettavi la $ULTIMA: non tocco il database. Una migrazione oltre quella attesa va guardata prima."
  exit 1
fi
echo "Il conto torna: ne mancano $N, l'ultima e' la $ULTIMA."

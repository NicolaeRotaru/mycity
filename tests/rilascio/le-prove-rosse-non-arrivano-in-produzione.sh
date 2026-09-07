#!/usr/bin/env bash
# =============================================================================
# Un test rosso non deve poter essere pubblicato
# =============================================================================
# Uso:  tests/rilascio/le-prove-rosse-non-arrivano-in-produzione.sh
#       (nessuna dipendenza: gira ovunque ci sia bash e node)
#
# IL DIFETTO CHE QUESTO CONTROLLO TIENE CHIUSO (bloccante «Ogni unione su main
# pubblica in produzione senza aspettare la CI», misurato il 7/9/2026).
#
# Vercel pubblica in produzione a ogni unione su `main` — `vercel.json` dice
# `"deploymentEnabled": {"main": true}` — e non aspetta i controlli. Il lavoro
# «Rilascio dopo CI verde», che dovrebbe essere il cancello, e' inerte: senza i
# tre segreti VERCEL_* ogni suo passo viene saltato. Provato dal vivo: sulle
# unioni delle 18:22 e 18:26 del 7/9 (esecuzioni 29 e 30) tutti i passi di
# rilascio risultano `skipped` e il verdetto `failure`, mentre Vercel pubblicava
# per conto suo.
#
# QUANTO E' LARGO IL BUCO, misurato e non stimato. Vercel esegue `next build`, e
# `next.config.js` non spegne ne' il controllo dei tipi ne' eslint: quelli un
# errore lo prendono gia'. Quello che NON gira prima della pubblicazione sono le
# PROVE (`vitest run`). Cioe': oggi un errore di tipo si ferma da solo, un test
# rosso arriva ai clienti.
#
# LA RIPARAZIONE. `vercel.json` ora dichiara
#   "buildCommand": "npm run verify && next build"
# cosi' il cancello sta DENTRO il build, dove non servono segreti: se
# typecheck, lint o prove falliscono, `next build` non parte nemmeno e Vercel
# non ha niente da pubblicare.
#
# COSA FA QUESTO CONTROLLO. Legge il comando VERO da `vercel.json` — non una sua
# copia, che potrebbe scollegarsi — e lo esegue in una sabbia con `npm` e `next`
# finti. Poi guarda il comportamento, non il testo:
#   ① prove rosse  -> il comando esce != 0 E `next build` NON e' stato chiamato
#   ② prove verdi  -> il comando esce 0 E `next build` E' stato chiamato
# Senza `buildCommand` in `vercel.json` il controllo e' rosso al primo passo.
#
# ⚠️ QUELLO CHE QUESTO CONTROLLO NON PRENDE, detto qui perche' il resto
# prometterebbe piu' di quanto provi. Prova la CATENA del comando, con eseguibili
# finti. NON prova che sul costruttore vero di Vercel `npm run verify` riesca a
# girare (dipendenze di sviluppo installate, memoria, tempo massimo). Quella e'
# un'osservazione che si fa sul rilascio vero: la prima anteprima costruita dopo
# questa modifica e' la prova, e se fallisce si vede prima dell'unione.
# =============================================================================
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"

fallito=0
rosso() { echo "  ✗ $1"; fallito=1; }
verde() { echo "  ✓ $1"; }

# ── il comando vero, letto dal file vero ────────────────────────────────────
# Si legge con python3 e non con node di proposito: questo controllo gira nella
# CI PRIMA del passo che installa Node, e un controllo che dipende dall'ordine
# dei passi si spegne il giorno in cui qualcuno li riordina.
COMANDO="$(python3 -c '
import json, sys
print(json.load(open(sys.argv[1])).get("buildCommand", ""), end="")
' "$ROOT/vercel.json")"

if [ -z "$COMANDO" ]; then
  echo "❌ vercel.json non dichiara buildCommand: il cancello non esiste."
  echo "   Senza di esso Vercel esegue solo «next build», che non fa girare le prove:"
  echo "   un test rosso viene pubblicato."
  exit 1
fi
verde "vercel.json dichiara un buildCommand: $COMANDO"

# ── la sabbia: npm e next finti, che lasciano una traccia ───────────────────
SABBIA="$(mktemp -d)"
trap 'rm -rf "$SABBIA"' EXIT
mkdir -p "$SABBIA/bin"

cat > "$SABBIA/bin/npm" <<'FINE'
#!/usr/bin/env bash
# `npm run verify` esce con il codice scritto in ESITO_VERIFY; ogni altra cosa passa.
if [ "${1:-}" = "run" ] && [ "${2:-}" = "verify" ]; then
  echo "verify: chiamato" >> "$TRACCIA"
  exit "${ESITO_VERIFY:-0}"
fi
exit 0
FINE

cat > "$SABBIA/bin/next" <<'FINE'
#!/usr/bin/env bash
echo "next $*: chiamato" >> "$TRACCIA"
exit 0
FINE

chmod +x "$SABBIA/bin/npm" "$SABBIA/bin/next"

esegui() { # $1 = esito di verify · stampa uscita e traccia
  TRACCIA="$SABBIA/traccia.txt"; : > "$TRACCIA"
  local uscita=0
  ( cd "$ROOT" && PATH="$SABBIA/bin:$PATH" TRACCIA="$TRACCIA" ESITO_VERIFY="$1" \
      sh -c "$COMANDO" ) >/dev/null 2>&1 || uscita=$?
  echo "$uscita"
}

# ── ① prove rosse: non si pubblica ──────────────────────────────────────────
echo "▶ caso 1: le prove sono rosse"
uscita="$(esegui 1)"
traccia="$(cat "$SABBIA/traccia.txt" 2>/dev/null || true)"
if [ "$uscita" != "0" ]; then
  verde "il comando di build fallisce (uscita $uscita)"
else
  rosso "il comando di build è uscito 0 con le prove rosse: si pubblicherebbe"
fi
if grep -q "^next build" <<<"$traccia"; then
  rosso "«next build» è stato chiamato lo stesso: il cancello non ferma niente"
else
  verde "«next build» non è stato chiamato: non c'è niente da pubblicare"
fi

# ── ② prove verdi: si pubblica ──────────────────────────────────────────────
echo "▶ caso 2: le prove sono verdi"
uscita="$(esegui 0)"
traccia="$(cat "$SABBIA/traccia.txt" 2>/dev/null || true)"
if [ "$uscita" = "0" ]; then
  verde "il comando di build riesce"
else
  rosso "il comando di build è fallito (uscita $uscita) con le prove verdi: bloccherebbe i rilasci sani"
fi
if grep -q "^next build" <<<"$traccia"; then
  verde "«next build» è stato chiamato"
else
  rosso "«next build» non è stato chiamato: il sito non si aggiornerebbe più"
fi
if ! grep -q "^verify: chiamato" <<<"$traccia"; then
  rosso "«npm run verify» non è stato chiamato: il cancello non c'è"
else
  verde "«npm run verify» viene chiamato prima del build"
fi

echo
if [ "$fallito" = "0" ]; then
  echo "✅ un test rosso non arriva in produzione, e uno verde non blocca il rilascio"
  exit 0
fi
echo "❌ il difetto è aperto"
exit 1

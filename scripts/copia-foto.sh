#!/usr/bin/env bash
# 1/11/2026 — LE FOTO NELLA STESSA COPIA DEL DATABASE.
#
# Due mestieri:
#   bash scripts/copia-foto.sh copia    scarica le foto (scripts/copia-foto.mjs),
#                                       le impacchetta e le cifra accanto al
#                                       database: $BACKUP_DIR/mycity-foto_<data>.tar.gpg
#   bash scripts/copia-foto.sh riapri   prende il pacco piu' recente, lo decifra
#                                       e riapre davvero una foto (prova mensile)
#
# Il pacco finisce dove finisce gia' il database: fra gli artefatti
# dell'esecuzione (il passo «Conserva la copia» prende backup/*.gpg). Nessuna
# destinazione nuova.
#
# Il nome NON comincia con `mycity_`: la prova di ripristino sceglie il database
# per nome (scripts/copie-di-backup.mjs) e un pacco di foto non deve rubargli il
# posto.
#
# Le foto in chiaro non escono mai: la cartella temporanea si cancella anche se
# qualcosa va storto, e il passo che conserva prende solo i file `.gpg`.
set -euo pipefail

MESTIERE="${1:-copia}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
QUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

riepilogo() {
  if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then printf '%s\n' "$1" >> "$GITHUB_STEP_SUMMARY"; fi
}

if [[ -z "${BACKUP_PASSPHRASE:-}" ]]; then
  echo "[foto] esito-file-foto: fallita — manca BACKUP_PASSPHRASE: le foto non escono in chiaro." >&2
  exit 1
fi

if [[ "$MESTIERE" == "copia" ]]; then
  mkdir -p "$BACKUP_DIR"
  TS=$(date -u +%Y%m%d_%H%M%S)
  CHIARO="$BACKUP_DIR/.foto-in-chiaro_${TS}"
  PACCO="$BACKUP_DIR/mycity-foto_${TS}.tar.gpg"
  riuscito=0
  pulisci() {
    rm -rf "$CHIARO"
    if [[ "$riuscito" -ne 1 ]]; then rm -f "$PACCO"; fi
  }
  trap pulisci EXIT

  mkdir -p "$CHIARO"
  # L'uscita dello script si passa com'e': il 3 («non configurata») e' diverso
  # da un guasto, e l'allarme del lavoro notturno lo tratta in un altro modo.
  uscita=0
  node "$QUI/copia-foto.mjs" "$CHIARO" || uscita=$?
  if [[ "$uscita" -ne 0 ]]; then
    riepilogo "❌ **Le foto non sono in copia stanotte** — guarda la riga «esito-file-foto» nel registro del passo."
    exit "$uscita"
  fi
  # 5/11/2026 — La passphrase da un descrittore (3), non dalla riga di comando (si legge in /proc).
  tar -C "$CHIARO" -cf - . | gpg --batch --yes --symmetric --cipher-algo AES256 \
    --pinentry-mode loopback --passphrase-fd 3 --output "$PACCO" 3<<<"$BACKUP_PASSPHRASE"
  riuscito=1
  DIMENSIONE=$(du -h "$PACCO" | cut -f1)
  echo "[foto] Pacco cifrato: $PACCO ($DIMENSIONE)"
  riepilogo "✅ **Le foto sono in copia** — \`$(basename "$PACCO")\`, $DIMENSIONE, cifrato, insieme al database."
  exit 0
fi

if [[ "$MESTIERE" == "riapri" ]]; then
  ultimo=""
  for f in "$BACKUP_DIR"/mycity-foto_*.tar.gpg; do
    [[ -e "$f" ]] || continue
    if [[ -z "$ultimo" || "$f" > "$ultimo" ]]; then ultimo="$f"; fi
  done
  if [[ -z "$ultimo" ]]; then
    echo "::error::Nella copia non c'e' nessun pacco di foto (mycity-foto_*.tar.gpg): le foto non si possono ripristinare." >&2
    exit 1
  fi
  PROVA="$(mktemp -d)"
  trap 'rm -rf "$PROVA"' EXIT
  gpg --batch --yes --quiet --decrypt --pinentry-mode loopback --passphrase-fd 3 --output "$PROVA/pacco.tar" "$ultimo" 3<<<"$BACKUP_PASSPHRASE"
  # Il primo file vero del pacco (non una cartella).
  primo="$(tar -tf "$PROVA/pacco.tar" | grep -v '/$' | head -n 1 || true)"
  if [[ -z "$primo" ]]; then
    echo "::error::Il pacco $(basename "$ultimo") si apre ma e' vuoto: nessuna foto da ripristinare." >&2
    exit 1
  fi
  mkdir -p "$PROVA/fuori"
  tar -C "$PROVA/fuori" -xf "$PROVA/pacco.tar" "$primo"
  byte=$(wc -c < "$PROVA/fuori/$primo")
  if [[ "$byte" -eq 0 ]]; then
    echo "::error::La foto ${primo#./} si riapre ma e' vuota (zero byte)." >&2
    exit 1
  fi
  echo "[foto] Riaperta dalla copia: ${primo#./} (${byte} byte)."
  riepilogo "Una foto si riapre dalla copia: **sì** (\`${primo#./}\`, ${byte} byte)."
  exit 0
fi

echo "Uso: bash scripts/copia-foto.sh copia|riapri" >&2
exit 2

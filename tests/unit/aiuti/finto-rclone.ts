/**
 * 8/9/2026 — UN FINTO `rclone` CHE NON FINGE IL RISULTATO.
 *
 * Su questa macchina rclone non è installato, ma le prove sulla copia delle
 * foto non possono accontentarsi di un programma che risponde sempre zero: da
 * quando lo script va a RIPRENDERE una foto dalla copia prima di dirsi
 * riuscito, un finto che risponde sempre zero direbbe verde per il motivo
 * sbagliato.
 *
 * Questo finto fa per davvero quello che rclone documenta, su cartelle vere:
 *  - `sync` copia, e i file spariti dall'origine li SPOSTA in `--backup-dir`;
 *  - `lsf` elenca; `cat` legge; `lsd`/`mkdir` si comportano sullo storico.
 * E sa fare una cosa in più: rifiutare la LETTURA (`LETTURA_NEGATA=1`), che è
 * come si comporta una chiave con il permesso di scrivere e non di leggere —
 * il guasto che rende inutili mesi di copie senza che nessuno se ne accorga.
 */
export const FINTO_RCLONE = [
  '#!/usr/bin/env bash',
  'set -uo pipefail',
  '[ -n "${REGISTRO_RCLONE:-}" ] && echo "$@" >> "$REGISTRO_RCLONE"',
  'comando="${1:-}"; shift || true',
  'storico=""',
  'posizionali=()',
  'while [ $# -gt 0 ]; do',
  '  case "$1" in',
  '    --backup-dir) storico="$2"; shift 2;;',
  // Come il vero: `--count` vuole un numero dopo. Va riconosciuto PRIMA della
  // regola generica `--*`, altrimenti il numero finisce fra i percorsi.
  '    --count) shift 2;;',
  '    --*) shift;;',
  '    *) posizionali+=("$1"); shift;;',
  '  esac',
  'done',
  'case "$comando" in',
  '  lsd)',
  '    [ -d "${posizionali[0]:-}" ] && exit 0 || exit 3;;',
  '  mkdir) mkdir -p "${posizionali[0]:-}"; exit 0;;',
  '  sync)',
  '    origine="${posizionali[0]:-}"; destinazione="${posizionali[1]:-}"',
  '    # Come il vero: lo storico non puo stare dentro la destinazione.',
  '    case "$storico" in',
  '      "$destinazione"|"$destinazione"/*)',
  '        echo "Destination and parameter to --backup-dir overlap" >&2; exit 1;;',
  '    esac',
  '    mkdir -p "$destinazione"',
  '    for f in "$destinazione"/*; do',
  '      [ -e "$f" ] || continue',
  '      nome="$(basename "$f")"',
  '      if [ ! -e "$origine/$nome" ]; then',
  '        if [ -n "$storico" ]; then mkdir -p "$storico"; mv "$f" "$storico/$nome"; else rm -f "$f"; fi',
  '      fi',
  '    done',
  '    if [ -d "$origine" ]; then',
  '      for f in "$origine"/*; do [ -e "$f" ] || continue; cp "$f" "$destinazione/"; done',
  '    fi',
  '    exit 0;;',
  '  lsf)',
  '    # LA CHIAVE CHE SA SCRIVERE E NON LEGGERE: scrive benissimo, elencare no.',
  '    if [ "${LETTURA_NEGATA:-}" = "1" ]; then',
  '      echo "ERROR : : error listing: 403 Forbidden" >&2; exit 3',
  '    fi',
  '    cartella="${posizionali[0]:-}"',
  '    [ -d "$cartella" ] || exit 0',
  '    (cd "$cartella" && find . -type f -printf "%P\\n" 2>/dev/null || true)',
  '    exit 0;;',
  '  cat)',
  '    if [ "${LETTURA_NEGATA:-}" = "1" ]; then echo "403 Forbidden" >&2; exit 3; fi',
  '    exec cat "${posizionali[0]:-}";;',
  'esac',
  'exit 0',
].join('\n');

/** Un `pg_dump` che scrive il file richiesto e non tocca nessun database. */
export const FINTO_PGDUMP = [
  '#!/usr/bin/env bash',
  'uscita=""',
  'for a in "$@"; do case "$a" in --file=*) uscita="${a#--file=}";; esac; done',
  '[ -n "$uscita" ] && printf "copia finta\\n" > "$uscita"',
  'exit 0',
].join('\n');

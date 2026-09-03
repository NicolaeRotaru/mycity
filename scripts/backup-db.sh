#!/usr/bin/env bash
# Backup automatico DB Supabase via pg_dump.
#
# Esperti consultati:
# - SRE: "Supabase free tier non ha point-in-time recovery. Cron settimanale
#   esterno e' l'unica difesa contro data loss/corruption."
# - DBA: "pg_dump --format=custom comprime ~10x vs SQL plain. Restore con
#   pg_restore e' parallelizzabile."
# - Security: "Backup contiene PII completa. Encryption-at-rest obbligatoria
#   se va su S3/Drive. NON committare in git."
#
# Uso: chiamato da cron settimanale (es. domenica 03:00 Europe/Rome):
#   0 3 * * 0 /path/to/scripts/backup-db.sh
#
# Prerequisiti:
#   - pg_dump (postgresql-client 15+)
#   - SUPABASE_DB_URL in env: postgresql://postgres:[PWD]@db.[PROJECT].supabase.co:5432/postgres
#     (Dashboard → Settings → Database → Connection string → URI)
#   - BACKUP_DIR (default: ./backups)
#
# Facoltative — la copia dei FILE delle foto (vedi in fondo, R180). Finche' non
# ci sono, la copia delle immagini non parte e lo dice a chiare lettere:
#   - STORAGE_SYNC_SOURCE   remote rclone del fornitore, es. "supabase:"
#   - STORAGE_SYNC_DEST     remote rclone di destinazione, es. "b2:mycity-foto"
#   - STORAGE_SYNC_BUCKETS  quali secchi copiare (default: products stories reviews)
#   - STORAGE_SYNC_STORICO  dove finiscono i file spariti dall'origine
#                           (default: "<STORAGE_SYNC_DEST>-storico"). Vedi in
#                           fondo, R180 secondo giro: senza, la copia e' uno
#                           specchio e ripete la cancellazione invece di
#                           proteggerla.
#
# Retention: 4 settimane di backup, ruotati FIFO.

set -euo pipefail

DB_URL="${SUPABASE_DB_URL:-}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${RETENTION_DAYS:-28}"

if [[ -z "$DB_URL" ]]; then
  echo "[backup] ERROR: SUPABASE_DB_URL not set" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"

TS=$(date -u +%Y%m%d_%H%M%S)
OUT="$BACKUP_DIR/mycity_${TS}.dump"

echo "[backup] Starting pg_dump → $OUT"
START=$(date +%s)

pg_dump \
  --format=custom \
  --no-owner \
  --no-acl \
  --exclude-schema=storage \
  --exclude-schema=auth \
  --exclude-schema=realtime \
  --exclude-schema=supabase_functions \
  --exclude-schema=extensions \
  --file="$OUT" \
  "$DB_URL"

# #234 — Gli utenti. Lo schema `auth` era escluso per intero, e li' dentro c'e'
# `auth.users`: la tabella a cui punta `profiles.id` e quindici altri file di
# migrazione. Ripristinando solo questo dump si ottiene un database senza
# nessun utente, quindi senza nessun profilo, negozio o ordine collegabile a
# una persona: nessuno riuscirebbe piu' ad accedere. Non era un backup, era un
# file. Qui si aggiunge un secondo dump della sola tabella degli utenti (il
# resto dello schema `auth` e' roba interna di Supabase, che si ricrea da se').
UTENTI="$BACKUP_DIR/mycity_${TS}_utenti.dump"
echo "[backup] Dump degli utenti (auth.users) → $UTENTI"
pg_dump \
  --format=custom \
  --no-owner \
  --no-acl \
  --table=auth.users \
  --file="$UTENTI" \
  "$DB_URL"

# 31/8/2026 (R180) — L'elenco delle foto. Lo schema `storage` e' escluso qui
# sopra (e va escluso: dentro ci sono funzioni e trigger del fornitore che un
# ripristino non riuscirebbe a ricreare). Ma cosi' si perdeva anche il REGISTRO
# degli oggetti: quali file esistevano, con che nome, in quale secchio, di chi
# erano. Senza, dopo un incidente non si sa nemmeno cosa si e' perso: le schede
# prodotto tornano puntando a immagini di cui nessuno conosce piu' il nome, e
# l'unico modo di rifare il catalogo e' richiamare ogni negoziante a
# rifotografare tutto.
#
# Questo file NON contiene le foto: contiene il loro elenco. Vale comunque,
# perche' e' la mappa che dice a un ripristino cosa manca e dove rimetterlo.
#
# Il nome non comincia con `mycity_` di proposito: la prova mensile di
# ripristino sceglie la copia da riaprire con scripts/copie-di-backup.mjs, che
# riconosce i file `mycity_<data>[_utenti].dump` — un terzo file con quel
# prefisso le avrebbe rubato il posto e la prova avrebbe «ripristinato» un
# elenco di nomi di file dichiarandosi soddisfatta.
#
# L'elenco e' un pezzo IN PIU': se un giorno non si copiasse — permessi, schema
# spostato dal fornitore — non deve portarsi dietro anche il database. Il
# fallimento non viene ingoiato: la notte diventa rossa lo stesso, ma alla fine,
# quando la copia dei dati e' gia' scritta e cifrata.
DA_CIFRARE=("$OUT" "$UTENTI")
ESITO_ELENCO="ok"
ELENCO_FOTO="$BACKUP_DIR/mycity-elenco-foto_${TS}.dump"
echo "[backup] Elenco degli oggetti dello storage → $ELENCO_FOTO"
if pg_dump \
  --format=custom \
  --no-owner \
  --no-acl \
  --table=storage.buckets \
  --table=storage.objects \
  --file="$ELENCO_FOTO" \
  "$DB_URL"; then
  DA_CIFRARE+=("$ELENCO_FOTO")
else
  ESITO_ELENCO="fallito"
  rm -f "$ELENCO_FOTO"
  echo "[backup] esito-elenco-foto: fallito — il database e' copiato, ma di quali immagini esistevano non resta traccia." >&2
fi

# #234 — La cifratura. Dentro c'e' tutto: nomi, indirizzi, telefoni, email,
# ordini. Fino a ieri il file usciva in chiaro e restava per trenta giorni fra
# gli artefatti di GitHub, che chiunque abbia accesso al repository puo'
# scaricare. Con la passphrase, esce cifrato e basta la passphrase per
# rileggerlo.
if [ -n "${BACKUP_PASSPHRASE:-}" ]; then
  for f in "${DA_CIFRARE[@]}"; do
    gpg --batch --yes --symmetric --cipher-algo AES256 \
      --passphrase "$BACKUP_PASSPHRASE" --output "$f.gpg" "$f"
    rm -f "$f"
    echo "[backup] Cifrato: $f.gpg"
  done
else
  echo "[backup] ATTENZIONE: BACKUP_PASSPHRASE non impostata, il file resta in chiaro." >&2
fi

SIZE=$(du -sh "$BACKUP_DIR" | cut -f1)
DURATION=$(($(date +%s) - START))
echo "[backup] Done in ${DURATION}s — size: $SIZE"

# Rotation: rimuovi backup piu' vecchi di RETENTION_DAYS
find "$BACKUP_DIR" \
  \( -name "mycity_*.dump" -o -name "mycity_*.dump.gpg" \
     -o -name "mycity-elenco-foto_*.dump" -o -name "mycity-elenco-foto_*.dump.gpg" \) \
  -mtime +"$RETENTION_DAYS" -delete
echo "[backup] Rotation done (retention: ${RETENTION_DAYS} days)"

# ─────────────────────────────────────────────────────────────────────────────
# 31/8/2026 (R180) — LE FOTO VERE.
#
# Qui, fino a oggi, c'erano due righe commentate: «decommentare e configurare
# rclone». Nessuno le ha mai decommentate, e il documento del ripristino lo
# ammetteva in una nota — quindi le immagini di prodotti, storie e recensioni
# vivevano in un posto solo. Un errore sul progetto Supabase, una chiave
# compromessa o una cancellazione di massa e settimane di catalogazione dei
# negozianti spariscono: non si ripristinano da nessuna parte, si rifanno
# richiamando i negozianti a rifotografare tutto.
#
# La copia vera vuole un secchio di destinazione fuori dal fornitore, le sue
# chiavi e qualche euro al mese: e' una decisione di Nicola, non di questo
# script. Quello che questo script puo' fare — e da oggi fa — e' essere gia'
# pronto: appena le due variabili ci sono, la copia parte da sola; finche' non
# ci sono, lo dice a chiare lettere e non finge di aver copiato niente.
#
# Il silenzio era il vero difetto: un backup che non c'e' va visto in un
# giorno qualunque, non la mattina dell'incidente.
#
# Fuori dai secchi copiati di default restano `kyc-docs`, `invoices` e
# `cod-proof`: sono documenti d'identita', fatture e prove di pagamento, e
# portarli su un fornitore terzo e' una decisione con dentro il GDPR. Si
# aggiungono a mano in STORAGE_SYNC_BUCKETS, dopo quella decisione.
# ─────────────────────────────────────────────────────────────────────────────
SORGENTE_FOTO="${STORAGE_SYNC_SOURCE:-}"
DESTINAZIONE_FOTO="${STORAGE_SYNC_DEST:-}"
SECCHI_FOTO="${STORAGE_SYNC_BUCKETS:-products stories reviews}"

# 3/9/2026 (R180, secondo giro) — LA COPIA DELLE FOTO ERA UNO SPECCHIO, E UNO
# SPECCHIO NON E' UNA COPIA DI SICUREZZA.
#
# `rclone sync` allinea la destinazione all'origine: quello che nell'origine non
# c'e' piu', lo CANCELLA anche di la'. Il male da cui questa copia doveva
# difendere e' scritto nella scheda che l'ha chiesta — «un incidente sullo
# storage (cancellazione, bucket sbagliato, guasto del fornitore) cancella il
# lavoro di catalogazione di tutti i negozi» — ed e' esattamente il male che uno
# specchio propaga: le foto sparivano da Supabase lunedi', il lavoro notturno le
# toglieva anche dalla copia martedi' alle 02:17, e la mattina dopo non c'erano
# piu' da nessuna parte. La riparazione avrebbe avuto ventiquattro ore di vita.
#
# `--backup-dir` cambia il verbo: quello che sparisce dall'origine non viene
# cancellato dalla copia, viene SPOSTATO in una cartella con la data di stanotte.
# Non si perde niente per costruzione, senza dover ricordarsi di attivare il
# versionamento del fornitore di destinazione (che dipende da lui, cambia da
# fornitore a fornitore, e nessuno verifica mai che sia acceso).
#
# Il prezzo e' lo spazio: la cartella dello storico cresce, ed e' una spesa da
# guardare ogni tanto. Si paga volentieri — costa meno di un negoziante che
# rifotografa tutto il catalogo.
#
# Deve stare FUORI dalla cartella di destinazione, altrimenti rclone rifiuta di
# partire (e allora la notte diventa rossa, che e' il comportamento giusto: una
# copia che non parte va vista).
STORICO_FOTO="${STORAGE_SYNC_STORICO:-${DESTINAZIONE_FOTO}-storico}"

if [[ -z "$SORGENTE_FOTO" || -z "$DESTINAZIONE_FOTO" ]]; then
  echo "[backup] esito-foto: non-configurato — l'elenco delle immagini e' nella copia, i FILE no." >&2
  echo "[backup] Per accenderla: STORAGE_SYNC_SOURCE (es. \"supabase:\"), STORAGE_SYNC_DEST (es. \"b2:mycity-foto\") e rclone installato. Vedi docs/backup-restore.md §3." >&2
elif ! command -v rclone >/dev/null 2>&1; then
  echo "[backup] esito-foto: fallita — la copia delle foto e' configurata ma rclone non e' installato: nessun file e' stato copiato." >&2
  exit 4
else
  for secchio in $SECCHI_FOTO; do
    echo "[backup] Foto: ${SORGENTE_FOTO}${secchio} → ${DESTINAZIONE_FOTO}/${secchio}"
    echo "[backup] Le foto sparite dall'origine finiscono in ${STORICO_FOTO}/${TS}/${secchio}, non nel cestino."
    if ! rclone sync "${SORGENTE_FOTO}${secchio}" "${DESTINAZIONE_FOTO}/${secchio}" \
         --backup-dir "${STORICO_FOTO}/${TS}/${secchio}"; then
      echo "[backup] esito-foto: fallita — il secchio ${secchio} non e' stato copiato. Le foto NON sono al sicuro." >&2
      exit 5
    fi
  done
  echo "[backup] esito-foto: copiate (${SECCHI_FOTO} → ${DESTINAZIONE_FOTO}, storico in ${STORICO_FOTO})"
fi

if [ "$ESITO_ELENCO" != "ok" ]; then
  echo "[backup] La copia del database c'e' ed e' cifrata; l'elenco delle immagini no. Guarda l'errore di pg_dump qui sopra." >&2
  exit 6
fi

echo "[backup] Success — database, utenti ed elenco delle foto. Per i file delle immagini vale la riga «esito-foto» qui sopra."

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

# #234 — La cifratura. Dentro c'e' tutto: nomi, indirizzi, telefoni, email,
# ordini. Fino a ieri il file usciva in chiaro e restava per trenta giorni fra
# gli artefatti di GitHub, che chiunque abbia accesso al repository puo'
# scaricare. Con la passphrase, esce cifrato e basta la passphrase per
# rileggerlo.
if [ -n "${BACKUP_PASSPHRASE:-}" ]; then
  for f in "$OUT" "$UTENTI"; do
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
find "$BACKUP_DIR" \( -name "mycity_*.dump" -o -name "mycity_*.dump.gpg" \) -mtime +"$RETENTION_DAYS" -delete
echo "[backup] Rotation done (retention: ${RETENTION_DAYS} days)"

# Opzionale: upload su S3 / Google Drive / Backblaze B2
# Decommentare e configurare AWS CLI / rclone:
# aws s3 cp "$OUT" "s3://mycity-backups/$(basename $OUT)" --storage-class STANDARD_IA
# rclone copy "$OUT" "b2:mycity-backups/"

echo "[backup] Success"

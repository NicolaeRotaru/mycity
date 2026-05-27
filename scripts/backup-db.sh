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

SIZE=$(du -h "$OUT" | cut -f1)
DURATION=$(($(date +%s) - START))
echo "[backup] Done in ${DURATION}s — size: $SIZE"

# Rotation: rimuovi backup piu' vecchi di RETENTION_DAYS
find "$BACKUP_DIR" -name "mycity_*.dump" -mtime +"$RETENTION_DAYS" -delete
echo "[backup] Rotation done (retention: ${RETENTION_DAYS} days)"

# Opzionale: upload su S3 / Google Drive / Backblaze B2
# Decommentare e configurare AWS CLI / rclone:
# aws s3 cp "$OUT" "s3://mycity-backups/$(basename $OUT)" --storage-class STANDARD_IA
# rclone copy "$OUT" "b2:mycity-backups/"

echo "[backup] Success"

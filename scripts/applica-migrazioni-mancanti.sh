#!/usr/bin/env bash
# =============================================================================
# Applica al database SOLO le migrazioni che non ci sono ancora, e le registra.
# =============================================================================
# Uso:  SUPABASE_DB_URL=postgres://... bash scripts/applica-migrazioni-mancanti.sh
#
# PERCHE' ESISTE (radiografia del 27/8/2026, difetto 69).
#
# Il passo del rilascio applicava TUTTI i file, ogni volta, con un ciclo:
#
#   for f in $(ls migrations/*.sql | sort -V); do psql -v ON_ERROR_STOP=1 -f "$f"; done
#
# Il commento sopra dichiarava «le migrazioni del progetto sono idempotenti».
# Non e' vero: 001 contiene `CREATE TABLE public.profiles (` e 002
# `CREATE TABLE public.categories (`, senza `IF NOT EXISTS`. Su un database che
# quelle tabelle ce le ha gia' — cioe' la produzione — psql risponde «relation
# already exists» e con ON_ERROR_STOP=1 il passo muore sul PRIMO file.
#
# Secondo difetto, indipendente: quel ciclo non registrava niente in
# `supabase_migrations.schema_migrations`. Il cancello subito dopo
# (`npm run db:check-drift`) legge proprio quella tabella: avrebbe trovato tutte
# le migrazioni «non applicate» e bloccato comunque il rilascio.
#
# Il giorno in cui si configurano i segreti per rendere sicuro il rilascio, i
# rilasci si fermerebbero del tutto — proprio mentre si spegne la strada
# vecchia. Qui si applica e si registra solo cio' che manca, come fa
# tests/sql/harness/apply.sh per il database di prova.
#
# LA PROVA: gira due volte di fila nella CI (job «Controlli database»). La
# seconda deve applicare zero file e uscire verde: l'idempotenza si prova, non
# si dichiara in un commento.
# =============================================================================
set -euo pipefail

DB="${SUPABASE_DB_URL:-}"
if [ -z "$DB" ]; then
  echo "✗ manca SUPABASE_DB_URL" >&2
  exit 1
fi

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
MIG="$ROOT/migrations"

psql "$DB" -q -v ON_ERROR_STOP=1 <<'SQL'
CREATE SCHEMA IF NOT EXISTS supabase_migrations;
CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
  version text PRIMARY KEY,
  name    text,
  statements text[]
);
SQL

applicate=0
saltate=0

for f in $(ls "$MIG"/*.sql | sort -V); do
  name="$(basename "$f")"
  versione="${name%%_*}"
  descrizione="${name#*_}"; descrizione="${descrizione%.sql}"

  gia="$(psql "$DB" -X -A -t -v ON_ERROR_STOP=1 \
    -c "SELECT 1 FROM supabase_migrations.schema_migrations
         WHERE version = '$versione' OR name = '$descrizione' LIMIT 1")"
  if [ -n "$gia" ]; then
    saltate=$((saltate + 1))
    continue
  fi

  echo "▶ applico $name"
  # Una transazione sola: se la migrazione si rompe a meta', non lascia il
  # database in uno stato intermedio e non si registra come applicata.
  psql "$DB" -q -v ON_ERROR_STOP=1 --single-transaction -f "$f"
  psql "$DB" -q -v ON_ERROR_STOP=1 \
    -c "INSERT INTO supabase_migrations.schema_migrations (version, name)
        VALUES ('$versione', '$descrizione')
        ON CONFLICT (version) DO NOTHING"
  applicate=$((applicate + 1))
done

echo "▶ applicate $applicate · gia' presenti $saltate"

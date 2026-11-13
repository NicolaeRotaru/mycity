#!/usr/bin/env bash
# =============================================================================
# R12-009 — Le semine (seeds/00*.sql) girano sullo schema di oggi.
# =============================================================================
# Uso:  tests/sql/harness/riparazione-r12-le-semine-girano.sh [nome_database]
# Ricostruisce il database dalle migrazioni (apply.sh), aggiunge le colonne di
# GoTrue che l'impalcatura minima non ha (le semine creano utenti come fa
# Supabase), poi applica tutte le semine DUE volte (sono rieseguibili) e guarda
# che i negozi demo siano approvati e che nessun alimento sia in vendita senza le
# dichiarazioni (gli alimenti della semina restano bozze: la semina non le conosce).
# Prima del 12/11/2026 si fermava su 001 («approvazione riservata allo staff»)
# e su 005-007 (chk_approvazione_coerente).
# =============================================================================
set -euo pipefail
DB="${1:-mycity_semine}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"

bash "$HERE/apply.sh" "$DB" >/dev/null
psql -X -q -d "$DB" -v ON_ERROR_STOP=1 <<'SQL'
ALTER TABLE auth.users
  ADD COLUMN IF NOT EXISTS instance_id uuid, ADD COLUMN IF NOT EXISTS aud text, ADD COLUMN IF NOT EXISTS role text,
  ADD COLUMN IF NOT EXISTS invited_at timestamptz, ADD COLUMN IF NOT EXISTS confirmation_token text,
  ADD COLUMN IF NOT EXISTS confirmation_sent_at timestamptz, ADD COLUMN IF NOT EXISTS recovery_token text,
  ADD COLUMN IF NOT EXISTS recovery_sent_at timestamptz, ADD COLUMN IF NOT EXISTS email_change_token_new text,
  ADD COLUMN IF NOT EXISTS email_change text, ADD COLUMN IF NOT EXISTS email_change_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS is_super_admin boolean, ADD COLUMN IF NOT EXISTS phone_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS phone_change text, ADD COLUMN IF NOT EXISTS phone_change_token text,
  ADD COLUMN IF NOT EXISTS phone_change_sent_at timestamptz, ADD COLUMN IF NOT EXISTS email_change_token_current text,
  ADD COLUMN IF NOT EXISTS email_change_confirm_status smallint, ADD COLUMN IF NOT EXISTS banned_until timestamptz,
  ADD COLUMN IF NOT EXISTS reauthentication_token text, ADD COLUMN IF NOT EXISTS reauthentication_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS is_sso_user boolean;
CREATE TABLE IF NOT EXISTS auth.identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), provider_id text,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE, identity_data jsonb, provider text,
  last_sign_in_at timestamptz, created_at timestamptz, updated_at timestamptz,
  email text GENERATED ALWAYS AS (lower(identity_data->>'email')) STORED
);
SQL

for giro in 1 2; do
  for f in $(ls "$ROOT"/seeds/00*.sql | LC_ALL=C sort); do
    if ! out="$(psql -X -q -d "$DB" -v ON_ERROR_STOP=1 -f "$f" 2>&1)"; then
      echo "✗ giro $giro: $(basename "$f") si ferma:"; echo "$out" | grep -E "ERROR|DETAIL" | head -3; exit 1
    fi
  done
done

psql -X -q -At -d "$DB" -v ON_ERROR_STOP=1 <<'SQL'
DO $$
DECLARE negozi int; alimenti int; senza int;
BEGIN
  SELECT count(*) INTO negozi FROM public.profiles p JOIN auth.users u ON u.id = p.id
   WHERE u.email LIKE '%@piacenza-demo.local' AND p.role = 'seller' AND p.is_approved AND p.approval_status = 'approved';
  SELECT count(*) INTO alimenti FROM public.products
   WHERE seller_id IN ('11111111-1111-1111-1111-aaaaaaaa0001','11111111-1111-1111-1111-aaaaaaaa0002') AND status = 'draft';
  SELECT count(*) INTO senza FROM public.products
   WHERE seller_id IN ('11111111-1111-1111-1111-aaaaaaaa0001','11111111-1111-1111-1111-aaaaaaaa0002')
     AND status = 'available' AND (coalesce(attributes->>'allergeni','') = '' OR coalesce(attributes->>'ingredienti','') = '');
  IF negozi <> 16 THEN RAISE EXCEPTION 'negozi demo approvati: % (attesi 16)', negozi; END IF;
  IF alimenti <> 30 THEN RAISE EXCEPTION 'alimenti in bozza: % (attesi 30)', alimenti; END IF;
  IF senza <> 0 THEN RAISE EXCEPTION '% alimenti in vendita senza dichiarazioni', senza; END IF;
END $$;
SQL
echo "✓ le semine girano (due volte) sullo schema di oggi"

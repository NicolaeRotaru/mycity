#!/usr/bin/env bash
# =============================================================================
# 24/11/2026 — La 707 (SDG Agenzia) e la 708 (Ora del Gusto) girano anche su un auth.users
# completo, come su Supabase vero.
# =============================================================================
# Uso:  tests/sql/harness/707-e-708-su-auth-completo.sh [nome_database]
# Il database di prova ha un auth.users ridotto: la 707 lì prende il ramo corto. Questa prova
# aggiunge le colonne di GoTrue (come riparazione-r12-le-semine-girano.sh), toglie l'utente di SDG
# e riesegue la 707 due volte: deve prendere il ramo completo, coi token '' (mai NULL: GoTrue si
# rompe) e il blocco a una data vera (mai 'infinity', che GoTrue non sa leggere — collaudo del 24/11).
# =============================================================================
set -euo pipefail
DB="${1:-mycity_sdg707}"
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
  email text GENERATED ALWAYS AS (lower(identity_data->>'email')) STORED,
  UNIQUE (provider_id, provider)
);
DELETE FROM auth.users WHERE id IN ('11111111-1111-1111-1111-5d9000000001', '0de1905e-7000-4000-8000-000000000001');
SQL

for giro in 1 2; do
  for m in 707_sdg_agenzia_nel_marketplace 708_ora_del_gusto_e_il_preventivo_con_il_codice; do
    if ! out="$(psql -X -q -d "$DB" -v ON_ERROR_STOP=1 -f "$ROOT/migrations/$m.sql" 2>&1)"; then
      echo "✗ giro $giro: $m si ferma:"; echo "$out" | grep -E "ERROR|DETAIL" | head -3; exit 1
    fi
  done
done

psql -X -q -At -d "$DB" -v ON_ERROR_STOP=1 <<'SQL'
DO $$
DECLARE u record; n int;
BEGIN
  SELECT * INTO u FROM auth.users WHERE id = '11111111-1111-1111-1111-5d9000000001';
  IF u.id IS NULL THEN RAISE EXCEPTION 'utente di SDG non creato'; END IF;
  IF u.instance_id IS NULL OR u.aud <> 'authenticated' THEN RAISE EXCEPTION 'la 707 non ha preso il ramo completo'; END IF;
  IF u.confirmation_token IS NULL OR u.recovery_token IS NULL OR u.email_change_token_new IS NULL
     OR u.email_change IS NULL OR u.reauthentication_token IS NULL OR u.phone_change IS NULL THEN
    RAISE EXCEPTION 'un token è NULL: GoTrue si rompe';
  END IF;
  IF u.banned_until IS NULL OR u.banned_until = 'infinity'::timestamptz OR u.banned_until < now() + interval '99 years' THEN
    RAISE EXCEPTION 'blocco sbagliato: %', u.banned_until;
  END IF;
  IF coalesce(u.encrypted_password, '') <> '' THEN RAISE EXCEPTION 'SDG ha una password'; END IF;
  SELECT count(*) INTO n FROM auth.identities WHERE user_id = u.id;
  IF n <> 1 THEN RAISE EXCEPTION 'identità di SDG: % (attesa 1)', n; END IF;
  SELECT count(*) INTO n FROM public.products WHERE seller_id = u.id AND status = 'available';
  IF n <> 3 THEN RAISE EXCEPTION 'abbonamenti in vetrina: % (attesi 3)', n; END IF;
  SELECT count(*) INTO n FROM public.profiles WHERE id = u.id AND is_approved AND approval_status = 'approved';
  IF n <> 1 THEN RAISE EXCEPTION 'profilo di SDG non approvato'; END IF;

  -- Ora del Gusto: ramo completo, token '' e blocco a una data vera finché il titolare non accetta.
  SELECT * INTO u FROM auth.users WHERE id = '0de1905e-7000-4000-8000-000000000001';
  IF u.id IS NULL OR u.instance_id IS NULL THEN RAISE EXCEPTION 'utente di Ora del Gusto non creato col ramo completo'; END IF;
  IF u.confirmation_token IS NULL OR u.recovery_token IS NULL OR u.email_change IS NULL THEN RAISE EXCEPTION 'Ora del Gusto: un token è NULL'; END IF;
  IF u.banned_until IS NULL OR u.banned_until = 'infinity'::timestamptz OR u.banned_until < now() + interval '99 years' THEN
    RAISE EXCEPTION 'Ora del Gusto: blocco sbagliato: %', u.banned_until;
  END IF;
  SELECT count(*) INTO n FROM public.profiles WHERE id = u.id AND NOT is_approved AND approval_status IS NULL AND business_type = 'bar';
  IF n <> 1 THEN RAISE EXCEPTION 'Ora del Gusto non è in modalità preventivo'; END IF;
  SELECT count(*) INTO n FROM public.preventivi_con_codice WHERE seller_id = u.id;
  IF n <> 1 THEN RAISE EXCEPTION 'codici di Ora del Gusto: % (atteso 1)', n; END IF;
END $$;
SQL
echo "✓ la 707 e la 708 girano su auth.users completo, due volte"

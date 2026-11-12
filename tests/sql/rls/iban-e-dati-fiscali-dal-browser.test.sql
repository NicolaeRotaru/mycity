-- =============================================================================
-- 365 — L'IBAN dei bonifici e i dati fiscali non si cambiano dal browser
-- =============================================================================
--   tests/sql/harness/apply.sh mycity_test && tests/sql/harness/run.sh mycity_test
--   ① un negozio collegato non cambia il proprio IBAN dal browser;
--   ② non cambia la propria partita IVA dal browser;
--   ③ un cliente non si scrive un IBAN;
--   ④ il negozio cambia ancora telefono e orari dal browser;
--   ⑤ il fattorino scrive ancora la sua anagrafica dal browser;
--   ⑥ il server (chiave di servizio) cambia ancora l'IBAN.
-- Senza la migrazione 365 ①, ② e ③ sono ROSSI.
-- =============================================================================

BEGIN;
SET LOCAL mycity.allow_profile_write = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('e3650000-0000-0000-0000-000000000001', 'negozio-365@test.it', '{"role":"seller"}'),
  ('e3650000-0000-0000-0000-000000000002', 'cliente-365@test.it', '{"role":"buyer"}'),
  ('e3650000-0000-0000-0000-000000000003', 'rider-365@test.it',   '{"role":"rider"}');
UPDATE public.profiles SET is_approved = true, approval_status = 'approved', store_name = 'Negozio 365',
       billing_iban = 'IT60X0542811101000000123456', business_vat_number = '01234567890'
 WHERE id = 'e3650000-0000-0000-0000-000000000001';
RESET mycity.allow_profile_write;

CREATE FUNCTION pg_temp.prova(utente uuid, colonna text, valore text) RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('UPDATE public.profiles SET %I = %L WHERE id = %L', colonna, valore, utente);
  RETURN true;
EXCEPTION WHEN insufficient_privilege THEN RETURN false;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.prova(uuid, text, text) TO authenticated;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"e3650000-0000-0000-0000-000000000001","role":"authenticated"}';
INSERT INTO esiti VALUES ('1 il negozio non cambia l IBAN dal browser',
  NOT pg_temp.prova('e3650000-0000-0000-0000-000000000001', 'billing_iban', 'IT02L1234512345123456789012'), '');
INSERT INTO esiti VALUES ('2 il negozio non cambia la partita IVA dal browser',
  NOT pg_temp.prova('e3650000-0000-0000-0000-000000000001', 'business_vat_number', '99999999999'), '');
INSERT INTO esiti VALUES ('4 il negozio cambia ancora il telefono del negozio',
  pg_temp.prova('e3650000-0000-0000-0000-000000000001', 'store_phone', '0523000000'), '');
SET LOCAL request.jwt.claims = '{"sub":"e3650000-0000-0000-0000-000000000002","role":"authenticated"}';
INSERT INTO esiti VALUES ('3 un cliente non si scrive un IBAN',
  NOT pg_temp.prova('e3650000-0000-0000-0000-000000000002', 'billing_iban', 'IT02L1234512345123456789012'), '');
SET LOCAL request.jwt.claims = '{"sub":"e3650000-0000-0000-0000-000000000003","role":"authenticated"}';
INSERT INTO esiti VALUES ('5 il fattorino scrive ancora il suo nome legale',
  pg_temp.prova('e3650000-0000-0000-0000-000000000003', 'legal_first_name', 'Mario'), '');
RESET ROLE;

INSERT INTO esiti SELECT '1b l IBAN in banca dati è ancora quello vero',
  billing_iban = 'IT60X0542811101000000123456', billing_iban
  FROM public.profiles WHERE id = 'e3650000-0000-0000-0000-000000000001';

SET LOCAL request.jwt.claims = '{"role":"service_role"}';
INSERT INTO esiti VALUES ('6 il server cambia ancora l IBAN',
  pg_temp.prova('e3650000-0000-0000-0000-000000000001', 'billing_iban', 'IT02L1234512345123456789012'), '');

SELECT nome, CASE WHEN ok THEN 'ok' ELSE 'ROTTO' END AS esito, dettaglio FROM esiti ORDER BY nome;
DO $$
DECLARE rossi int; elenco text;
BEGIN
  SELECT count(*), coalesce(string_agg(format('%s → %s', e.nome, e.dettaglio), E'\n  '), '')
    INTO rossi, elenco FROM esiti e WHERE e.ok IS NOT TRUE;
  IF rossi > 0 THEN RAISE EXCEPTION E'% controllo/i rosso/i su IBAN e dati fiscali:\n  %', rossi, elenco; END IF;
  RAISE NOTICE 'IBAN e dati fiscali si cambiano solo dal server: % controlli verdi', (SELECT count(*) FROM esiti);
END $$;
ROLLBACK;

-- =============================================================================
-- R18-022 · Il documento d'identità ha la sua scadenza, e scaduto conta
-- =============================================================================
-- Gira contro un database ricostruito dalle migrazioni vere:
--   tests/sql/harness/apply.sh mycity_test
--   tests/sql/harness/run.sh   mycity_test
--
-- Il difetto: patente e polizza hanno la data di scadenza e is_rider_in_regola
-- (270) ferma chi le ha scadute; il documento d'identità no, non c'era nemmeno
-- la colonna. Un fattorino col documento scaduto prendeva consegne come prima.
--
-- COME ARRIVA LA DATA. Il profilo del fattorino si riscrive intero da un JSON
-- (jsonb_populate_record), come lo manderebbe la rotta che carica il documento:
-- se il database non ha dove tenere la scadenza del documento, la chiave resta
-- fuori e la scadenza si perde. È proprio il difetto, e la prova lo vede dal
-- comportamento (prendi_ordine), non da un nome che manca.
--
-- ① documento d'identità scaduto ieri: prendi_ordine risponde DOCUMENTI_SCADUTI
-- ② le consegne già prese si finiscono lo stesso (is_rider_approvato resta vera)
-- ③ documento che scade oggi: oggi vale ancora, prende l'ordine
-- ④ nessuna data dichiarata: come prima, prende l'ordine
-- Senza la 427 il passo ① è rosso. Tutto con ROLLBACK.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';
SET LOCAL mycity.allow_order_write   = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('e1822000-0000-0000-0000-00000000000a', 'negozio-r18d@test.it',  '{"role":"seller"}'),
  ('e1822000-0000-0000-0000-00000000000b', 'cliente-r18d@test.it',  '{"role":"buyer"}'),
  ('e1822000-0000-0000-0000-000000000001', 'scaduto-r18d@test.it',  '{"role":"rider"}'),
  ('e1822000-0000-0000-0000-000000000002', 'oggi-r18d@test.it',     '{"role":"rider"}'),
  ('e1822000-0000-0000-0000-000000000003', 'senza-r18d@test.it',    '{"role":"rider"}');

UPDATE public.profiles
   SET is_approved = true, approval_status = 'approved', store_name = 'Bottega R18d',
       store_address = 'Via Roma 1', store_lat = 45.05, store_lng = 9.69
 WHERE id = 'e1822000-0000-0000-0000-00000000000a';

-- Tre fattorini approvati in bici, con patente e polizza in regola.
UPDATE public.profiles
   SET is_approved = true, approval_status = 'approved', rider_vehicle_type = 'BIKE',
       kyc_id_doc_front_url = id::text || '/id_front-1762000000000.jpg',
       kyc_id_doc_back_url  = id::text || '/id_back-1762000000000.jpg',
       rider_license_expires_on   = (now() AT TIME ZONE 'Europe/Rome')::date + 300,
       rider_insurance_expires_on = (now() AT TIME ZONE 'Europe/Rome')::date + 300
 WHERE id IN ('e1822000-0000-0000-0000-000000000001', 'e1822000-0000-0000-0000-000000000002',
              'e1822000-0000-0000-0000-000000000003');

-- Riscrive il profilo intero da un JSON con i campi nuovi, come una rotta del server.
CREATE OR REPLACE FUNCTION pg_temp.riscrivi_profilo(p_id uuid, p_campi jsonb) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE vecchio public.profiles;
BEGIN
  SELECT * INTO vecchio FROM public.profiles WHERE id = p_id;
  DELETE FROM public.profiles WHERE id = p_id;
  INSERT INTO public.profiles
  SELECT (jsonb_populate_record(NULL::public.profiles, to_jsonb(vecchio) || p_campi)).*;
END $$;

SELECT pg_temp.riscrivi_profilo('e1822000-0000-0000-0000-000000000001',
  jsonb_build_object('kyc_id_doc_expires_on', (now() AT TIME ZONE 'Europe/Rome')::date - 1));
SELECT pg_temp.riscrivi_profilo('e1822000-0000-0000-0000-000000000002',
  jsonb_build_object('kyc_id_doc_expires_on', (now() AT TIME ZONE 'Europe/Rome')::date));

INSERT INTO public.orders (
  id, user_id, seller_id, total_price, payment_status, delivery_status,
  delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip, rider_fee_cents
)
SELECT v.id::uuid, 'e1822000-0000-0000-0000-00000000000b', 'e1822000-0000-0000-0000-00000000000a',
       20.00, 'PAID', 'READY', 'Maria Rossi', '3331234567', 'Via Verdi 10', 'Piacenza', '29121', 450
FROM (VALUES ('e1822000-2222-0000-0000-000000000001'),
             ('e1822000-2222-0000-0000-000000000002'),
             ('e1822000-2222-0000-0000-000000000003')) AS v(id);

-- Da qui in poi scrive la persona, coi suoi permessi.
SET LOCAL mycity.allow_profile_write = '0';
SET LOCAL mycity.allow_order_write   = '0';
SET LOCAL ROLE authenticated;

-- ① ② documento d'identità scaduto ieri
SET LOCAL request.jwt.claims = '{"sub":"e1822000-0000-0000-0000-000000000001","role":"authenticated"}';
INSERT INTO esiti
SELECT '1 documento d''identità scaduto ieri: non prende l''ordine e il motivo è DOCUMENTI_SCADUTI',
       (r ->> 'ok') = 'false' AND (r ->> 'motivo') = 'DOCUMENTI_SCADUTI', r::text
  FROM (SELECT public.prendi_ordine('e1822000-2222-0000-0000-000000000001') AS r) x;
INSERT INTO esiti
SELECT '2 documento d''identità scaduto: le consegne già prese si possono finire', public.is_rider_approvato(), '';

-- ③ documento che scade oggi
SET LOCAL request.jwt.claims = '{"sub":"e1822000-0000-0000-0000-000000000002","role":"authenticated"}';
INSERT INTO esiti
SELECT '3 documento d''identità che scade oggi: oggi vale, prende l''ordine', (r ->> 'ok') = 'true', r::text
  FROM (SELECT public.prendi_ordine('e1822000-2222-0000-0000-000000000002') AS r) x;

-- ④ nessuna data dichiarata
SET LOCAL request.jwt.claims = '{"sub":"e1822000-0000-0000-0000-000000000003","role":"authenticated"}';
INSERT INTO esiti
SELECT '4 documento d''identità senza data: come prima, prende l''ordine', (r ->> 'ok') = 'true', r::text
  FROM (SELECT public.prendi_ordine('e1822000-2222-0000-0000-000000000003') AS r) x;

RESET ROLE;
RESET request.jwt.claims;

-- ── Verdetto ──────────────────────────────────────────────────────────────
DO $$
DECLARE rossi int; elenco text;
BEGIN
  SELECT count(*), coalesce(string_agg(format('%s → %s', e.nome, e.dettaglio), E'\n  ' ORDER BY e.nome), '')
    INTO rossi, elenco
  FROM esiti e WHERE e.ok IS NOT TRUE;
  IF rossi > 0 THEN
    RAISE EXCEPTION E'R18-022: % controllo/i rosso/i sulla scadenza del documento d''identità:\n  %', rossi, elenco;
  END IF;
  RAISE INFO 'R18-022: il documento d''identità scaduto conta come patente e polizza (% controlli verdi)',
    (SELECT count(*) FROM esiti);
END $$;

ROLLBACK;

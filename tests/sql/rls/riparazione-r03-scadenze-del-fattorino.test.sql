-- =============================================================================
-- R03-018 — Patente o polizza scadute: il fattorino non prende consegne (migrazione 270)
-- =============================================================================
--   tests/sql/harness/apply.sh mycity_test && tests/sql/harness/run.sh mycity_test
--
-- ① con la polizza scaduta ieri is_rider_approvato() è falso e prendi_ordine non passa
-- ② con le scadenze nel futuro (o vuote: la bici) è vero
-- ③ approvato, non può riscriversi da solo la scadenza della polizza
-- ④ non ancora approvato, il modulo d'iscrizione la scrive ancora
-- Senza la 270 i passi ① e ③ sono rossi. Tutto con ROLLBACK.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';
SET LOCAL mycity.allow_order_write   = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('11111111-1111-1111-1111-111111111111', 'negozio@test.it',   '{"role":"seller"}'),
  ('22222222-2222-2222-2222-222222222222', 'scaduto@test.it',   '{"role":"rider"}'),
  ('33333333-3333-3333-3333-333333333333', 'cliente@test.it',   '{"role":"buyer"}'),
  ('44444444-4444-4444-4444-444444444444', 'in-regola@test.it', '{"role":"rider"}'),
  ('55555555-5555-5555-5555-555555555555', 'in-bici@test.it',   '{"role":"rider"}'),
  ('66666666-6666-6666-6666-666666666666', 'nuovo@test.it',     '{"role":"rider"}');

UPDATE public.profiles
   SET is_approved = true, approval_status = 'approved', store_name = 'Bottega di prova',
       store_address = 'Via Roma 1', store_lat = 45.05, store_lng = 9.69
 WHERE id = '11111111-1111-1111-1111-111111111111';
UPDATE public.profiles SET is_approved = true, approval_status = 'approved',
       rider_license_expires_on = (now() AT TIME ZONE 'Europe/Rome')::date + 300,
       rider_insurance_expires_on = (now() AT TIME ZONE 'Europe/Rome')::date - 1
 WHERE id = '22222222-2222-2222-2222-222222222222';
UPDATE public.profiles SET is_approved = true, approval_status = 'approved',
       rider_license_expires_on = (now() AT TIME ZONE 'Europe/Rome')::date + 300,
       rider_insurance_expires_on = (now() AT TIME ZONE 'Europe/Rome')::date + 30
 WHERE id = '44444444-4444-4444-4444-444444444444';
UPDATE public.profiles SET is_approved = true, approval_status = 'approved', rider_vehicle_type = 'BIKE'
 WHERE id = '55555555-5555-5555-5555-555555555555';

INSERT INTO public.orders (
  id, user_id, seller_id, total_price, payment_status, delivery_status,
  delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip, rider_fee_cents
) VALUES (
  'a0000000-0000-0000-0000-00000000000a', '33333333-3333-3333-3333-333333333333',
  '11111111-1111-1111-1111-111111111111', 42.00, 'PAID', 'READY',
  'Maria Rossi', '3331234567', 'Via Verdi 10', 'Piacenza', '29121', 450
);

-- Da qui in poi scrive la persona, coi suoi permessi: niente porte di servizio.
SET LOCAL mycity.allow_profile_write = '0';
SET LOCAL mycity.allow_order_write   = '0';

-- ① Polizza scaduta ieri.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
INSERT INTO esiti SELECT 'polizza scaduta: non risulta fattorino in regola', NOT public.is_rider_approvato(), 'is_rider_approvato=' || public.is_rider_approvato();
INSERT INTO esiti
SELECT 'polizza scaduta: non prende l''ordine', (r ->> 'ok') = 'false', r::text
  FROM (SELECT public.prendi_ordine('a0000000-0000-0000-0000-00000000000a') AS r) x;

-- ③ Approvato: non si riscrive la scadenza da solo.
DO $$
BEGIN
  UPDATE public.profiles SET rider_insurance_expires_on = '2027-10-31' WHERE id = '22222222-2222-2222-2222-222222222222';
  INSERT INTO esiti VALUES ('approvato: la scadenza non si cambia dal browser', false, 'la scrittura è passata');
EXCEPTION WHEN insufficient_privilege THEN
  INSERT INTO esiti VALUES ('approvato: la scadenza non si cambia dal browser', true, SQLERRM);
END $$;

-- ② In regola, e in bici senza scadenze.
SET LOCAL request.jwt.claims = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';
INSERT INTO esiti SELECT 'scadenze nel futuro: fattorino in regola', public.is_rider_approvato(), '';
SET LOCAL request.jwt.claims = '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated"}';
INSERT INTO esiti SELECT 'in bici senza patente né polizza: in regola', public.is_rider_approvato(), '';

-- ④ Non ancora approvato: il modulo scrive le scadenze.
SET LOCAL request.jwt.claims = '{"sub":"66666666-6666-6666-6666-666666666666","role":"authenticated"}';
DO $$
BEGIN
  UPDATE public.profiles SET rider_insurance_expires_on = '2027-10-31' WHERE id = '66666666-6666-6666-6666-666666666666';
  INSERT INTO esiti VALUES ('non approvato: il modulo scrive la scadenza', true, '');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO esiti VALUES ('non approvato: il modulo scrive la scadenza', false, SQLERRM);
END $$;

RESET ROLE;
DO $$
DECLARE r record; rossi int;
BEGIN
  FOR r IN SELECT * FROM esiti ORDER BY nome LOOP
    RAISE INFO '%  %  — %', CASE WHEN r.ok THEN 'ok  ' ELSE 'ROTTO' END, r.nome, r.dettaglio;
  END LOOP;
  SELECT count(*) INTO rossi FROM esiti WHERE ok IS NOT TRUE;
  IF rossi > 0 THEN
    RAISE EXCEPTION '% controlli su % sono rossi', rossi, (SELECT count(*) FROM esiti);
  END IF;
  RAISE INFO 'tutti verdi: % controlli', (SELECT count(*) FROM esiti);
END $$;

ROLLBACK;

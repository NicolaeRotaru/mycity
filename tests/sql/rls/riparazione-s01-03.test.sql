-- =============================================================================
-- S01-03 — Fattorino: mezzo e scadenze dopo l'approvazione
-- =============================================================================
--   tests/sql/harness/apply.sh mycity_test && tests/sql/harness/run.sh mycity_test
--   ① approvato in bici, scrive «auto» e due scadenze: non prende l'ordine e
--     torna in coda allo staff;
--   ② approvato in bici, scrive «scooter» e due scadenze: idem;
--   ③ approvato in scooter, scrive «auto»: idem;
--   ④ approvato in scooter con la polizza scaduta, scrive una nuova scadenza:
--     non prende l'ordine e torna in coda;
--   ⑤ targa, telefono e bici elettrica non cambiano niente;
--   ⑥ rimandare mezzo e scadenze uguali non cambia niente;
--   ⑦ durante l'iscrizione mezzo e scadenze si scrivono come prima;
--   ⑧ i cambi dello staff e della chiave di servizio non rimettono in coda;
--   ⑨ chi è in coda non si rimette «approvato» da solo;
--   ⑩ chi è in coda non finisce fra i documenti da potare;
--   ⑪ riapprovato dallo staff, prende l'ordine;
--   ⑬ da sospeso scrive «auto» e due scadenze: torna in coda, non approvato,
--     e l'ordine non lo prende;
--   ⑭ da sospeso in scooter con la polizza scaduta scrive la nuova scadenza:
--     torna in coda (lo staff lo rivede con «approve»), niente errore;
--   ⑮ approvato con una consegna ritirata: il rinnovo aspetta la fine della
--     consegna (frase per il fattorino), resta approvato e vede la consegna;
--   ⑯ approvato con una consegna assegnata e non ritirata: torna in coda, la
--     consegna torna in bacheca e il negozio riceve l'avviso;
--   ⑰ dopo ⑯ la scrittura degli ordini non resta aperta nella transazione.
-- Senza la migrazione 991 ①, ②, ③, ④ e ⑨ sono ROSSI; senza la 994 ⑬, ⑭, ⑮ e ⑯.
-- =============================================================================

BEGIN;
SET LOCAL mycity.allow_profile_write = '1';
SET LOCAL mycity.allow_order_write   = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated, service_role;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('e9910000-0000-0000-0000-000000000001', 'r1-s01@test.it', '{"role":"rider"}'),
  ('e9910000-0000-0000-0000-000000000002', 'r2-s01@test.it', '{"role":"rider"}'),
  ('e9910000-0000-0000-0000-000000000003', 'r3-s01@test.it', '{"role":"rider"}'),
  ('e9910000-0000-0000-0000-000000000004', 'r4-s01@test.it', '{"role":"rider"}'),
  ('e9910000-0000-0000-0000-000000000005', 'r5-s01@test.it', '{"role":"rider"}'),
  ('e9910000-0000-0000-0000-000000000006', 'r6-s01@test.it', '{"role":"rider"}'),
  ('e9910000-0000-0000-0000-000000000007', 'r7-s01@test.it', '{"role":"rider"}'),
  ('e9910000-0000-0000-0000-000000000008', 'r8-s01@test.it', '{"role":"rider"}'),
  ('e9910000-0000-0000-0000-000000000009', 'staff-s01-03@test.it', '{"role":"buyer"}'),
  ('e9910000-0000-0000-0000-00000000000e', 'r10-s01@test.it', '{"role":"rider"}'),
  ('e9910000-0000-0000-0000-00000000000f', 'r11-s01@test.it', '{"role":"rider"}'),
  ('e9910000-0000-0000-0000-000000000010', 'r12-s01@test.it', '{"role":"rider"}'),
  ('e9910000-0000-0000-0000-000000000011', 'r13-s01@test.it', '{"role":"rider"}'),
  ('e9910000-0000-0000-0000-00000000000a', 'negozio-s01-03@test.it', '{"role":"seller"}'),
  ('e9910000-0000-0000-0000-00000000000b', 'cliente-s01-03@test.it', '{"role":"buyer"}');

UPDATE public.profiles SET is_approved = true, approval_status = 'approved', store_name = 'Bottega S01',
       store_address = 'Via Roma 1', store_lat = 45.05, store_lng = 9.69
 WHERE id = 'e9910000-0000-0000-0000-00000000000a';
-- Approvati in bici, senza patente né polizza, con documento e selfie caricati.
UPDATE public.profiles SET is_approved = true, approval_status = 'approved', rider_vehicle_type = 'BIKE',
       rider_license_expires_on = NULL, rider_insurance_expires_on = NULL,
       kyc_id_doc_front_url = 'kyc/fronte-1700000000000.jpg', kyc_selfie_url = 'kyc/selfie-1700000000000.jpg'
 WHERE id IN ('e9910000-0000-0000-0000-000000000001', 'e9910000-0000-0000-0000-000000000002',
              'e9910000-0000-0000-0000-000000000005', 'e9910000-0000-0000-0000-000000000007',
              'e9910000-0000-0000-0000-000000000008');
-- Approvati in scooter, con le scadenze.
UPDATE public.profiles SET is_approved = true, approval_status = 'approved', rider_vehicle_type = 'SCOOTER',
       rider_license_expires_on = '2030-01-01', rider_insurance_expires_on = '2030-01-01'
 WHERE id IN ('e9910000-0000-0000-0000-000000000003', 'e9910000-0000-0000-0000-000000000006');
-- Approvato in scooter con la polizza scaduta ieri.
UPDATE public.profiles SET is_approved = true, approval_status = 'approved', rider_vehicle_type = 'SCOOTER',
       rider_license_expires_on = '2030-01-01',
       rider_insurance_expires_on = (now() AT TIME ZONE 'Europe/Rome')::date - 1
 WHERE id = 'e9910000-0000-0000-0000-000000000004';
UPDATE public.profiles SET role = 'admin' WHERE id = 'e9910000-0000-0000-0000-000000000009';
-- Approvato in bici e poi sospeso dallo staff.
UPDATE public.profiles SET is_approved = false, approval_status = 'suspended', approved_by = 'e9910000-0000-0000-0000-000000000009',
       rider_vehicle_type = 'BIKE', rider_license_expires_on = NULL, rider_insurance_expires_on = NULL,
       kyc_id_doc_front_url = 'kyc/fronte-1700000000000.jpg', kyc_selfie_url = 'kyc/selfie-1700000000000.jpg'
 WHERE id = 'e9910000-0000-0000-0000-00000000000e';
-- Approvati in scooter, con una consegna in mano: ritirata (⑮) o solo assegnata (⑯).
UPDATE public.profiles SET is_approved = true, approval_status = 'approved', rider_vehicle_type = 'SCOOTER',
       rider_license_expires_on = '2030-01-01', rider_insurance_expires_on = '2030-01-01'
 WHERE id IN ('e9910000-0000-0000-0000-00000000000f', 'e9910000-0000-0000-0000-000000000010');
-- Approvato in scooter, poi sospeso; la polizza nel frattempo è scaduta.
UPDATE public.profiles SET is_approved = false, approval_status = 'suspended', approved_by = 'e9910000-0000-0000-0000-000000000009',
       rider_vehicle_type = 'SCOOTER', rider_license_expires_on = '2030-01-01',
       rider_insurance_expires_on = (now() AT TIME ZONE 'Europe/Rome')::date - 1
 WHERE id = 'e9910000-0000-0000-0000-000000000011';
-- In iscrizione: un profilo nuovo, mai approvato.
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('e9910000-0000-0000-0000-00000000000c', 'r-nuovo-s01@test.it', '{"role":"rider"}');

INSERT INTO public.orders (
  id, user_id, seller_id, total_price, payment_status, delivery_status,
  delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip, rider_fee_cents
)
SELECT ('a9910000-0000-0000-0000-00000000000' || n)::uuid, 'e9910000-0000-0000-0000-00000000000b',
       'e9910000-0000-0000-0000-00000000000a', 20, 'PAID', 'READY',
       'Maria Rossi', '3331234567', 'Via Verdi 10', 'Piacenza', '29121', 450
  FROM generate_series(1, 3) AS n;
INSERT INTO public.orders (
  id, user_id, seller_id, rider_id, total_price, payment_status, delivery_status,
  delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip, rider_fee_cents
) VALUES
  ('a9910000-0000-0000-0000-000000000004', 'e9910000-0000-0000-0000-00000000000b', 'e9910000-0000-0000-0000-00000000000a',
   'e9910000-0000-0000-0000-00000000000f', 20, 'PAID', 'PICKED_UP',
   'Maria Rossi', '3331234567', 'Via Verdi 10', 'Piacenza', '29121', 450),
  ('a9910000-0000-0000-0000-000000000005', 'e9910000-0000-0000-0000-00000000000b', 'e9910000-0000-0000-0000-00000000000a',
   'e9910000-0000-0000-0000-000000000010', 20, 'PAID', 'ASSIGNED',
   'Maria Rossi', '3331234567', 'Via Verdi 10', 'Piacenza', '29121', 450);

SET LOCAL mycity.allow_profile_write = '0';
SET LOCAL mycity.allow_order_write   = '0';

-- Righe cambiate da un UPDATE del profilo; -1 se fermato per permessi.
CREATE FUNCTION pg_temp.prova(utente uuid, assegnazioni text) RETURNS int
LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  EXECUTE format('UPDATE public.profiles SET %s WHERE id = %L', assegnazioni, utente);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
EXCEPTION WHEN insufficient_privilege THEN RETURN -1;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.prova(uuid, text) TO authenticated, service_role;

-- Come prova, ma col fattorino (jwt) e la frase dell'errore: «ok» se la riga cambia.
CREATE FUNCTION pg_temp.frase(utente uuid, assegnazioni text) RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', utente, 'role', 'authenticated')::text, true);
  EXECUTE format('UPDATE public.profiles SET %s WHERE id = %L', assegnazioni, utente);
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE || ' ' || SQLERRM;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.frase(uuid, text) TO authenticated;

-- Le consegne che il fattorino (jwt) vede come sue.
CREATE FUNCTION pg_temp.sue(utente uuid) RETURNS bigint
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', utente, 'role', 'authenticated')::text, true);
  RETURN (SELECT count(*) FROM public.orders WHERE rider_id = utente);
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.sue(uuid) TO authenticated;

-- Il fattorino (jwt) cambia il proprio profilo; torna righe, approvazione, stato, coda e regola.
CREATE FUNCTION pg_temp.cambia(utente uuid, assegnazioni text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE n int; r record;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', utente, 'role', 'authenticated')::text, true);
  n := pg_temp.prova(utente, assegnazioni);
  SELECT is_approved, approval_status, approval_requested_at IS NOT NULL AS in_coda, rider_vehicle_type
    INTO r FROM public.profiles WHERE id = utente;
  RETURN format('righe=%s approvato=%s stato=%s richiesta=%s mezzo=%s in_regola=%s consegne_in_corso=%s',
                n, r.is_approved, r.approval_status, r.in_coda, r.rider_vehicle_type,
                public.is_rider_in_regola(), public.is_rider_approvato());
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.cambia(uuid, text) TO authenticated;

CREATE FUNCTION pg_temp.prendi(utente uuid, ordine uuid) RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', utente, 'role', 'authenticated')::text, true);
  RETURN (public.prendi_ordine(ordine) ->> 'ok');
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.prendi(uuid, uuid) TO authenticated;

SET LOCAL ROLE authenticated;

CREATE TEMP TABLE passi (n int, e text);
INSERT INTO passi SELECT 1, pg_temp.cambia('e9910000-0000-0000-0000-000000000001',
    $s$rider_vehicle_type = 'CAR', rider_license_expires_on = '2030-01-01', rider_insurance_expires_on = '2030-01-01'$s$);
INSERT INTO esiti SELECT '1 in bici → auto con due scadenze: in coda, l''ordine non lo prende',
  e = 'righe=1 approvato=f stato=pending richiesta=t mezzo=CAR in_regola=f consegne_in_corso=f' AND o = 'false',
  e || ' · presa ok=' || o
  FROM passi, pg_temp.prendi('e9910000-0000-0000-0000-000000000001', 'a9910000-0000-0000-0000-000000000001') AS o
 WHERE n = 1;
INSERT INTO esiti SELECT '2 in bici → scooter con due scadenze: in coda, fuori regola',
  e = 'righe=1 approvato=f stato=pending richiesta=t mezzo=SCOOTER in_regola=f consegne_in_corso=f', e
  FROM pg_temp.cambia('e9910000-0000-0000-0000-000000000002',
    $s$rider_vehicle_type = 'SCOOTER', rider_license_expires_on = '2030-01-01', rider_insurance_expires_on = '2030-01-01'$s$) AS e;
INSERT INTO esiti SELECT '3 in scooter → auto: in coda, fuori regola',
  e = 'righe=1 approvato=f stato=pending richiesta=t mezzo=CAR in_regola=f consegne_in_corso=f', e
  FROM pg_temp.cambia('e9910000-0000-0000-0000-000000000003', $s$rider_vehicle_type = 'CAR'$s$) AS e;
INSERT INTO passi SELECT 4, pg_temp.cambia('e9910000-0000-0000-0000-000000000004', $s$rider_insurance_expires_on = '2099-12-31'$s$);
INSERT INTO esiti SELECT '4 polizza scaduta e nuova scadenza scritta da sé: in coda, l''ordine non lo prende',
  e = 'righe=1 approvato=f stato=pending richiesta=t mezzo=SCOOTER in_regola=f consegne_in_corso=f' AND o = 'false',
  e || ' · presa ok=' || o
  FROM passi, pg_temp.prendi('e9910000-0000-0000-0000-000000000004', 'a9910000-0000-0000-0000-000000000002') AS o
 WHERE n = 4;
INSERT INTO esiti SELECT '5 targa, telefono e bici elettrica non cambiano niente',
  a LIKE 'righe=1 approvato=t stato=approved richiesta=f %' AND b LIKE 'righe=1 approvato=t stato=approved richiesta=f %'
    AND c = 'righe=1 approvato=t stato=approved richiesta=f mezzo=EBIKE in_regola=t consegne_in_corso=t',
  concat_ws(' / ', a, b, c)
  FROM pg_temp.cambia('e9910000-0000-0000-0000-000000000005', $s$rider_vehicle_plate = 'XY123'$s$) AS a,
       pg_temp.cambia('e9910000-0000-0000-0000-000000000005', $s$phone = '3330000000'$s$) AS b,
       pg_temp.cambia('e9910000-0000-0000-0000-000000000005', $s$rider_vehicle_type = 'EBIKE'$s$) AS c;
INSERT INTO esiti SELECT '6 rimandare mezzo e scadenze uguali non cambia niente',
  e = 'righe=1 approvato=t stato=approved richiesta=f mezzo=SCOOTER in_regola=t consegne_in_corso=t', e
  FROM pg_temp.cambia('e9910000-0000-0000-0000-000000000006',
    $s$rider_vehicle_type = 'SCOOTER', rider_vehicle_plate = 'AB123CD', rider_license_expires_on = '2030-01-01', rider_insurance_expires_on = '2030-01-01'$s$) AS e;
INSERT INTO esiti SELECT '7 durante l''iscrizione mezzo e scadenze si scrivono come prima',
  e LIKE 'righe=1 approvato=f stato=% richiesta=f mezzo=SCOOTER in_regola=f consegne_in_corso=f', e
  FROM pg_temp.cambia('e9910000-0000-0000-0000-00000000000c',
    $s$rider_vehicle_type = 'SCOOTER', rider_license_expires_on = '2030-01-01', rider_insurance_expires_on = '2030-01-01'$s$) AS e;
INSERT INTO passi SELECT 13, pg_temp.cambia('e9910000-0000-0000-0000-00000000000e',
    $s$rider_vehicle_type = 'CAR', rider_license_expires_on = '2030-01-01', rider_insurance_expires_on = '2030-01-01'$s$);
INSERT INTO esiti SELECT '13 da sospeso, auto e due scadenze: in coda, non approvato, l''ordine non lo prende',
  p.e = 'righe=1 approvato=f stato=pending richiesta=t mezzo=CAR in_regola=f consegne_in_corso=f' AND o = 'false',
  p.e || ' · presa ok=' || o
  FROM passi p, pg_temp.prendi('e9910000-0000-0000-0000-00000000000e', 'a9910000-0000-0000-0000-000000000003') AS o
 WHERE p.n = 13;
INSERT INTO esiti SELECT '14 da sospeso con la polizza scaduta, nuova scadenza: in coda per lo staff',
  e = 'righe=1 approvato=f stato=pending richiesta=t mezzo=SCOOTER in_regola=f consegne_in_corso=f', e
  FROM pg_temp.cambia('e9910000-0000-0000-0000-000000000011', $s$rider_insurance_expires_on = '2031-06-30'$s$) AS e;
INSERT INTO esiti SELECT '15 con una consegna ritirata il rinnovo aspetta: resta approvato e la vede',
  f LIKE 'P0001 Finisci prima la consegna%'
    AND (SELECT is_approved AND approval_status = 'approved' AND rider_insurance_expires_on = '2030-01-01'
           FROM public.profiles WHERE id = 'e9910000-0000-0000-0000-00000000000f')
    AND s = 1,
  f || ' · sue=' || s
  FROM pg_temp.frase('e9910000-0000-0000-0000-00000000000f', $s$rider_insurance_expires_on = '2031-06-30'$s$) AS f,
       pg_temp.sue('e9910000-0000-0000-0000-00000000000f') AS s;
INSERT INTO passi SELECT 16, pg_temp.cambia('e9910000-0000-0000-0000-000000000010', $s$rider_insurance_expires_on = '2031-06-30'$s$);
INSERT INTO esiti SELECT '17 dopo il rinnovo la scrittura degli ordini resta chiusa',
  coalesce(current_setting('mycity.allow_order_write', true), '') <> '1',
  coalesce(current_setting('mycity.allow_order_write', true), '(vuota)');
SET LOCAL request.jwt.claims = '{"sub":"e9910000-0000-0000-0000-000000000001","role":"authenticated"}';
INSERT INTO esiti SELECT '9 chi è in coda non si rimette approvato da solo', n = -1, 'righe: ' || n
  FROM pg_temp.prova('e9910000-0000-0000-0000-000000000001', $s$approval_status = 'approved'$s$) AS n;

-- Lo staff, dal browser.
SET LOCAL request.jwt.claims = '{"sub":"e9910000-0000-0000-0000-000000000009","role":"authenticated"}';
CREATE TEMP TABLE staff_esito AS
  SELECT pg_temp.prova('e9910000-0000-0000-0000-000000000007', $s$rider_vehicle_type = 'CAR', rider_license_expires_on = '2030-01-01', rider_insurance_expires_on = '2030-01-01'$s$) AS n;
RESET ROLE;

-- Il server, con la chiave di servizio: un cambio e poi la riapprovazione del fattorino ①.
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims = '{"role":"service_role"}';
CREATE TEMP TABLE servizio_esito AS
  SELECT pg_temp.prova('e9910000-0000-0000-0000-000000000008', $s$rider_vehicle_type = 'SCOOTER', rider_license_expires_on = '2030-01-01', rider_insurance_expires_on = '2030-01-01'$s$) AS n;
UPDATE public.profiles SET approval_status = 'approved', is_approved = true, approved_at = now()
 WHERE id = 'e9910000-0000-0000-0000-000000000001';
RESET ROLE;

INSERT INTO esiti SELECT '8 i cambi dello staff e del server non rimettono in coda',
  s.n = 1 AND v.n = 1
    AND (SELECT bool_and(is_approved AND approval_status = 'approved') FROM public.profiles
          WHERE id IN ('e9910000-0000-0000-0000-000000000007', 'e9910000-0000-0000-0000-000000000008')),
  format('staff %s, servizio %s', s.n, v.n)
  FROM staff_esito s, servizio_esito v;

INSERT INTO esiti SELECT '16 con una consegna solo assegnata: in coda, la consegna torna in bacheca, il negozio avvisato',
  p.e = 'righe=1 approvato=f stato=pending richiesta=t mezzo=SCOOTER in_regola=f consegne_in_corso=f'
    AND (SELECT rider_id IS NULL AND delivery_status = 'READY' FROM public.orders WHERE id = 'a9910000-0000-0000-0000-000000000005')
    AND EXISTS (SELECT 1 FROM public.notifications
                 WHERE user_id = 'e9910000-0000-0000-0000-00000000000a' AND link = '/seller/orders/a9910000-0000-0000-0000-000000000005'),
  p.e || ' · ordine: ' || (SELECT concat_ws(' ', delivery_status, rider_id::text) FROM public.orders WHERE id = 'a9910000-0000-0000-0000-000000000005')
  FROM passi p WHERE p.n = 16;

INSERT INTO esiti SELECT '10 chi è in coda non finisce fra i documenti da potare',
  NOT EXISTS (SELECT 1 FROM public.documenti_iscrizione_a_meta
               WHERE profilo IN ('e9910000-0000-0000-0000-000000000001', 'e9910000-0000-0000-0000-000000000002')),
  '';

SET LOCAL ROLE authenticated;
INSERT INTO esiti SELECT '11 riapprovato dallo staff, prende l''ordine', o = 'true', 'presa ok=' || o
  FROM pg_temp.prendi('e9910000-0000-0000-0000-000000000001', 'a9910000-0000-0000-0000-000000000003') AS o;
RESET ROLE;

DO $$
DECLARE r record; rossi int;
BEGIN
  FOR r IN SELECT * FROM esiti ORDER BY nome LOOP
    RAISE INFO '%  %  — %', CASE WHEN r.ok THEN 'ok  ' ELSE 'ROTTO' END, r.nome, r.dettaglio;
  END LOOP;
  SELECT count(*) INTO rossi FROM esiti WHERE ok IS NOT TRUE;
  IF rossi > 0 OR (SELECT count(*) FROM esiti) <> 16 THEN
    RAISE EXCEPTION '% controlli su % sono rossi (S01-03)', rossi, (SELECT count(*) FROM esiti);
  END IF;
  RAISE INFO 'S01-03: % controlli verdi', (SELECT count(*) FROM esiti);
END $$;
ROLLBACK;

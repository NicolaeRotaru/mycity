-- =============================================================================
-- Il fattorino con patente o assicurazione scaduta non prende ordini (migrazione 190)
-- =============================================================================
-- Gira contro un database ricostruito dalle migrazioni vere:
--   tests/sql/harness/apply.sh mycity_test
--   tests/sql/harness/run.sh   mycity_test
--
--   ① fattorino approvato con la patente scaduta ieri: prendi_ordine() dice
--      DOCUMENTI_SCADUTI e l'ordine resta libero
--   ② stesso fattorino, assegnazione scritta a mano (strada che non passa
--      dalla funzione, anche da staff): rifiutata
--   ③ fattorino con documenti validi fino a oggi compreso: prende l'ordine
--   ④ il fattorino approvato non sposta da solo la scadenza in avanti
--   ⑤ chi non e' ancora approvato (iscrizione) scrive le sue date
--   ⑥ il fattorino scaduto carica la patente nuova e poi salva la data nuova:
--      passa (niente vicolo cieco: si rinnova da solo)
--   ⑦ subito dopo, senza un altro documento, non sposta di nuovo la data
--   ⑧ non scrive a mano il documento a cui la data si riferisce
--
-- Senza la 190 i passi ①, ② e ④ sono rossi; con la 190 che vieta ogni
-- cambio di data dopo l'approvazione il passo ⑥ e' rosso. ROLLBACK finale.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';
SET LOCAL mycity.allow_order_write   = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('11111111-1111-1111-1111-111111111111', 'negozio@test.it',    '{"role":"seller"}'),
  ('22222222-2222-2222-2222-222222222222', 'scaduto@test.it',    '{"role":"rider"}'),
  ('33333333-3333-3333-3333-333333333333', 'cliente@test.it',    '{"role":"buyer"}'),
  ('44444444-4444-4444-4444-444444444444', 'inregola@test.it',   '{"role":"rider"}'),
  ('55555555-5555-5555-5555-555555555555', 'nuovo@test.it',      '{"role":"rider"}');

UPDATE public.profiles
   SET is_approved = true, approval_status = 'approved', store_name = 'Bottega di prova',
       store_address = 'Via Roma 1', store_lat = 45.05, store_lng = 9.69
 WHERE id = '11111111-1111-1111-1111-111111111111';

-- Patente scaduta ieri, polizza valida.
UPDATE public.profiles
   SET is_approved = true, approval_status = 'approved',
       rider_license_expires_on   = (now() AT TIME ZONE 'Europe/Rome')::date - 1,
       rider_insurance_expires_on = (now() AT TIME ZONE 'Europe/Rome')::date + 300
 WHERE id = '22222222-2222-2222-2222-222222222222';

-- Patente valida fino a OGGI compreso, polizza valida.
UPDATE public.profiles
   SET is_approved = true, approval_status = 'approved',
       rider_license_expires_on   = (now() AT TIME ZONE 'Europe/Rome')::date,
       rider_insurance_expires_on = (now() AT TIME ZONE 'Europe/Rome')::date + 300
 WHERE id = '44444444-4444-4444-4444-444444444444';

INSERT INTO public.orders (
  id, user_id, seller_id, total_price, payment_status, delivery_status,
  delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip,
  rider_fee_cents
) VALUES
  ('a0000000-0000-0000-0000-00000000000a',
   '33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111',
   42.00, 'PAID', 'READY', 'Maria Rossi', '3331234567', 'Via Verdi 10', 'Piacenza', '29121', 450),
  ('b0000000-0000-0000-0000-00000000000b',
   '33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111',
   18.00, 'PAID', 'READY', 'Maria Rossi', '3331234567', 'Via Verdi 10', 'Piacenza', '29121', 450);

-- ② Assegnazione scritta a mano, coi permessi di servizio: la cintura la ferma.
DO $$
BEGIN
  BEGIN
    UPDATE public.orders
       SET rider_id = '22222222-2222-2222-2222-222222222222', delivery_status = 'ASSIGNED'
     WHERE id = 'b0000000-0000-0000-0000-00000000000b';
    INSERT INTO esiti VALUES ('assegnazione a mano a fattorino scaduto rifiutata', false, 'l''UPDATE e'' passato');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO esiti VALUES ('assegnazione a mano a fattorino scaduto rifiutata', true, SQLERRM);
  END;
END $$;

-- ① Il fattorino scaduto prova a prendere l'ordine.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

INSERT INTO esiti
SELECT 'prendi_ordine() rifiuta il fattorino con la patente scaduta',
       (r ->> 'ok')::boolean IS FALSE AND (r ->> 'motivo') = 'DOCUMENTI_SCADUTI',
       'risposta: ' || r::text
  FROM (SELECT public.prendi_ordine('a0000000-0000-0000-0000-00000000000a') AS r) t;

-- ④ Senza i permessi di servizio, il fattorino approvato prova a spostare la scadenza.
RESET mycity.allow_profile_write;
SET LOCAL mycity.allow_profile_write = '0';
DO $$
BEGIN
  BEGIN
    UPDATE public.profiles
       SET rider_license_expires_on = (now() AT TIME ZONE 'Europe/Rome')::date + 3650
     WHERE id = '22222222-2222-2222-2222-222222222222';
    INSERT INTO esiti VALUES ('il fattorino approvato non riscrive da solo la scadenza', false,
      'righe cambiate: ' || (SELECT count(*) FROM public.profiles
        WHERE id = '22222222-2222-2222-2222-222222222222'
          AND rider_license_expires_on > (now() AT TIME ZONE 'Europe/Rome')::date));
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO esiti VALUES ('il fattorino approvato non riscrive da solo la scadenza', true, SQLERRM);
  END;
END $$;

-- ⑥ Il fattorino scaduto rinnova: la rotta di caricamento (permessi di servizio)
-- scrive il documento nuovo, poi lui salva la data nuova dal modulo.
DO $$
BEGIN
  PERFORM set_config('mycity.allow_profile_write', '1', true);
  UPDATE public.profiles
     SET rider_license_url = '22222222-2222-2222-2222-222222222222/rider_license-2.jpg'
   WHERE id = '22222222-2222-2222-2222-222222222222';
  PERFORM set_config('mycity.allow_profile_write', '0', true);
  BEGIN
    UPDATE public.profiles
       SET rider_license_expires_on = (now() AT TIME ZONE 'Europe/Rome')::date + 3650
     WHERE id = '22222222-2222-2222-2222-222222222222';
    INSERT INTO esiti SELECT 'col documento nuovo il fattorino salva la scadenza nuova',
      (SELECT rider_license_expires_on > (now() AT TIME ZONE 'Europe/Rome')::date
         FROM public.profiles WHERE id = '22222222-2222-2222-2222-222222222222'),
      'data salvata';
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO esiti VALUES ('col documento nuovo il fattorino salva la scadenza nuova', false, SQLERRM);
  END;
END $$;

-- ⑦ Stesso documento, seconda data: rifiutata.
DO $$
BEGIN
  BEGIN
    UPDATE public.profiles
       SET rider_license_expires_on = (now() AT TIME ZONE 'Europe/Rome')::date + 7000
     WHERE id = '22222222-2222-2222-2222-222222222222';
    INSERT INTO esiti VALUES ('senza un altro documento la data non si sposta di nuovo', false, 'l''UPDATE e'' passato');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO esiti VALUES ('senza un altro documento la data non si sposta di nuovo', true, SQLERRM);
  END;
END $$;

-- ⑧ Il «documento a cui si riferisce la data» non si scrive a mano.
DO $$
BEGIN
  BEGIN
    UPDATE public.profiles
       SET rider_license_expiry_doc = 'falso'
     WHERE id = '22222222-2222-2222-2222-222222222222';
    INSERT INTO esiti VALUES ('il fattorino non scrive a mano il documento della data', false, 'l''UPDATE e'' passato');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO esiti VALUES ('il fattorino non scrive a mano il documento della data', true, SQLERRM);
  WHEN undefined_column THEN
    INSERT INTO esiti VALUES ('il fattorino non scrive a mano il documento della data', false, SQLERRM);
  END;
END $$;

-- ⑤ Chi si sta iscrivendo (non approvato) scrive le sue date.
SET LOCAL request.jwt.claims = '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated"}';
DO $$
BEGIN
  UPDATE public.profiles
     SET rider_license_expires_on = DATE '2030-01-31', rider_insurance_expires_on = DATE '2030-06-30'
   WHERE id = '55555555-5555-5555-5555-555555555555';
  INSERT INTO esiti VALUES ('chi si iscrive scrive le sue scadenze', true, 'scritte');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO esiti VALUES ('chi si iscrive scrive le sue scadenze', false, SQLERRM);
END $$;

-- ③ Il fattorino in regola fino a oggi prende l'ordine.
SET LOCAL request.jwt.claims = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';

INSERT INTO esiti
SELECT 'il fattorino coi documenti validi fino a oggi prende l''ordine',
       (r ->> 'ok')::boolean IS TRUE,
       'risposta: ' || r::text
  FROM (SELECT public.prendi_ordine('a0000000-0000-0000-0000-00000000000a') AS r) t;

RESET ROLE;

SELECT nome, CASE WHEN ok THEN 'ok' ELSE 'ROTTO' END AS esito, dettaglio FROM esiti ORDER BY nome;

DO $$
DECLARE r record; n int;
BEGIN
  FOR r IN SELECT * FROM esiti ORDER BY nome LOOP
    RAISE INFO '% % — %', CASE WHEN r.ok THEN '✓' ELSE '✗' END, r.nome, r.dettaglio;
  END LOOP;
  SELECT count(*) INTO n FROM esiti WHERE ok IS NOT TRUE;
  IF n > 0 THEN
    RAISE EXCEPTION '% controlli rossi', n;
  END IF;
END $$;

ROLLBACK;

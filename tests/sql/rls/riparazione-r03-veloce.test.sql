-- =============================================================================
-- R03-012 — Due veloci vendute nello stesso istante con un solo fattorino (840)
-- =============================================================================
-- Un fattorino solo, acceso e libero. Due clienti premono «Adesso» in contanti:
-- la rotta legge per tutti e due «un fattorino libero» prima di inserire, quindi
-- l'ultima parola è del database, che mette in fila le veloci e ferma la seconda.
--   ① la prima veloce in contanti nasce;
--   ② la seconda, di un altro cliente, si ferma: 23514 col segno
--     `veloce_senza_fattorino_libero` (la rotta lo trasforma nel 409);
--   ③ un ordine NON veloce passa come prima, anche col fattorino occupato;
--   ④ il secondo negozio dello stesso carrello veloce passa (stessa porta);
--   ⑤ con un secondo fattorino acceso la veloce dell'altro cliente nasce;
--   ⑥ una veloce pagata con la carta non si ferma mai (nasce dopo il pagamento);
--   ⑦ con due fattorini e tre consegne in corso la quarta si ferma;
--   ⑧ le veloci nate più di 3 ore fa (dimenticate) non contano più.
-- Tutto in transazione, ROLLBACK.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';
SET LOCAL mycity.allow_order_write   = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated;

INSERT INTO auth.users (id, email, raw_user_meta_data, email_confirmed_at) VALUES
  ('e8400000-0000-0000-0000-000000000001', 'forno-840@test.it',     '{"role":"seller"}', now()),
  ('e8400000-0000-0000-0000-000000000002', 'fiori-840@test.it',     '{"role":"seller"}', now()),
  ('e8400000-0000-0000-0000-000000000011', 'fattorino1-840@test.it', '{"role":"rider"}',  now()),
  ('e8400000-0000-0000-0000-000000000012', 'fattorino2-840@test.it', '{"role":"rider"}',  now()),
  ('e8400000-0000-0000-0000-000000000021', 'anna-840@test.it',      '{"role":"buyer"}',  now()),
  ('e8400000-0000-0000-0000-000000000022', 'bruno-840@test.it',     '{"role":"buyer"}',  now()),
  ('e8400000-0000-0000-0000-000000000023', 'carla-840@test.it',     '{"role":"buyer"}',  now()),
  ('e8400000-0000-0000-0000-000000000024', 'dario-840@test.it',     '{"role":"buyer"}',  now());

UPDATE public.profiles
   SET is_approved = true, approval_status = 'approved', store_name = 'Negozio 840', store_address = 'Via Roma 1, Piacenza'
 WHERE id IN ('e8400000-0000-0000-0000-000000000001', 'e8400000-0000-0000-0000-000000000002');

-- Nessun altro fattorino acceso: qui conta solo il nostro.
UPDATE public.profiles SET rider_is_online = false WHERE role = 'rider';
UPDATE public.profiles
   SET is_approved = true, approval_status = 'approved', rider_is_online = true
 WHERE id = 'e8400000-0000-0000-0000-000000000011';
UPDATE public.profiles
   SET is_approved = true, approval_status = 'approved', rider_is_online = false
 WHERE id = 'e8400000-0000-0000-0000-000000000012';

-- Un ordine in contanti come lo scrive la rotta. Risponde se è nato, o il codice e il segno del rifiuto.
CREATE FUNCTION pg_temp.prova_ordine(p_id uuid, p_cliente uuid, p_negozio uuid, p_fascia text, p_pagamento text)
RETURNS text
LANGUAGE plpgsql AS $$
DECLARE stato text; segno text;
BEGIN
  INSERT INTO public.orders (id, user_id, seller_id, total_price, gross_total_cents, payment_method, payment_status,
    delivery_status, pickup_in_store, delivery_slot, delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip)
  VALUES (p_id, p_cliente, p_negozio, 10, 1000, p_pagamento,
    CASE WHEN p_pagamento = 'card' THEN 'PAID' ELSE 'PENDING' END,
    'NEW', false, p_fascia, 'Cliente 840', '3', 'Via Verdi 1', 'Piacenza', '29121');
  RETURN 'nato';
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS stato = RETURNED_SQLSTATE, segno = PG_EXCEPTION_HINT;
  RETURN 'fermo ' || stato || ' ' || coalesce(segno, '');
END;
$$;

CREATE TEMP TABLE prove (passo text, esito text) ON COMMIT DROP;

-- ① Anna, veloce in contanti, il fattorino è libero.
INSERT INTO prove SELECT '1', pg_temp.prova_ordine('e8400000-0000-0000-0000-0000000000a1',
  'e8400000-0000-0000-0000-000000000021', 'e8400000-0000-0000-0000-000000000001', 'Adesso · arrivo in 30-60 min', 'cod');
-- ② Bruno, nello stesso istante, veloce in contanti: il fattorino è già di Anna.
INSERT INTO prove SELECT '2', pg_temp.prova_ordine('e8400000-0000-0000-0000-0000000000b1',
  'e8400000-0000-0000-0000-000000000022', 'e8400000-0000-0000-0000-000000000001', 'Adesso · arrivo in 30-60 min', 'cod');
-- ③ Bruno ripiega su una fascia: non è una veloce, passa come prima.
INSERT INTO prove SELECT '3', pg_temp.prova_ordine('e8400000-0000-0000-0000-0000000000b2',
  'e8400000-0000-0000-0000-000000000022', 'e8400000-0000-0000-0000-000000000001', 'Oggi · 13:00–16:30', 'cod');
-- ④ Il secondo negozio del carrello di Anna.
INSERT INTO prove SELECT '4', pg_temp.prova_ordine('e8400000-0000-0000-0000-0000000000a2',
  'e8400000-0000-0000-0000-000000000021', 'e8400000-0000-0000-0000-000000000002', 'Adesso · arrivo in 30-60 min', 'cod');
-- ⑤ Si accende un secondo fattorino: la veloce di Bruno nasce.
UPDATE public.profiles SET rider_is_online = true WHERE id = 'e8400000-0000-0000-0000-000000000012';
INSERT INTO prove SELECT '5', pg_temp.prova_ordine('e8400000-0000-0000-0000-0000000000b3',
  'e8400000-0000-0000-0000-000000000022', 'e8400000-0000-0000-0000-000000000001', 'Adesso · arrivo in 30-60 min', 'cod');
-- ⑥ Carla paga la veloce con la carta: nasce nel webhook dopo il pagamento, non si ferma.
INSERT INTO prove SELECT '6', pg_temp.prova_ordine('e8400000-0000-0000-0000-0000000000c1',
  'e8400000-0000-0000-0000-000000000023', 'e8400000-0000-0000-0000-000000000001', 'Adesso · arrivo in 30-60 min', 'card');
-- ⑦ Dario, veloce in contanti: due fattorini, tre consegne in corso (Anna, Bruno, Carla).
INSERT INTO prove SELECT '7', pg_temp.prova_ordine('e8400000-0000-0000-0000-0000000000d1',
  'e8400000-0000-0000-0000-000000000024', 'e8400000-0000-0000-0000-000000000001', 'Adesso · arrivo in 30-60 min', 'cod');
-- ⑧ Le veloci di prima sono nate più di 3 ore fa e nessuno le ha chiuse: dimenticate, non contano.
UPDATE public.orders SET created_at = now() - interval '4 hours'
 WHERE id IN ('e8400000-0000-0000-0000-0000000000a1', 'e8400000-0000-0000-0000-0000000000a2',
              'e8400000-0000-0000-0000-0000000000b3', 'e8400000-0000-0000-0000-0000000000c1');
INSERT INTO prove SELECT '8', pg_temp.prova_ordine('e8400000-0000-0000-0000-0000000000d2',
  'e8400000-0000-0000-0000-000000000024', 'e8400000-0000-0000-0000-000000000001', 'Adesso · arrivo in 30-60 min', 'cod');

INSERT INTO esiti SELECT '① la prima veloce in contanti nasce', esito = 'nato', esito FROM prove WHERE passo = '1';
INSERT INTO esiti SELECT '② la seconda veloce di un altro cliente si ferma, col segno per la rotta',
  esito = 'fermo 23514 veloce_senza_fattorino_libero', esito FROM prove WHERE passo = '2';
INSERT INTO esiti SELECT '② e la sua riga non c è', NOT EXISTS (SELECT 1 FROM public.orders WHERE id = 'e8400000-0000-0000-0000-0000000000b1'), '' ;
INSERT INTO esiti SELECT '③ un ordine non veloce passa come prima, col fattorino occupato', esito = 'nato', esito FROM prove WHERE passo = '3';
INSERT INTO esiti SELECT '④ il secondo negozio dello stesso carrello veloce passa', esito = 'nato', esito FROM prove WHERE passo = '4';
INSERT INTO esiti SELECT '⑤ con un secondo fattorino acceso la veloce nasce', esito = 'nato', esito FROM prove WHERE passo = '5';
INSERT INTO esiti SELECT '⑥ la veloce pagata con la carta non si ferma', esito = 'nato', esito FROM prove WHERE passo = '6';
INSERT INTO esiti SELECT '⑦ due fattorini, tre consegne in corso: la quarta si ferma',
  esito = 'fermo 23514 veloce_senza_fattorino_libero', esito FROM prove WHERE passo = '7';
INSERT INTO esiti SELECT '⑧ le veloci di più di 3 ore fa non contano', esito = 'nato', esito FROM prove WHERE passo = '8';
INSERT INTO esiti SELECT 'otto passi provati', count(*) = 8, count(*) || ' passi' FROM prove;

DO $$
DECLARE r record; rossi int;
BEGIN
  FOR r IN SELECT * FROM esiti ORDER BY nome LOOP
    RAISE INFO '%  %  — %', CASE WHEN r.ok THEN 'ok  ' ELSE 'ROTTO' END, r.nome, r.dettaglio;
  END LOOP;
  SELECT count(*) INTO rossi FROM esiti WHERE ok IS NOT TRUE;
  IF rossi > 0 THEN
    RAISE EXCEPTION '% controlli rossi in questo file', rossi;
  END IF;
END $$;

ROLLBACK;

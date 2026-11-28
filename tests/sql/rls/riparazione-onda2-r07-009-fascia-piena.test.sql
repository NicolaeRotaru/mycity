-- =============================================================================
-- R07-009 (onda 2) — La fascia piena ferma i contanti anche insieme (999s)
-- =============================================================================
-- Al massimo 5 giri per fascia (ORDINI_PER_FASCIA). La rotta dei contanti conta
-- prima di inserire; due invii nello stesso istante leggerebbero tutti e due «c'è
-- posto», quindi l'ultima parola è del database, che mette in fila gli ordini in
-- contanti con una fascia e ferma quello di troppo.
--   ① cinque clienti diversi, in contanti, nella stessa fascia: nascono tutti;
--   ② il sesto cliente si ferma: 23514 col segno `fascia_piena` (la rotta → 409);
--   ③ il secondo negozio del carrello di Anna, allo stesso indirizzo, passa;
--   ④ Anna a un altro indirizzo è un altro giro: si ferma;
--   ⑤ la fascia accanto (11:00–13:00, non si sovrappone) è libera;
--   ⑥ un ordine pagato con la carta non si ferma mai (nasce dopo il pagamento);
--   ⑦ una fascia di prima che si sovrappone (9:00–12:00) conta la piena: si ferma;
--   ⑧ due ordini annullati liberano posto: il settimo cliente nasce;
--   ⑨ il ritiro in negozio non chiede un giro: passa.
-- Tutto in transazione, ROLLBACK.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';
SET LOCAL mycity.allow_order_write   = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated;

INSERT INTO auth.users (id, email, raw_user_meta_data, email_confirmed_at) VALUES
  ('f1009000-0000-0000-0000-000000000001', 'forno-f1@test.it',  '{"role":"seller"}', now()),
  ('f1009000-0000-0000-0000-000000000002', 'fiori-f1@test.it',  '{"role":"seller"}', now()),
  ('f1009000-0000-0000-0000-000000000021', 'anna-f1@test.it',   '{"role":"buyer"}',  now()),
  ('f1009000-0000-0000-0000-000000000022', 'bruno-f1@test.it',  '{"role":"buyer"}',  now()),
  ('f1009000-0000-0000-0000-000000000023', 'carla-f1@test.it',  '{"role":"buyer"}',  now()),
  ('f1009000-0000-0000-0000-000000000024', 'dario-f1@test.it',  '{"role":"buyer"}',  now()),
  ('f1009000-0000-0000-0000-000000000025', 'elena-f1@test.it',  '{"role":"buyer"}',  now()),
  ('f1009000-0000-0000-0000-000000000026', 'fabio-f1@test.it',  '{"role":"buyer"}',  now()),
  ('f1009000-0000-0000-0000-000000000027', 'gina-f1@test.it',   '{"role":"buyer"}',  now()),
  ('f1009000-0000-0000-0000-000000000028', 'ugo-f1@test.it',    '{"role":"buyer"}',  now());

UPDATE public.profiles
   SET is_approved = true, approval_status = 'approved', store_name = 'Negozio F1', store_address = 'Via Roma 1, Piacenza'
 WHERE id IN ('f1009000-0000-0000-0000-000000000001', 'f1009000-0000-0000-0000-000000000002');

-- Un ordine come lo scrive la rotta. Risponde se è nato, o il codice e il segno del rifiuto.
CREATE FUNCTION pg_temp.prova_ordine(p_id uuid, p_cliente uuid, p_negozio uuid, p_fascia text, p_pagamento text,
  p_indirizzo text DEFAULT 'Via Verdi 1', p_ritiro boolean DEFAULT false)
RETURNS text
LANGUAGE plpgsql AS $$
DECLARE stato text; segno text;
BEGIN
  INSERT INTO public.orders (id, user_id, seller_id, total_price, gross_total_cents, payment_method, payment_status,
    delivery_status, pickup_in_store, delivery_slot, delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip)
  VALUES (p_id, p_cliente, p_negozio, 10, 1000, p_pagamento,
    CASE WHEN p_pagamento = 'card' THEN 'PAID' ELSE 'PENDING' END,
    'NEW', p_ritiro, CASE WHEN p_ritiro THEN NULL ELSE p_fascia END, 'Cliente F1', '3', p_indirizzo, 'Piacenza', '29121');
  RETURN 'nato';
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS stato = RETURNED_SQLSTATE, segno = PG_EXCEPTION_HINT;
  RETURN 'fermo ' || stato || ' ' || coalesce(segno, '');
END;
$$;

CREATE TEMP TABLE prove (passo text, esito text) ON COMMIT DROP;

-- ① Cinque clienti, cinque porte, «Domani · 9:00–11:00» in contanti.
INSERT INTO prove SELECT '1a', pg_temp.prova_ordine('f1009000-0000-0000-0000-0000000000a1',
  'f1009000-0000-0000-0000-000000000021', 'f1009000-0000-0000-0000-000000000001', 'Domani · 9:00–11:00', 'cod');
INSERT INTO prove SELECT '1b', pg_temp.prova_ordine('f1009000-0000-0000-0000-0000000000b1',
  'f1009000-0000-0000-0000-000000000022', 'f1009000-0000-0000-0000-000000000001', 'Domani · 9:00–11:00', 'cod', 'Via Bianchi 2');
INSERT INTO prove SELECT '1c', pg_temp.prova_ordine('f1009000-0000-0000-0000-0000000000c1',
  'f1009000-0000-0000-0000-000000000023', 'f1009000-0000-0000-0000-000000000001', 'Domani · 9:00–11:00', 'cod', 'Via Neri 3');
INSERT INTO prove SELECT '1d', pg_temp.prova_ordine('f1009000-0000-0000-0000-0000000000d1',
  'f1009000-0000-0000-0000-000000000024', 'f1009000-0000-0000-0000-000000000001', 'Domani · 9:00–11:00', 'cod', 'Via Gialli 4');
INSERT INTO prove SELECT '1e', pg_temp.prova_ordine('f1009000-0000-0000-0000-0000000000e1',
  'f1009000-0000-0000-0000-000000000025', 'f1009000-0000-0000-0000-000000000001', 'Domani · 9:00–11:00', 'cod', 'Via Rosa 5');
-- ② Fabio, sesto cliente, stessa fascia.
INSERT INTO prove SELECT '2', pg_temp.prova_ordine('f1009000-0000-0000-0000-0000000000f1',
  'f1009000-0000-0000-0000-000000000026', 'f1009000-0000-0000-0000-000000000001', 'Domani · 9:00–11:00', 'cod', 'Via Blu 6');
-- ③ Il secondo negozio del carrello di Anna: stesso indirizzo, scritto con maiuscole e spazi diversi.
INSERT INTO prove SELECT '3', pg_temp.prova_ordine('f1009000-0000-0000-0000-0000000000a2',
  'f1009000-0000-0000-0000-000000000021', 'f1009000-0000-0000-0000-000000000002', 'Domani · 9:00–11:00', 'cod', '  via  verdi 1 ');
-- ④ Anna, un altro carrello a un altro indirizzo: un altro giro.
INSERT INTO prove SELECT '4', pg_temp.prova_ordine('f1009000-0000-0000-0000-0000000000a3',
  'f1009000-0000-0000-0000-000000000021', 'f1009000-0000-0000-0000-000000000001', 'Domani · 9:00–11:00', 'cod', 'Via Lontana 99');
-- ⑤ Fabio ripiega sulla fascia accanto.
INSERT INTO prove SELECT '5', pg_temp.prova_ordine('f1009000-0000-0000-0000-0000000000f2',
  'f1009000-0000-0000-0000-000000000026', 'f1009000-0000-0000-0000-000000000001', 'Domani · 11:00–13:00', 'cod', 'Via Blu 6');
-- ⑥ Gina paga con la carta nella fascia piena: nasce nel webhook dopo il pagamento, non si ferma.
INSERT INTO prove SELECT '6', pg_temp.prova_ordine('f1009000-0000-0000-0000-00000000009a',
  'f1009000-0000-0000-0000-000000000027', 'f1009000-0000-0000-0000-000000000001', 'Domani · 9:00–11:00', 'card', 'Via Viola 7');
-- ⑦ Ugo, una cassa aperta da prima: «Domani · 9:00–12:00» si sovrappone alla 9:00–11:00 piena.
INSERT INTO prove SELECT '7', pg_temp.prova_ordine('f1009000-0000-0000-0000-00000000008a',
  'f1009000-0000-0000-0000-000000000028', 'f1009000-0000-0000-0000-000000000001', 'Domani · 9:00–12:00', 'cod', 'Via Grigi 8');
-- ⑧ Bruno e Carla annullano: restano Anna, Dario, Elena e Gina (4 porte). Ugo nasce.
UPDATE public.orders SET delivery_status = 'CANCELED'
 WHERE id IN ('f1009000-0000-0000-0000-0000000000b1', 'f1009000-0000-0000-0000-0000000000c1');
INSERT INTO prove SELECT '8', pg_temp.prova_ordine('f1009000-0000-0000-0000-00000000008b',
  'f1009000-0000-0000-0000-000000000028', 'f1009000-0000-0000-0000-000000000001', 'Domani · 9:00–11:00', 'cod', 'Via Grigi 8');
-- ⑨ Fabio ritira in negozio: nessun giro.
INSERT INTO prove SELECT '9', pg_temp.prova_ordine('f1009000-0000-0000-0000-0000000000f3',
  'f1009000-0000-0000-0000-000000000026', 'f1009000-0000-0000-0000-000000000001', 'Domani · 9:00–11:00', 'cod', 'Via Blu 6', true);

INSERT INTO esiti SELECT '① cinque porte diverse nella stessa fascia nascono', bool_and(esito = 'nato'), string_agg(esito, ', ')
  FROM prove WHERE passo LIKE '1%';
INSERT INTO esiti SELECT '② il sesto giro si ferma, col segno per la rotta',
  esito = 'fermo 23514 fascia_piena', esito FROM prove WHERE passo = '2';
INSERT INTO esiti SELECT '② e la sua riga non c è', NOT EXISTS (SELECT 1 FROM public.orders WHERE id = 'f1009000-0000-0000-0000-0000000000f1'), '';
INSERT INTO esiti SELECT '③ il secondo negozio dello stesso carrello, stesso indirizzo, passa', esito = 'nato', esito FROM prove WHERE passo = '3';
INSERT INTO esiti SELECT '④ lo stesso cliente a un altro indirizzo è un altro giro: si ferma',
  esito = 'fermo 23514 fascia_piena', esito FROM prove WHERE passo = '4';
INSERT INTO esiti SELECT '⑤ la fascia accanto non si sovrappone: è libera', esito = 'nato', esito FROM prove WHERE passo = '5';
INSERT INTO esiti SELECT '⑥ la carta non si ferma mai', esito = 'nato', esito FROM prove WHERE passo = '6';
INSERT INTO esiti SELECT '⑦ una fascia di prima che si sovrappone alla piena si ferma',
  esito = 'fermo 23514 fascia_piena', esito FROM prove WHERE passo = '7';
INSERT INTO esiti SELECT '⑧ gli annullati liberano posto', esito = 'nato', esito FROM prove WHERE passo = '8';
INSERT INTO esiti SELECT '⑨ il ritiro in negozio passa', esito = 'nato', esito FROM prove WHERE passo = '9';
INSERT INTO esiti SELECT 'tredici passi provati', count(*) = 13, count(*) || ' passi' FROM prove;

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

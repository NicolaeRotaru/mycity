-- =============================================================================
-- R27 — La merce riservata dalla cassa in contanti resta scritta finche'
-- l'ordine non la prende, e il giro la rimette se la funzione e' morta in mezzo.
-- =============================================================================
--   tests/sql/harness/apply.sh mycity_test && tests/sql/harness/run.sh mycity_test
--
-- La cassa scala la merce e toglie il credito PRIMA di scrivere l'ordine, e
-- scrive gli articoli DOPO. Qui si rifanno a mano i passi della rotta e la si
-- «uccide» in tre punti diversi, poi si fa girare il giro:
-- ① la merce che non basta non lascia nessuna riserva scritta (tutto o niente)
-- ② morta prima dell'ordine: la merce torna a scaffale e il credito torna al cliente
-- ③ morta fra l'ordine e gli articoli: la merce torna; il credito resta all'ordine
--   (lo ridà chi lo annulla), quindi il giro non lo tocca
-- ④ morta dopo gli articoli: la merce e' dell'ordine, il giro chiude la riga e
--   non rimette niente (niente pezzi fantasma)
-- ⑤ una riserva giovane (una cassa ancora al lavoro) non si tocca
-- ⑥ la rotta che rende la merce due volte la rimette una volta sola
-- ⑦ nessun client puo' chiamare le funzioni nuove ne' leggere le riserve
-- ⑧ la cassa che arriva in fondo chiude la riga e la merce resta all'ordine
-- Transazione con ROLLBACK: non lascia dati.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';
SET LOCAL mycity.allow_order_write   = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('27000000-0000-4000-8000-000000000001', 'forno-r27@test.it', '{"role":"seller"}'),
  ('27000000-0000-4000-8000-000000000002', 'cliente-r27@test.it', '{"role":"buyer"}');

UPDATE public.profiles
   SET is_approved = true, approval_status = 'approved', store_name = 'Forno R27'
 WHERE id = '27000000-0000-4000-8000-000000000001';

UPDATE public.profiles SET wallet_balance_cents = 1000
 WHERE id = '27000000-0000-4000-8000-000000000002';

INSERT INTO public.products (id, seller_id, name, price, stock, status) VALUES
  ('27000000-0000-4000-8000-0000000000a1', '27000000-0000-4000-8000-000000000001', 'Pane',     4.00, 10, 'available'),
  ('27000000-0000-4000-8000-0000000000a2', '27000000-0000-4000-8000-000000000001', 'Focaccia', 5.00, 10, 'available'),
  ('27000000-0000-4000-8000-0000000000a3', '27000000-0000-4000-8000-000000000001', 'Grissini', 3.00, 10, 'available'),
  ('27000000-0000-4000-8000-0000000000a4', '27000000-0000-4000-8000-000000000001', 'Torta',    9.00, 10, 'available'),
  ('27000000-0000-4000-8000-0000000000a5', '27000000-0000-4000-8000-000000000001', 'Biscotti', 6.00, 10, 'available');

-- ① La merce non basta: la riserva scritta non resta.
DO $$
DECLARE n bigint; errore text := '';
BEGIN
  BEGIN
    PERFORM public.reserve_stock(
      '[{"product_id":"27000000-0000-4000-8000-0000000000a1","variant_id":null,"qty":99}]'::jsonb,
      '{"id":"27000000-0000-4000-8000-0000000000b0","order_id":"27000000-0000-4000-8000-0000000000c0","user_id":"27000000-0000-4000-8000-000000000002","wallet_ref":null}'::jsonb);
  EXCEPTION WHEN check_violation THEN errore := SQLERRM;
  END;
  SELECT count(*) INTO n FROM private.riserve_merce_contanti WHERE id = '27000000-0000-4000-8000-0000000000b0';
  INSERT INTO esiti VALUES ('① la merce che non basta non lascia una riserva scritta',
    n = 0 AND errore LIKE 'OUT_OF_STOCK%', 'righe: ' || n || ', errore: ' || errore);
END $$;

-- ② Morta dopo la riserva e la spesa del credito, prima dell'ordine.
SELECT public.reserve_stock(
  '[{"product_id":"27000000-0000-4000-8000-0000000000a1","variant_id":null,"qty":2}]'::jsonb,
  '{"id":"27000000-0000-4000-8000-0000000000b1","order_id":"27000000-0000-4000-8000-0000000000c1","user_id":"27000000-0000-4000-8000-000000000002","wallet_ref":"27000000-0000-4000-8000-0000000000c1:spesa-1"}'::jsonb);
SELECT public.wallet_debit('27000000-0000-4000-8000-000000000002', 400, 'order_cod', '27000000-0000-4000-8000-0000000000c1:spesa-1');

-- ③ Morta fra l'ordine e gli articoli (l'ordine porta il suo credito scomputato).
SELECT public.reserve_stock(
  '[{"product_id":"27000000-0000-4000-8000-0000000000a2","variant_id":null,"qty":3}]'::jsonb,
  '{"id":"27000000-0000-4000-8000-0000000000b2","order_id":"27000000-0000-4000-8000-0000000000c2","user_id":"27000000-0000-4000-8000-000000000002","wallet_ref":"27000000-0000-4000-8000-0000000000c2:spesa-2"}'::jsonb);
SELECT public.wallet_debit('27000000-0000-4000-8000-000000000002', 300, 'order_cod', '27000000-0000-4000-8000-0000000000c2:spesa-2');
INSERT INTO public.orders (
  id, user_id, seller_id, total_price, wallet_applied_cents,
  payment_method, payment_status, delivery_status, payout_status,
  delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip
) VALUES (
  '27000000-0000-4000-8000-0000000000c2', '27000000-0000-4000-8000-000000000002', '27000000-0000-4000-8000-000000000001',
  12.00, 300, 'cod', 'PENDING', 'NEW', 'AWAITING_REMITTANCE',
  'Maria Rossi', '3331234567', 'Via Emilia 1', 'Piacenza', '29121'
);

-- ④ Morta dopo gli articoli, prima di togliere la riga.
SELECT public.reserve_stock(
  '[{"product_id":"27000000-0000-4000-8000-0000000000a3","variant_id":null,"qty":1}]'::jsonb,
  '{"id":"27000000-0000-4000-8000-0000000000b3","order_id":"27000000-0000-4000-8000-0000000000c3","user_id":"27000000-0000-4000-8000-000000000002","wallet_ref":null}'::jsonb);
INSERT INTO public.orders (
  id, user_id, seller_id, total_price, payment_method, payment_status, delivery_status, payout_status,
  delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip
) VALUES (
  '27000000-0000-4000-8000-0000000000c3', '27000000-0000-4000-8000-000000000002', '27000000-0000-4000-8000-000000000001',
  3.00, 'cod', 'PENDING', 'NEW', 'AWAITING_REMITTANCE',
  'Maria Rossi', '3331234567', 'Via Emilia 1', 'Piacenza', '29121'
);
INSERT INTO public.order_items (order_id, product_id, quantity, unit_price)
VALUES ('27000000-0000-4000-8000-0000000000c3', '27000000-0000-4000-8000-0000000000a3', 1, 3.00);

-- ⑤ Una cassa ancora al lavoro.
SELECT public.reserve_stock(
  '[{"product_id":"27000000-0000-4000-8000-0000000000a4","variant_id":null,"qty":1}]'::jsonb,
  '{"id":"27000000-0000-4000-8000-0000000000b4","order_id":"27000000-0000-4000-8000-0000000000c4","user_id":"27000000-0000-4000-8000-000000000002","wallet_ref":null}'::jsonb);

-- Le prime tre sono di tre ore fa: piu' vecchie di qualunque funzione viva.
UPDATE private.riserve_merce_contanti SET created_at = now() - interval '3 hours'
 WHERE id IN ('27000000-0000-4000-8000-0000000000b1', '27000000-0000-4000-8000-0000000000b2', '27000000-0000-4000-8000-0000000000b3');

-- Il giro, con la soglia della rotta (due ore).
CREATE TEMP TABLE giro ON COMMIT DROP AS SELECT public.libera_riserve_orfane(120) AS liberate;

DO $$
DECLARE s int; w int; n bigint; l int;
BEGIN
  SELECT liberate INTO l FROM giro;
  INSERT INTO esiti VALUES ('④bis il giro conta le riserve che ha liberato (due)', l = 2, 'liberate: ' || l);

  SELECT stock INTO s FROM public.products WHERE id = '27000000-0000-4000-8000-0000000000a1';
  INSERT INTO esiti VALUES ('② morta prima dell''ordine: il pane torna a scaffale', s = 10, 'stock: ' || s);

  SELECT stock INTO s FROM public.products WHERE id = '27000000-0000-4000-8000-0000000000a2';
  INSERT INTO esiti VALUES ('③ morta fra l''ordine e gli articoli: la focaccia torna a scaffale', s = 10, 'stock: ' || s);

  -- 1000 - 400 (②, ridati dal giro) - 300 (③, restano all'ordine) = 700
  SELECT wallet_balance_cents INTO w FROM public.profiles WHERE id = '27000000-0000-4000-8000-000000000002';
  INSERT INTO esiti VALUES ('②③ il credito dell''ordine mai nato torna, quello dell''ordine nato resta a lui', w = 700, 'saldo: ' || w);

  SELECT stock INTO s FROM public.products WHERE id = '27000000-0000-4000-8000-0000000000a3';
  SELECT count(*) INTO n FROM private.riserve_merce_contanti WHERE id = '27000000-0000-4000-8000-0000000000b3';
  INSERT INTO esiti VALUES ('④ morta dopo gli articoli: la merce resta all''ordine e la riga si chiude', s = 9 AND n = 0, 'stock: ' || s || ', righe: ' || n);

  SELECT stock INTO s FROM public.products WHERE id = '27000000-0000-4000-8000-0000000000a4';
  SELECT count(*) INTO n FROM private.riserve_merce_contanti WHERE id = '27000000-0000-4000-8000-0000000000b4';
  INSERT INTO esiti VALUES ('⑤ la riserva di una cassa ancora al lavoro non si tocca', s = 9 AND n = 1, 'stock: ' || s || ', righe: ' || n);
END $$;

-- Un secondo giro non rimette niente un'altra volta.
SELECT public.libera_riserve_orfane(120);

-- ⑧ La cassa che arriva in fondo chiude la riga: la merce resta all'ordine anche dopo il giro.
SELECT public.reserve_stock(
  '[{"product_id":"27000000-0000-4000-8000-0000000000a4","variant_id":null,"qty":2}]'::jsonb,
  '{"id":"27000000-0000-4000-8000-0000000000b6","order_id":"27000000-0000-4000-8000-0000000000c6","user_id":"27000000-0000-4000-8000-000000000002","wallet_ref":null}'::jsonb);
SELECT public.chiudi_riserva_contanti('27000000-0000-4000-8000-0000000000b6'::uuid);

-- ⑥ La rotta rende la merce di un gruppo andato male: due volte di fila, una sola conta.
SELECT public.reserve_stock(
  '[{"product_id":"27000000-0000-4000-8000-0000000000a5","variant_id":null,"qty":4}]'::jsonb,
  '{"id":"27000000-0000-4000-8000-0000000000b5","order_id":"27000000-0000-4000-8000-0000000000c5","user_id":"27000000-0000-4000-8000-000000000002","wallet_ref":null}'::jsonb);
SELECT public.restore_stock('[{"product_id":"27000000-0000-4000-8000-0000000000a5","variant_id":null,"qty":4}]'::jsonb, '27000000-0000-4000-8000-0000000000b5'::uuid);
SELECT public.restore_stock('[{"product_id":"27000000-0000-4000-8000-0000000000a5","variant_id":null,"qty":4}]'::jsonb, '27000000-0000-4000-8000-0000000000b5'::uuid);

DO $$
DECLARE s int; w int; n bigint;
BEGIN
  SELECT stock INTO s FROM public.products WHERE id = '27000000-0000-4000-8000-0000000000a1';
  SELECT wallet_balance_cents INTO w FROM public.profiles WHERE id = '27000000-0000-4000-8000-000000000002';
  INSERT INTO esiti VALUES ('②bis il secondo giro non ridà merce ne'' credito', s = 10 AND w = 700, 'stock: ' || s || ', saldo: ' || w);

  SELECT stock INTO s FROM public.products WHERE id = '27000000-0000-4000-8000-0000000000a5';
  INSERT INTO esiti VALUES ('⑥ la merce resa due volte torna una volta sola', s = 10, 'stock: ' || s);

  SELECT count(*) INTO n FROM private.riserve_merce_contanti WHERE id = '27000000-0000-4000-8000-0000000000b6';
  SELECT stock INTO s FROM public.products WHERE id = '27000000-0000-4000-8000-0000000000a4';
  INSERT INTO esiti VALUES ('⑧ la riga chiusa dalla cassa non c''e'' piu'' e la merce resta all''ordine', n = 0 AND s = 7, 'righe: ' || n || ', stock: ' || s);

  INSERT INTO esiti VALUES ('⑦ nessun client chiama le funzioni nuove',
    NOT has_function_privilege('anon', 'public.reserve_stock(jsonb, jsonb)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.reserve_stock(jsonb, jsonb)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.restore_stock(jsonb, uuid)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.restore_stock(jsonb, uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.chiudi_riserva_contanti(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.chiudi_riserva_contanti(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.libera_riserve_orfane(int)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.libera_riserve_orfane(int)', 'EXECUTE')
    AND NOT has_table_privilege('anon', 'private.riserve_merce_contanti', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'private.riserve_merce_contanti', 'SELECT'),
    'anon e authenticated senza EXECUTE sulle funzioni e senza lettura della tabella');
END $$;

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

-- =============================================================================
-- Il traguardo «Top rated» del venditore conta anche le recensioni al negozio
-- =============================================================================
-- Gira dopo tests/sql/harness/apply.sh. Transazione con ROLLBACK finale.
--
-- Il traguardo `seller_top_rated` («Rating medio 4.5+ su almeno 10 recensioni»)
-- guardava solo le recensioni ai PRODOTTI del venditore (`reviews`), mai quelle
-- al NEGOZIO (`store_reviews`), e il trigger stava solo su `reviews`. Tre
-- conseguenze, provate qui:
--   ① un negozio con 6 recensioni al negozio e 4 ai prodotti, tutte da 5, ne ha
--      10: il traguardo arriva con la decima, se è una recensione a un prodotto;
--   ② lo stesso se la decima è una recensione al negozio;
--   ③ un negozio con 10 recensioni ai prodotti da 5 e 5 al negozio da 1 ha una
--      media di 3,67: il traguardo NON arriva (prima arrivava lo stesso);
--   ④ con sole recensioni ai prodotti tutto resta come prima.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';
SET LOCAL mycity.allow_order_write   = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;

-- Quattro negozi (…01-…04) e dieci clienti (…101-…110).
INSERT INTO auth.users (id, email, raw_user_meta_data)
SELECT ('e5000000-0000-0000-0000-00000000000' || s)::uuid, 'negozio' || s || '@test.it', '{"role":"seller"}'
  FROM generate_series(1, 4) s;
INSERT INTO auth.users (id, email, raw_user_meta_data)
SELECT ('e5000000-0000-0000-0000-000000000' || (100 + c))::uuid, 'cliente' || c || '@test.it', '{"role":"buyer"}'
  FROM generate_series(1, 10) c;

UPDATE public.profiles
   SET role = 'seller', is_approved = true, approval_status = 'approved'
 WHERE id IN (SELECT ('e5000000-0000-0000-0000-00000000000' || s)::uuid FROM generate_series(1, 4) s);

-- Un prodotto per negozio.
INSERT INTO public.products (id, name, price, seller_id, status, images, stock)
SELECT ('e5000000-0000-0000-0000-0000000000a' || s)::uuid, 'Pane ' || s, 2.50,
       ('e5000000-0000-0000-0000-00000000000' || s)::uuid, 'available', '[]'::jsonb, 100
  FROM generate_series(1, 4) s;

-- Un ordine consegnato per ogni cliente in ogni negozio: la recensione al negozio vuole un ordine.
INSERT INTO public.orders (id, user_id, seller_id, total_price, payment_status, delivery_status)
SELECT ('e5000001-000' || s || '-0000-0000-000000000' || (100 + c))::uuid,
       ('e5000000-0000-0000-0000-000000000' || (100 + c))::uuid,
       ('e5000000-0000-0000-0000-00000000000' || s)::uuid,
       2.50, 'PAID', 'DELIVERED'
  FROM generate_series(1, 4) s, generate_series(1, 10) c;

-- ① Negozio 1: prima 6 recensioni al negozio, poi 4 ai prodotti. Tutte da 5.
INSERT INTO public.store_reviews (store_id, user_id, order_id, rating)
SELECT 'e5000000-0000-0000-0000-000000000001', ('e5000000-0000-0000-0000-000000000' || (100 + c))::uuid,
       ('e5000001-0001-0000-0000-000000000' || (100 + c))::uuid, 5
  FROM generate_series(1, 6) c;
INSERT INTO public.reviews (product_id, user_id, rating)
SELECT 'e5000000-0000-0000-0000-0000000000a1', ('e5000000-0000-0000-0000-000000000' || (100 + c))::uuid, 5
  FROM generate_series(7, 10) c;

-- ② Negozio 2: prima 4 recensioni ai prodotti, poi 6 al negozio. Tutte da 5.
INSERT INTO public.reviews (product_id, user_id, rating)
SELECT 'e5000000-0000-0000-0000-0000000000a2', ('e5000000-0000-0000-0000-000000000' || (100 + c))::uuid, 5
  FROM generate_series(1, 4) c;
INSERT INTO public.store_reviews (store_id, user_id, order_id, rating)
SELECT 'e5000000-0000-0000-0000-000000000002', ('e5000000-0000-0000-0000-000000000' || (100 + c))::uuid,
       ('e5000001-0002-0000-0000-000000000' || (100 + c))::uuid, 5
  FROM generate_series(5, 10) c;

-- ③ Negozio 3: 5 recensioni al negozio da 1, poi 10 ai prodotti da 5. Media 55/15 = 3,67.
INSERT INTO public.store_reviews (store_id, user_id, order_id, rating)
SELECT 'e5000000-0000-0000-0000-000000000003', ('e5000000-0000-0000-0000-000000000' || (100 + c))::uuid,
       ('e5000001-0003-0000-0000-000000000' || (100 + c))::uuid, 1
  FROM generate_series(1, 5) c;
INSERT INTO public.reviews (product_id, user_id, rating)
SELECT 'e5000000-0000-0000-0000-0000000000a3', ('e5000000-0000-0000-0000-000000000' || (100 + c))::uuid, 5
  FROM generate_series(1, 10) c;

-- ④ Negozio 4: solo 10 recensioni ai prodotti da 5, come prima.
INSERT INTO public.reviews (product_id, user_id, rating)
SELECT 'e5000000-0000-0000-0000-0000000000a4', ('e5000000-0000-0000-0000-000000000' || (100 + c))::uuid, 5
  FROM generate_series(1, 10) c;

INSERT INTO esiti
SELECT '① 6 al negozio + 4 ai prodotti, tutte da 5: Top rated',
       EXISTS (SELECT 1 FROM public.user_achievements
                WHERE user_id = 'e5000000-0000-0000-0000-000000000001' AND achievement_id = 'seller_top_rated'),
       'le recensioni al negozio contano verso le 10';

INSERT INTO esiti
SELECT '② 4 ai prodotti + 6 al negozio (la decima al negozio): Top rated',
       EXISTS (SELECT 1 FROM public.user_achievements
                WHERE user_id = 'e5000000-0000-0000-0000-000000000002' AND achievement_id = 'seller_top_rated'),
       'anche una recensione al negozio fa scattare il controllo';

INSERT INTO esiti
SELECT '③ 10 ai prodotti da 5 + 5 al negozio da 1 (media 3,67): niente Top rated',
       NOT EXISTS (SELECT 1 FROM public.user_achievements
                    WHERE user_id = 'e5000000-0000-0000-0000-000000000003' AND achievement_id = 'seller_top_rated'),
       'le recensioni al negozio pesano anche sulla media';

INSERT INTO esiti
SELECT '④ solo 10 ai prodotti da 5: Top rated come prima',
       EXISTS (SELECT 1 FROM public.user_achievements
                WHERE user_id = 'e5000000-0000-0000-0000-000000000004' AND achievement_id = 'seller_top_rated'),
       'con sole recensioni ai prodotti non cambia niente';

-- =============================================================================
-- Verdetto
-- =============================================================================
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

-- =============================================================================
-- R03-020 — Una promo «su una categoria» senza categoria non nasce (migrazione 272)
-- =============================================================================
--   tests/sql/harness/apply.sh mycity_test && tests/sql/harness/run.sh mycity_test
--
-- ① il negoziante, coi suoi permessi, prova a creare la promo come la creava il
--    modulo (scope='category', category_id NULL): il database la rifiuta
-- ② stessa cosa per una promo «di prodotti» senza prodotti
-- ③ una promo di categoria CON la categoria nasce, e lo sconto si applica davvero
-- Senza la 272 ① e ② sono rossi. ROLLBACK finale.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('11111111-1111-1111-1111-111111111111', 'bottega@test.it', '{"role":"seller"}');
UPDATE public.profiles
   SET is_approved = true, approval_status = 'approved', store_name = 'Bottega di prova',
       store_address = 'Via Roma 1', store_lat = 45.05, store_lng = 9.69
 WHERE id = '11111111-1111-1111-1111-111111111111';

INSERT INTO public.categories (id, name, slug) VALUES ('c1111111-1111-1111-1111-111111111111', 'Dolci', 'dolci-r03');
INSERT INTO public.products (id, seller_id, name, description, price, stock, status, category_id)
VALUES ('d1111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111',
        'Torta', 'Torta di mele fatta in casa', 20, 5, 'available', 'c1111111-1111-1111-1111-111111111111');

SET LOCAL mycity.allow_profile_write = '0';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

DO $$
BEGIN
  INSERT INTO public.seller_promotions (seller_id, title, discount_percent, scope, ends_at)
  VALUES ('11111111-1111-1111-1111-111111111111', 'Saldi del weekend', 15, 'category', now() + interval '7 days');
  INSERT INTO esiti VALUES ('la promo di categoria senza categoria non nasce', false, 'è nata: la vetrina annuncerebbe -15% senza sconto');
EXCEPTION WHEN check_violation THEN
  INSERT INTO esiti VALUES ('la promo di categoria senza categoria non nasce', true, SQLERRM);
END $$;

DO $$
BEGIN
  INSERT INTO public.seller_promotions (seller_id, title, discount_percent, scope, product_ids, ends_at)
  VALUES ('11111111-1111-1111-1111-111111111111', 'Prodotti scelti', 15, 'products', '{}', now() + interval '7 days');
  INSERT INTO esiti VALUES ('la promo di prodotti senza prodotti non nasce', false, 'è nata');
EXCEPTION WHEN check_violation THEN
  INSERT INTO esiti VALUES ('la promo di prodotti senza prodotti non nasce', true, SQLERRM);
END $$;

INSERT INTO public.seller_promotions (seller_id, title, discount_percent, scope, category_id, ends_at)
VALUES ('11111111-1111-1111-1111-111111111111', 'Dolci scontati', 15, 'category',
        'c1111111-1111-1111-1111-111111111111', now() + interval '7 days');
INSERT INTO esiti
SELECT 'con la categoria la promo nasce e sconta davvero', count(*) = 1 AND bool_and(d.discount_percent = 15),
       'sconti trovati: ' || count(*)
  FROM public.product_active_discounts(ARRAY['d1111111-1111-1111-1111-111111111111'::uuid]) d;

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

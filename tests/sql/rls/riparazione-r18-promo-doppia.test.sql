-- =============================================================================
-- R18-012 — Due promo uguali non restano attive insieme (migrazione 429)
-- =============================================================================
--   tests/sql/harness/apply.sh mycity_test && tests/sql/harness/run.sh mycity_test
--
-- Il negoziante, coi suoi permessi, fa quello che faceva il doppio clic:
-- ① crea «Saldi del weekend» -15% su tutto il negozio, e subito la stessa promo
--    un'altra volta: la seconda non nasce (prima ne nascevano due, tutte e due attive)
-- ② dopo averla annullata, la stessa promo si può rifare
-- ③ una promo uguale ma SCADUTA non ferma quella nuova (le scadute restano «active»)
-- ④ cambiando lo sconto o il titolo è un'altra promo, e nasce
-- ⑤ riaccendere una promo annullata uguale a una in corso non si può
-- ⑥ un altro negozio con la stessa promo non è fermato
-- Senza la 429 ① e ⑤ sono rossi. ROLLBACK finale.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('12121212-1212-1212-1212-121212121212', 'bottega-r18@test.it', '{"role":"seller"}'),
  ('13131313-1313-1313-1313-131313131313', 'altra-bottega-r18@test.it', '{"role":"seller"}');
UPDATE public.profiles
   SET is_approved = true, approval_status = 'approved', store_name = 'Bottega di prova',
       store_address = 'Via Roma 1', store_lat = 45.05, store_lng = 9.69
 WHERE id IN ('12121212-1212-1212-1212-121212121212', '13131313-1313-1313-1313-131313131313');

-- Una promo uguale ma già scaduta (come le lascia il database: status resta 'active').
INSERT INTO public.seller_promotions (id, seller_id, title, discount_percent, scope, starts_at, ends_at)
VALUES ('a1212121-1212-1212-1212-121212121212', '12121212-1212-1212-1212-121212121212',
        'Saldi del weekend', 15, 'store', now() - interval '10 days', now() - interval '3 days');

SET LOCAL mycity.allow_profile_write = '0';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"12121212-1212-1212-1212-121212121212","role":"authenticated"}';

-- ③ la promo scaduta non ferma quella nuova
DO $$
BEGIN
  INSERT INTO public.seller_promotions (id, seller_id, title, discount_percent, scope, ends_at)
  VALUES ('b1212121-1212-1212-1212-121212121212', '12121212-1212-1212-1212-121212121212',
          'Saldi del weekend', 15, 'store', now() + interval '7 days');
  INSERT INTO esiti VALUES ('una promo uguale ma scaduta non ferma quella nuova', true, 'nata');
EXCEPTION WHEN others THEN
  INSERT INTO esiti VALUES ('una promo uguale ma scaduta non ferma quella nuova', false, SQLERRM);
END $$;

-- ① il secondo clic: la stessa promo, qualche millesimo dopo
DO $$
BEGIN
  INSERT INTO public.seller_promotions (seller_id, title, discount_percent, scope, ends_at)
  VALUES ('12121212-1212-1212-1212-121212121212', 'Saldi del weekend', 15, 'store', now() + interval '7 days' + interval '3 milliseconds');
  INSERT INTO esiti VALUES ('il secondo clic non crea una seconda promo uguale', false, 'nata: due promo uguali attive');
EXCEPTION WHEN raise_exception THEN
  INSERT INTO esiti VALUES ('il secondo clic non crea una seconda promo uguale', true, SQLERRM);
END $$;

INSERT INTO esiti
SELECT 'attive e in corso resta una sola «Saldi del weekend»', count(*) = 1, 'trovate: ' || count(*)
  FROM public.seller_promotions
 WHERE seller_id = '12121212-1212-1212-1212-121212121212' AND title = 'Saldi del weekend'
   AND status = 'active' AND ends_at > now();

-- ④ un altro sconto, o un altro titolo, è un'altra promo
DO $$
BEGIN
  INSERT INTO public.seller_promotions (seller_id, title, discount_percent, scope, ends_at)
  VALUES ('12121212-1212-1212-1212-121212121212', 'Saldi del weekend', 25, 'store', now() + interval '7 days');
  INSERT INTO public.seller_promotions (seller_id, title, discount_percent, scope, ends_at)
  VALUES ('12121212-1212-1212-1212-121212121212', 'Saldi di Natale', 15, 'store', now() + interval '7 days');
  INSERT INTO esiti VALUES ('un altro sconto o un altro titolo nasce', true, 'nate');
EXCEPTION WHEN others THEN
  INSERT INTO esiti VALUES ('un altro sconto o un altro titolo nasce', false, SQLERRM);
END $$;

-- ② annullata, si può rifare
UPDATE public.seller_promotions SET status = 'cancelled' WHERE id = 'b1212121-1212-1212-1212-121212121212';
DO $$
BEGIN
  INSERT INTO public.seller_promotions (id, seller_id, title, discount_percent, scope, ends_at)
  VALUES ('c1212121-1212-1212-1212-121212121212', '12121212-1212-1212-1212-121212121212',
          'Saldi del weekend', 15, 'store', now() + interval '3 days');
  INSERT INTO esiti VALUES ('dopo averla annullata la stessa promo si rifà', true, 'nata');
EXCEPTION WHEN others THEN
  INSERT INTO esiti VALUES ('dopo averla annullata la stessa promo si rifà', false, SQLERRM);
END $$;

-- ⑤ riaccendere quella annullata, mentre la nuova uguale è in corso
DO $$
BEGIN
  UPDATE public.seller_promotions SET status = 'active' WHERE id = 'b1212121-1212-1212-1212-121212121212';
  INSERT INTO esiti VALUES ('una promo annullata non si riaccende accanto a una uguale in corso', false, 'riaccesa: due promo uguali attive');
EXCEPTION WHEN raise_exception THEN
  INSERT INTO esiti VALUES ('una promo annullata non si riaccende accanto a una uguale in corso', true, SQLERRM);
END $$;

-- ⑥ un altro negozio
SET LOCAL request.jwt.claims = '{"sub":"13131313-1313-1313-1313-131313131313","role":"authenticated"}';
DO $$
BEGIN
  INSERT INTO public.seller_promotions (seller_id, title, discount_percent, scope, ends_at)
  VALUES ('13131313-1313-1313-1313-131313131313', 'Saldi del weekend', 15, 'store', now() + interval '7 days');
  INSERT INTO esiti VALUES ('un altro negozio con la stessa promo non è fermato', true, 'nata');
EXCEPTION WHEN others THEN
  INSERT INTO esiti VALUES ('un altro negozio con la stessa promo non è fermato', false, SQLERRM);
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

-- =============================================================================
-- R18-024 — I visitatori non leggono la tabella dei profili (migrazione 426)
-- =============================================================================
--   tests/sql/harness/apply.sh mycity_test && tests/sql/harness/run.sh mycity_test
--
-- In produzione anon non ha SELECT su public.profiles; il database delle migrazioni deve
-- essere uguale. E con la porta chiusa il sito pubblico deve restare in piedi.
-- ① da visitatore la lettura di profiles e' negata (non solo vuota)
-- ② da visitatore si leggono ancora la vetrina dei negozi, il catalogo, gli eventi e il
--    negozio del mese
-- ③ il cliente collegato legge ancora il suo profilo, e solo quello
-- Senza la 426 il passo ① e' rosso. Tutto con ROLLBACK.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('e2400000-0000-0000-0000-000000000001', 'negozio-r18v@test.it', '{"role":"seller"}'),
  ('e2400000-0000-0000-0000-000000000002', 'cliente-r18v@test.it', '{"role":"buyer"}');
UPDATE public.profiles
   SET is_approved = true, approval_status = 'approved', store_name = 'Bottega di prova',
       store_address = 'Via Roma 1', store_lat = 45.05, store_lng = 9.69
 WHERE id = 'e2400000-0000-0000-0000-000000000001';

INSERT INTO public.products (id, name, description, price, seller_id, status, stock)
VALUES ('e2400000-0000-0000-0000-0000000000a1', 'Focaccia di prova', 'cotta al mattino',
        4.50, 'e2400000-0000-0000-0000-000000000001', 'available', 10);
INSERT INTO public.marketplace_events (title, description, starts_at, ends_at)
VALUES ('Mercatino di prova r18v', 'x', now() + interval '1 day', now() + interval '1 day 2 hours');
DELETE FROM public.shop_of_month WHERE month = DATE '2099-02-01';
INSERT INTO public.shop_of_month (seller_id, month, headline)
VALUES ('e2400000-0000-0000-0000-000000000001', DATE '2099-02-01', 'Il forno del mese');

RESET mycity.allow_profile_write;

-- ── ① ② Il visitatore ───────────────────────────────────────────────────────
SET LOCAL ROLE anon;
SET LOCAL request.jwt.claims = '{"role":"anon"}';

DO $$
DECLARE n int;
BEGIN
  BEGIN
    SELECT count(*) INTO n FROM public.profiles;
    INSERT INTO esiti VALUES ('visitatore: la lettura di profiles e'' negata, come in produzione', false,
                              'letta: ' || n || ' righe (il permesso c''e'')');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO esiti VALUES ('visitatore: la lettura di profiles e'' negata, come in produzione', true, SQLERRM);
  END;
  BEGIN
    SELECT count(*) INTO n FROM public.seller_public_profiles WHERE id = 'e2400000-0000-0000-0000-000000000001';
    INSERT INTO esiti VALUES ('visitatore: la vetrina del negozio si legge', n = 1, n || ' righe');
  EXCEPTION WHEN OTHERS THEN INSERT INTO esiti VALUES ('visitatore: la vetrina del negozio si legge', false, SQLERRM); END;
  BEGIN
    SELECT count(*) INTO n FROM public.products WHERE id = 'e2400000-0000-0000-0000-0000000000a1';
    INSERT INTO esiti VALUES ('visitatore: il catalogo si legge', n = 1, n || ' righe');
  EXCEPTION WHEN OTHERS THEN INSERT INTO esiti VALUES ('visitatore: il catalogo si legge', false, SQLERRM); END;
  BEGIN
    SELECT count(*) INTO n FROM public.marketplace_events WHERE title = 'Mercatino di prova r18v';
    INSERT INTO esiti VALUES ('visitatore: gli eventi si leggono', n = 1, n || ' righe');
  EXCEPTION WHEN OTHERS THEN INSERT INTO esiti VALUES ('visitatore: gli eventi si leggono', false, SQLERRM); END;
  BEGIN
    SELECT count(*) INTO n FROM public.shop_of_month WHERE month = DATE '2099-02-01';
    INSERT INTO esiti VALUES ('visitatore: il negozio del mese si legge', n = 1, n || ' righe');
  EXCEPTION WHEN OTHERS THEN INSERT INTO esiti VALUES ('visitatore: il negozio del mese si legge', false, SQLERRM); END;
END $$;

-- ── ③ Il cliente collegato ─────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"e2400000-0000-0000-0000-000000000002","role":"authenticated"}';

INSERT INTO esiti
SELECT 'cliente: legge il suo profilo, e solo quello',
       count(*) = 1 AND bool_and(id = 'e2400000-0000-0000-0000-000000000002'), count(*) || ' righe'
  FROM public.profiles;

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

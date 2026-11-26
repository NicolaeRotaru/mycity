-- =============================================================================
-- R03-006 — L'ora dell'errore dei prezzi esterni ha un posto nel database (migrazione 890)
-- =============================================================================
--   tests/sql/harness/apply.sh mycity_test && tests/sql/harness/run.sh mycity_test
--
-- ① la colonna products.external_sync_error_at esiste ed e' un timestamptz
-- ② un prodotto nuovo la ha vuota
-- ③ si scrive con l'ora dell'errore e si rilegge uguale
-- Senza la 890 il passo ① e' rosso. Tutto con ROLLBACK.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('e3600000-0000-0000-0000-000000000001', 'negozio-r03f@test.it', '{"role":"seller"}');
UPDATE public.profiles
   SET is_approved = true, approval_status = 'approved', store_name = 'Bottega freno'
 WHERE id = 'e3600000-0000-0000-0000-000000000001';

INSERT INTO public.products (id, seller_id, name, description, price, stock, status, external_source_url)
VALUES ('e3600000-0000-0000-0000-0000000000a1', 'e3600000-0000-0000-0000-000000000001',
        'Lampada importata', 'prova', 10.00, 5, 'available', 'https://esempio.test/x');

RESET mycity.allow_profile_write;

INSERT INTO esiti
SELECT 'la colonna dell''ora dell''errore esiste ed e'' timestamptz',
       EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'products'
                  AND column_name = 'external_sync_error_at' AND data_type = 'timestamp with time zone'),
       'controllo su information_schema';

DO $$
DECLARE vuota boolean; riletta timestamptz; ora timestamptz := '2026-11-26 10:00:00+00';
BEGIN
  BEGIN
    EXECUTE 'SELECT external_sync_error_at IS NULL FROM public.products WHERE id = $1'
      INTO vuota USING 'e3600000-0000-0000-0000-0000000000a1'::uuid;
    EXECUTE 'UPDATE public.products SET external_sync_status = ''error'', external_sync_error_at = $2 WHERE id = $1'
      USING 'e3600000-0000-0000-0000-0000000000a1'::uuid, ora;
    EXECUTE 'SELECT external_sync_error_at FROM public.products WHERE id = $1'
      INTO riletta USING 'e3600000-0000-0000-0000-0000000000a1'::uuid;
  EXCEPTION WHEN OTHERS THEN
    vuota := false; riletta := NULL;
  END;
  INSERT INTO esiti VALUES ('un prodotto nuovo ha l''ora dell''errore vuota', coalesce(vuota, false), 'letta dal prodotto');
  INSERT INTO esiti VALUES ('l''ora dell''errore si scrive e si rilegge uguale', riletta = ora, coalesce(riletta::text, 'non scritta'));
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

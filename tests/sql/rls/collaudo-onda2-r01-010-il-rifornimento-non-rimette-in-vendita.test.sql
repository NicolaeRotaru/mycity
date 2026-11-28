-- =============================================================================
-- R01-010 (collaudo dell'onda 2) — Il prodotto tolto dallo staff non torna in vendita col rifornimento
-- =============================================================================
--   tests/sql/harness/apply.sh mycity_test && tests/sql/harness/run.sh mycity_test
--
-- Il grilletto di onda2_A_3 guardava solo le scritture che nominano `status` o il segno
-- (BEFORE UPDATE OF status, tolto_dallo_staff_at). Ma un altro grilletto rimette in vendita da solo:
-- trg_auto_republish (BEFORE UPDATE OF stock) porta a 'available' un prodotto 'out_of_stock' o
-- 'sold_out' quando la giacenza passa da 0 a più di 0. Il negozio, coi suoi permessi, poteva:
--   UPDATE products SET status = 'out_of_stock', stock = 0   (permesso: non è 'available')
--   UPDATE products SET stock = 5                            (non nomina status: il freno non scattava)
-- e il prodotto tolto tornava in vetrina. Qui:
-- ① il negozio porta il prodotto tolto a «esaurito» e lo rifornisce: resta fuori vendita
-- ② la giacenza nuova però si scrive (il rifornimento non si blocca)
-- ③ lo stesso giro fatto dal server (chiave di servizio) non lo rimette in vendita
-- ④ un prodotto mai tolto, esaurito e rifornito, torna in vendita come prima
-- ⑤ «Attiva» esplicito sul prodotto tolto resta rifiutato col motivo (23514)
-- Senza la riparazione ① e ③ sono rossi. Tutto con ROLLBACK.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated, service_role;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('c0101000-0000-0000-0000-00000000000b', 'bottega-collaudo-o2a@test.it', '{"role":"seller"}');
UPDATE public.profiles
   SET is_approved = true, visibile_senza_abbonamento = true, approval_status = 'approved', role = 'seller',
       store_name = 'Bottega collaudo o2a'
 WHERE id = 'c0101000-0000-0000-0000-00000000000b';

INSERT INTO public.products (id, seller_id, name, description, price, stock, status, has_variants, images, tolto_dallo_staff_at)
VALUES
  ('c0101000-0000-0000-0000-0000000000f1', 'c0101000-0000-0000-0000-00000000000b',
   'Borsa segnalata', 'tolta dallo staff', 20, 3, 'draft', false, '[]'::jsonb, now() - interval '1 day'),
  ('c0101000-0000-0000-0000-0000000000f2', 'c0101000-0000-0000-0000-00000000000b',
   'Borsa segnalata due', 'tolta dallo staff', 20, 3, 'draft', false, '[]'::jsonb, now() - interval '1 day'),
  ('c0101000-0000-0000-0000-0000000000f3', 'c0101000-0000-0000-0000-00000000000b',
   'Borsa normale', 'mai tolta', 20, 0, 'out_of_stock', false, '[]'::jsonb, NULL);

RESET mycity.allow_profile_write;

-- Il negozio, coi suoi permessi
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"c0101000-0000-0000-0000-00000000000b","role":"authenticated"}';
DO $$
DECLARE v_status text; v_stock int;
BEGIN
  BEGIN
    UPDATE public.products SET status = 'out_of_stock', stock = 0 WHERE id = 'c0101000-0000-0000-0000-0000000000f1';
    UPDATE public.products SET stock = 5 WHERE id = 'c0101000-0000-0000-0000-0000000000f1';
    SELECT status, stock INTO v_status, v_stock FROM public.products WHERE id = 'c0101000-0000-0000-0000-0000000000f1';
    INSERT INTO esiti VALUES ('① esaurito e rifornito dal negozio, resta fuori vendita', v_status IS DISTINCT FROM 'available', 'stato ' || v_status);
    INSERT INTO esiti VALUES ('② la giacenza del rifornimento si scrive', v_stock = 5, 'giacenza ' || v_stock);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO esiti VALUES ('① esaurito e rifornito dal negozio, resta fuori vendita', false, SQLSTATE || ' ' || SQLERRM);
    INSERT INTO esiti VALUES ('② la giacenza del rifornimento si scrive', false, SQLSTATE || ' ' || SQLERRM);
  END;
  BEGIN
    UPDATE public.products SET stock = 4 WHERE id = 'c0101000-0000-0000-0000-0000000000f3';
    SELECT status INTO v_status FROM public.products WHERE id = 'c0101000-0000-0000-0000-0000000000f3';
    INSERT INTO esiti VALUES ('④ un prodotto mai tolto, rifornito, torna in vendita', v_status = 'available', 'stato ' || v_status);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO esiti VALUES ('④ un prodotto mai tolto, rifornito, torna in vendita', false, SQLSTATE || ' ' || SQLERRM);
  END;
  BEGIN
    UPDATE public.products SET status = 'available' WHERE id = 'c0101000-0000-0000-0000-0000000000f2';
    INSERT INTO esiti VALUES ('⑤ «Attiva» sul prodotto tolto resta rifiutato', false, 'rimesso');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO esiti VALUES ('⑤ «Attiva» sul prodotto tolto resta rifiutato', true, SQLERRM);
  END;
END $$;
RESET ROLE;

-- Il server (le rotte dell'assistente e restore_stock scrivono con la chiave di servizio)
SET LOCAL ROLE service_role;
DO $$
DECLARE v_status text;
BEGIN
  BEGIN
    UPDATE public.products SET status = 'sold_out', stock = 0 WHERE id = 'c0101000-0000-0000-0000-0000000000f2';
    UPDATE public.products SET stock = 2 WHERE id = 'c0101000-0000-0000-0000-0000000000f2';
    SELECT status INTO v_status FROM public.products WHERE id = 'c0101000-0000-0000-0000-0000000000f2';
    INSERT INTO esiti VALUES ('③ esaurito e rifornito dal server, resta fuori vendita', v_status IS DISTINCT FROM 'available', 'stato ' || v_status);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO esiti VALUES ('③ esaurito e rifornito dal server, resta fuori vendita', false, SQLSTATE || ' ' || SQLERRM);
  END;
END $$;
RESET ROLE;

DO $$
DECLARE r record; rossi int;
BEGIN
  FOR r IN SELECT * FROM esiti ORDER BY nome LOOP
    RAISE INFO '%  %  — %', CASE WHEN r.ok THEN 'ok  ' ELSE 'ROTTO' END, r.nome, r.dettaglio;
  END LOOP;
  SELECT count(*) INTO rossi FROM esiti WHERE ok IS NOT TRUE;
  IF rossi > 0 OR (SELECT count(*) FROM esiti) <> 5 THEN
    RAISE EXCEPTION '% controlli su % sono rossi', rossi, (SELECT count(*) FROM esiti);
  END IF;
  RAISE INFO 'tutti verdi: % controlli', (SELECT count(*) FROM esiti);
END $$;

ROLLBACK;

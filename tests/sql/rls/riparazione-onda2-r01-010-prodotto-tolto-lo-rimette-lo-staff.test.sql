-- =============================================================================
-- R01-010 (onda 2) — Il prodotto tolto dopo una segnalazione accolta lo rimette in vendita solo lo staff
-- =============================================================================
--   tests/sql/harness/apply.sh mycity_test && tests/sql/harness/run.sh mycity_test
--
-- «Accolta» su una segnalazione di prodotto lo mette in bozza col segno tolto_dallo_staff_at
-- (app/api/admin/segnalazioni/accogli/route.ts). Il grilletto della migrazione 999k:
-- ① il negozio, coi suoi permessi (come il modulo e «Attiva»), non lo rimette in vendita
-- ② il negozio non svuota il segno
-- ③ nemmeno il server (chiave di servizio, le rotte dell'assistente) lo rimette in vendita col segno
-- ④ lo staff lo rimette in vendita svuotando il segno nella stessa scrittura
-- ⑤ poi il negozio lo disattiva e lo riattiva come sempre
-- ⑥ un prodotto mai tolto il negozio lo mette in vendita come prima
-- Senza la migrazione ①, ③ sono rossi (e ② non ha la colonna). Tutto con ROLLBACK.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated, service_role;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('e0101000-0000-0000-0000-00000000000a', 'staff-o2a@test.it', '{"role":"admin"}'),
  ('e0101000-0000-0000-0000-00000000000b', 'bottega-o2a@test.it', '{"role":"seller"}');
UPDATE public.profiles SET role = 'admin' WHERE id = 'e0101000-0000-0000-0000-00000000000a';
UPDATE public.profiles
   SET is_approved = true, visibile_senza_abbonamento = true, approval_status = 'approved', role = 'seller',
       store_name = 'Bottega o2a'
 WHERE id = 'e0101000-0000-0000-0000-00000000000b';

INSERT INTO public.products (id, seller_id, name, description, price, stock, status, has_variants, images, tolto_dallo_staff_at)
VALUES
  ('e0101000-0000-0000-0000-0000000000f1', 'e0101000-0000-0000-0000-00000000000b',
   'Borsa segnalata', 'tolta dallo staff', 20, 3, 'draft', false, '[]'::jsonb, now() - interval '1 day'),
  ('e0101000-0000-0000-0000-0000000000f2', 'e0101000-0000-0000-0000-00000000000b',
   'Borsa normale', 'mai tolta', 20, 3, 'draft', false, '[]'::jsonb, NULL);

RESET mycity.allow_profile_write;

-- Il negozio
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"e0101000-0000-0000-0000-00000000000b","role":"authenticated"}';
DO $$
DECLARE n int;
BEGIN
  BEGIN
    UPDATE public.products SET status = 'available' WHERE id = 'e0101000-0000-0000-0000-0000000000f1';
    GET DIAGNOSTICS n = ROW_COUNT;
    INSERT INTO esiti VALUES ('① il negozio non lo rimette in vendita', false, n || ' righe rimesse in vendita');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO esiti VALUES ('① il negozio non lo rimette in vendita', true, SQLERRM);
  END;
  BEGIN
    UPDATE public.products SET tolto_dallo_staff_at = NULL WHERE id = 'e0101000-0000-0000-0000-0000000000f1';
    GET DIAGNOSTICS n = ROW_COUNT;
    INSERT INTO esiti VALUES ('② il negozio non svuota il segno', n = 0, n || ' righe col segno svuotato');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO esiti VALUES ('② il negozio non svuota il segno', true, SQLERRM);
  END;
  BEGIN
    UPDATE public.products SET status = 'available' WHERE id = 'e0101000-0000-0000-0000-0000000000f2';
    GET DIAGNOSTICS n = ROW_COUNT;
    INSERT INTO esiti VALUES ('⑥ un prodotto mai tolto va in vendita come prima', n = 1, n || ' righe');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO esiti VALUES ('⑥ un prodotto mai tolto va in vendita come prima', false, SQLERRM);
  END;
END $$;
RESET ROLE;

-- Il server, senza svuotare il segno
SET LOCAL ROLE service_role;
DO $$
BEGIN
  BEGIN
    UPDATE public.products SET status = 'available' WHERE id = 'e0101000-0000-0000-0000-0000000000f1';
    INSERT INTO esiti VALUES ('③ nemmeno il server lo rimette in vendita col segno', false, 'rimesso');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO esiti VALUES ('③ nemmeno il server lo rimette in vendita col segno', true, SQLERRM);
  END;
END $$;
RESET ROLE;

-- Lo staff dal pannello
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"e0101000-0000-0000-0000-00000000000a","role":"authenticated"}';
DO $$
DECLARE n int;
BEGIN
  BEGIN
    UPDATE public.products SET status = 'available', tolto_dallo_staff_at = NULL
     WHERE id = 'e0101000-0000-0000-0000-0000000000f1';
    GET DIAGNOSTICS n = ROW_COUNT;
    INSERT INTO esiti VALUES ('④ lo staff lo rimette in vendita svuotando il segno', n = 1, n || ' righe');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO esiti VALUES ('④ lo staff lo rimette in vendita svuotando il segno', false, SQLERRM);
  END;
END $$;
RESET ROLE;

-- Di nuovo il negozio
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"e0101000-0000-0000-0000-00000000000b","role":"authenticated"}';
DO $$
DECLARE n int; m int;
BEGIN
  BEGIN
    UPDATE public.products SET status = 'draft' WHERE id = 'e0101000-0000-0000-0000-0000000000f1';
    GET DIAGNOSTICS n = ROW_COUNT;
    UPDATE public.products SET status = 'available' WHERE id = 'e0101000-0000-0000-0000-0000000000f1';
    GET DIAGNOSTICS m = ROW_COUNT;
    INSERT INTO esiti VALUES ('⑤ dopo lo sblocco il negozio disattiva e riattiva', n = 1 AND m = 1, n || '/' || m || ' righe');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO esiti VALUES ('⑤ dopo lo sblocco il negozio disattiva e riattiva', false, SQLERRM);
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
  IF rossi > 0 OR (SELECT count(*) FROM esiti) <> 6 THEN
    RAISE EXCEPTION '% controlli su % sono rossi', rossi, (SELECT count(*) FROM esiti);
  END IF;
  RAISE INFO 'tutti verdi: % controlli', (SELECT count(*) FROM esiti);
END $$;

ROLLBACK;

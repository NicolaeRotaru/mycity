-- =============================================================================
-- R08 — Una lista non si salva col titolo vuoto, neanche scrivendo diretto
-- =============================================================================
--   tests/sql/harness/apply.sh mycity_test && tests/sql/harness/run.sh mycity_test
--
-- Un cliente collegato, coi suoi permessi, sulla sua lista:
-- ① non crea una lista col titolo vuoto
-- ② non crea una lista con un titolo di soli spazi
-- ③ non crea una lista con un titolo di soli a capo, tabulazioni e spazi non separabili
--    (la stessa regola di .trim() nella pagina che crea le liste)
-- ④ crea ancora una lista con un titolo vero (il vincolo non chiude tutto)
-- ⑤ non svuota il titolo della lista modificandola
-- ⑥ cambia ancora il titolo della lista con un altro titolo vero
-- Prima della correzione i passi ①, ②, ③ e ⑤ sono rossi: la riga entra.
-- Tutto con ROLLBACK.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('e0800000-0000-0000-0000-000000000071', 'cliente-r08l@test.it', '{"role":"buyer"}');

RESET mycity.allow_profile_write;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"e0800000-0000-0000-0000-000000000071","role":"authenticated"}';

DO $$
DECLARE n int; t text;
BEGIN
  BEGIN
    INSERT INTO public.product_lists (owner_id, title)
    VALUES ('e0800000-0000-0000-0000-000000000071', '');
    INSERT INTO esiti VALUES ('① cliente: non crea una lista col titolo vuoto', false, 'lista col titolo vuoto accettata');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO esiti VALUES ('① cliente: non crea una lista col titolo vuoto', true, SQLERRM);
  END;

  BEGIN
    INSERT INTO public.product_lists (owner_id, title)
    VALUES ('e0800000-0000-0000-0000-000000000071', '    ');
    INSERT INTO esiti VALUES ('② cliente: non crea una lista con un titolo di soli spazi', false, 'lista con titolo di soli spazi accettata');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO esiti VALUES ('② cliente: non crea una lista con un titolo di soli spazi', true, SQLERRM);
  END;

  BEGIN
    INSERT INTO public.product_lists (owner_id, title)
    VALUES ('e0800000-0000-0000-0000-000000000071', E' \t\n\r ' || U&'\00A0\3000');
    INSERT INTO esiti VALUES ('③ cliente: non crea una lista con un titolo di soli a capo e tabulazioni', false, 'lista con titolo di soli spazi bianchi accettata');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO esiti VALUES ('③ cliente: non crea una lista con un titolo di soli a capo e tabulazioni', true, SQLERRM);
  END;

  BEGIN
    INSERT INTO public.product_lists (id, owner_id, title)
    VALUES ('e0800000-0000-0000-0000-0000000000a1', 'e0800000-0000-0000-0000-000000000071', 'Regali di Natale');
    INSERT INTO esiti VALUES ('④ cliente: crea una lista con un titolo vero', true, 'entrata');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO esiti VALUES ('④ cliente: crea una lista con un titolo vero', false, SQLERRM);
  END;

  BEGIN
    UPDATE public.product_lists SET title = '   '
     WHERE id = 'e0800000-0000-0000-0000-0000000000a1';
    GET DIAGNOSTICS n = ROW_COUNT;
    INSERT INTO esiti VALUES ('⑤ cliente: non svuota il titolo modificando la lista', false,
      n || ' righe col titolo svuotato');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO esiti VALUES ('⑤ cliente: non svuota il titolo modificando la lista', true, SQLERRM);
  END;

  BEGIN
    UPDATE public.product_lists SET title = 'Regali per la nonna'
     WHERE id = 'e0800000-0000-0000-0000-0000000000a1';
    GET DIAGNOSTICS n = ROW_COUNT;
    SELECT title INTO t FROM public.product_lists WHERE id = 'e0800000-0000-0000-0000-0000000000a1';
    INSERT INTO esiti VALUES ('⑥ cliente: cambia il titolo con un altro titolo vero',
      n = 1 AND t = 'Regali per la nonna', n || ' righe, titolo «' || coalesce(t, '∅') || '»');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO esiti VALUES ('⑥ cliente: cambia il titolo con un altro titolo vero', false, SQLERRM);
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
  IF rossi > 0 THEN
    RAISE EXCEPTION 'ROSSO: % controlli su % sono rossi', rossi, (SELECT count(*) FROM esiti);
  END IF;
  RAISE INFO 'tutti verdi: % controlli', (SELECT count(*) FROM esiti);
END $$;

ROLLBACK;

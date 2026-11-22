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
-- Su una lista vecchia che ha gia' il titolo vuoto (entrata prima della regola: qui la si inserisce
-- aggirando la regola da superutente, vedi sotto):
-- ⑦ il proprietario la rende privata (cambia solo is_public e updated_at, come la pagina) e passa
-- ⑧ se cambia il titolo lasciandolo vuoto, no
-- Senza la correzione i passi ①, ②, ③, ⑤ e ⑧ sono rossi: la riga entra. Con un CHECK al posto del
-- trigger il passo ⑦ e' rosso: la lista vecchia non si rende piu' privata.
-- Tutto con ROLLBACK.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('e0800000-0000-0000-0000-000000000071', 'cliente-r08l@test.it', '{"role":"buyer"}');

RESET mycity.allow_profile_write;

-- Una lista vecchia, pubblica, col titolo vuoto: entrata prima della regola. Qualunque forma abbia la
-- regola, la riga c'e' come in produzione: i trigger si saltano con session_replication_role = replica
-- (da superutente), un vincolo CHECK si toglie e si rimette NOT VALID, come se la riga ci fosse gia'
-- prima del vincolo. Tutto dentro questa transazione, che finisce con ROLLBACK.
DO $$
DECLARE c record; rimetti text[] := '{}'; q text;
BEGIN
  FOR c IN SELECT conname, regexp_replace(pg_get_constraintdef(oid), '\s+NOT VALID$', '') AS def
             FROM pg_constraint
            WHERE conrelid = 'public.product_lists'::regclass AND contype = 'c' LOOP
    EXECUTE format('ALTER TABLE public.product_lists DROP CONSTRAINT %I', c.conname);
    rimetti := rimetti || format('ALTER TABLE public.product_lists ADD CONSTRAINT %I %s NOT VALID', c.conname, c.def);
  END LOOP;
  PERFORM set_config('session_replication_role', 'replica', true);
  INSERT INTO public.product_lists (id, owner_id, title, is_public) VALUES
    ('e0800000-0000-0000-0000-0000000000a2', 'e0800000-0000-0000-0000-000000000071', '', true);
  PERFORM set_config('session_replication_role', 'origin', true);
  FOREACH q IN ARRAY rimetti LOOP
    EXECUTE q;
  END LOOP;
END $$;

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

  DECLARE pubblica boolean;
  BEGIN
    UPDATE public.product_lists SET is_public = false, updated_at = now()
     WHERE id = 'e0800000-0000-0000-0000-0000000000a2';
    GET DIAGNOSTICS n = ROW_COUNT;
    SELECT is_public INTO pubblica FROM public.product_lists WHERE id = 'e0800000-0000-0000-0000-0000000000a2';
    INSERT INTO esiti VALUES ('⑦ cliente: rende privata una lista vecchia col titolo vuoto',
      n = 1 AND pubblica = false, n || ' righe, pubblica: ' || coalesce(pubblica::text, '∅'));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO esiti VALUES ('⑦ cliente: rende privata una lista vecchia col titolo vuoto', false, SQLERRM);
  END;

  BEGIN
    UPDATE public.product_lists SET title = '   '
     WHERE id = 'e0800000-0000-0000-0000-0000000000a2';
    GET DIAGNOSTICS n = ROW_COUNT;
    INSERT INTO esiti VALUES ('⑧ cliente: non cambia il titolo vuoto con un altro vuoto', false,
      n || ' righe col titolo cambiato in un altro vuoto');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO esiti VALUES ('⑧ cliente: non cambia il titolo vuoto con un altro vuoto', true, SQLERRM);
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

-- =============================================================================
-- S01-05 — La risposta a una domanda avvisa chi l'ha fatta
-- =============================================================================
--   tests/sql/harness/apply.sh mycity_test && tests/sql/harness/run.sh mycity_test
--   ① il negozio risponde scrivendo in answered_by l'autore della domanda:
--     l'avviso al cliente parte lo stesso;
--   ② risposta normale (answered_by = il negozio): l'avviso parte;
--   ③ il negozio risponde a una domanda sua: nessun avviso a se stesso;
--   ④ answered_by mandato con un altro utente: resta chi ha scritto la risposta;
--   ⑤ il negozio non cambia is_public, nemmeno con un UPDATE senza filtro;
--   ⑥ l'amministratore nasconde ancora una domanda;
--   ⑦ il negozio risponde con una data a scelta: la data è quella di adesso;
--   ⑧ il negozio, senza cambiare la risposta, manda data e firma diverse:
--     restano quelle di prima;
--   ⑨ il negozio toglie la risposta (vuota o solo spazi): firma e data tornano
--     vuote.
-- Senza la migrazione 993 ①, ④ e ⑤ sono ROSSI; senza la 995 ⑦, ⑧ e ⑨.
-- =============================================================================

BEGIN;
SET LOCAL mycity.allow_profile_write = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('e9930000-0000-0000-0000-00000000000a', 'negozio-s01-05@test.it', '{"role":"seller"}'),
  ('e9930000-0000-0000-0000-00000000000b', 'cliente1-s01-05@test.it', '{"role":"buyer"}'),
  ('e9930000-0000-0000-0000-00000000000c', 'cliente2-s01-05@test.it', '{"role":"buyer"}'),
  ('e9930000-0000-0000-0000-00000000000d', 'staff-s01-05@test.it', '{"role":"buyer"}');
UPDATE public.profiles SET role = 'admin' WHERE id = 'e9930000-0000-0000-0000-00000000000d';
UPDATE public.profiles SET is_approved = true, approval_status = 'approved', store_name = 'Bottega S01-05'
 WHERE id = 'e9930000-0000-0000-0000-00000000000a';

INSERT INTO public.products (id, seller_id, name, price, stock, status)
VALUES ('e9930000-1111-0000-0000-000000000001', 'e9930000-0000-0000-0000-00000000000a', 'Pane', 3.50, 10, 'available');

INSERT INTO public.product_questions (id, product_id, author_id, question) VALUES
  ('e9930000-2222-0000-0000-000000000001', 'e9930000-1111-0000-0000-000000000001', 'e9930000-0000-0000-0000-00000000000b', 'È senza glutine?'),
  ('e9930000-2222-0000-0000-000000000002', 'e9930000-1111-0000-0000-000000000001', 'e9930000-0000-0000-0000-00000000000c', 'Quanto pesa?'),
  ('e9930000-2222-0000-0000-000000000003', 'e9930000-1111-0000-0000-000000000001', 'e9930000-0000-0000-0000-00000000000a', 'Domanda del negozio'),
  ('e9930000-2222-0000-0000-000000000004', 'e9930000-1111-0000-0000-000000000001', 'e9930000-0000-0000-0000-00000000000b', 'Si può congelare?'),
  ('e9930000-2222-0000-0000-000000000005', 'e9930000-1111-0000-0000-000000000001', 'e9930000-0000-0000-0000-00000000000c', 'Domanda da nascondere'),
  ('e9930000-2222-0000-0000-000000000006', 'e9930000-1111-0000-0000-000000000001', 'e9930000-0000-0000-0000-00000000000b', 'Ha il lievito madre?'),
  ('e9930000-2222-0000-0000-000000000007', 'e9930000-1111-0000-0000-000000000001', 'e9930000-0000-0000-0000-00000000000c', 'A che ora esce dal forno?'),
  ('e9930000-2222-0000-0000-000000000008', 'e9930000-1111-0000-0000-000000000001', 'e9930000-0000-0000-0000-00000000000b', 'Si può avere affettato?'),
  ('e9930000-2222-0000-0000-000000000009', 'e9930000-1111-0000-0000-000000000001', 'e9930000-0000-0000-0000-00000000000c', 'Va bene per i bambini?');
RESET mycity.allow_profile_write;

-- Il negozio risponde dal browser con l'answered_by indicato.
CREATE FUNCTION pg_temp.rispondi(p_domanda uuid, p_answered_by uuid) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"e9930000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
  SET LOCAL ROLE authenticated;
  UPDATE public.product_questions
     SET answer = 'Risposta.', answered_at = now(), answered_by = p_answered_by
   WHERE id = p_domanda;
  GET DIAGNOSTICS n = ROW_COUNT;
  RESET ROLE;
  RETURN CASE WHEN n = 1 THEN 'ok' ELSE 'righe ' || n END;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  RETURN SQLSTATE || ' ' || SQLERRM;
END $$;

CREATE FUNCTION pg_temp.voci(p_chi uuid) RETURNS int
LANGUAGE sql AS $$
  SELECT count(*)::int FROM public.notifications WHERE user_id = p_chi AND title ~* 'risposto';
$$;

-- Letture dopo l'aggiornamento (funzioni VOLATILE: vedono la riga già scritta).
CREATE FUNCTION pg_temp.firma(p_domanda uuid) RETURNS text
LANGUAGE sql AS $$
  SELECT coalesce(answered_by::text, '∅') FROM public.product_questions WHERE id = p_domanda;
$$;
CREATE FUNCTION pg_temp.pubblica(p_domanda uuid) RETURNS boolean
LANGUAGE sql AS $$
  SELECT is_public FROM public.product_questions WHERE id = p_domanda;
$$;
CREATE FUNCTION pg_temp.nascoste(p_prodotto uuid) RETURNS int
LANGUAGE sql AS $$
  SELECT count(*)::int FROM public.product_questions WHERE product_id = p_prodotto AND is_public IS NOT TRUE;
$$;

INSERT INTO esiti SELECT '1 answered_by uguale all''autore: l''avviso al cliente parte lo stesso',
  e = 'ok' AND pg_temp.voci('e9930000-0000-0000-0000-00000000000b') = 1,
  e || ' · voci: ' || pg_temp.voci('e9930000-0000-0000-0000-00000000000b')
  FROM pg_temp.rispondi('e9930000-2222-0000-0000-000000000001', 'e9930000-0000-0000-0000-00000000000b') AS e;
INSERT INTO esiti SELECT '2 risposta normale: l''avviso parte',
  e = 'ok' AND pg_temp.voci('e9930000-0000-0000-0000-00000000000c') = 1,
  e || ' · voci: ' || pg_temp.voci('e9930000-0000-0000-0000-00000000000c')
  FROM pg_temp.rispondi('e9930000-2222-0000-0000-000000000002', 'e9930000-0000-0000-0000-00000000000a') AS e;
INSERT INTO esiti SELECT '3 il negozio risponde a una domanda sua: nessun avviso a se stesso',
  e = 'ok' AND pg_temp.voci('e9930000-0000-0000-0000-00000000000a') = 0,
  e || ' · voci: ' || pg_temp.voci('e9930000-0000-0000-0000-00000000000a')
  FROM pg_temp.rispondi('e9930000-2222-0000-0000-000000000003', 'e9930000-0000-0000-0000-00000000000a') AS e;

INSERT INTO esiti SELECT '4 answered_by con un altro utente: resta chi ha scritto la risposta',
  e = 'ok' AND pg_temp.firma('e9930000-2222-0000-0000-000000000004') = 'e9930000-0000-0000-0000-00000000000a',
  e || ' · answered_by: ' || pg_temp.firma('e9930000-2222-0000-0000-000000000004')
  FROM pg_temp.rispondi('e9930000-2222-0000-0000-000000000004', 'e9930000-0000-0000-0000-00000000000c') AS e;

-- Il negozio prova a nascondere le domande con un UPDATE senza filtro.
CREATE FUNCTION pg_temp.nascondi_tutto() RETURNS text
LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"e9930000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
  SET LOCAL ROLE authenticated;
  UPDATE public.product_questions SET is_public = false;
  GET DIAGNOSTICS n = ROW_COUNT;
  RESET ROLE;
  RETURN 'righe ' || n;
EXCEPTION WHEN insufficient_privilege THEN
  RESET ROLE;
  RETURN 'fermato';
END $$;
INSERT INTO esiti SELECT '5 il negozio non cambia is_public',
  e = 'fermato' AND pg_temp.nascoste('e9930000-1111-0000-0000-000000000001') = 0,
  e || ' · nascoste: ' || pg_temp.nascoste('e9930000-1111-0000-0000-000000000001') FROM pg_temp.nascondi_tutto() AS e;

-- L'amministratore, dal browser.
CREATE FUNCTION pg_temp.admin_nasconde(p_domanda uuid) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"e9930000-0000-0000-0000-00000000000d","role":"authenticated"}', true);
  SET LOCAL ROLE authenticated;
  UPDATE public.product_questions SET is_public = false WHERE id = p_domanda;
  GET DIAGNOSTICS n = ROW_COUNT;
  RESET ROLE;
  RETURN 'righe ' || n;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  RETURN SQLSTATE || ' ' || SQLERRM;
END $$;
INSERT INTO esiti SELECT '6 l''amministratore nasconde ancora una domanda',
  e = 'righe 1' AND pg_temp.pubblica('e9930000-2222-0000-0000-000000000005') IS FALSE,
  e FROM pg_temp.admin_nasconde('e9930000-2222-0000-0000-000000000005') AS e;

-- Il negozio aggiorna la domanda dal browser con le assegnazioni date.
CREATE FUNCTION pg_temp.negozio(p_domanda uuid, assegnazioni text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"e9930000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
  SET LOCAL ROLE authenticated;
  EXECUTE format('UPDATE public.product_questions SET %s WHERE id = %L', assegnazioni, p_domanda);
  GET DIAGNOSTICS n = ROW_COUNT;
  RESET ROLE;
  RETURN CASE WHEN n = 1 THEN 'ok' ELSE 'righe ' || n END;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  RETURN SQLSTATE || ' ' || SQLERRM;
END $$;
CREATE FUNCTION pg_temp.stato(p_domanda uuid) RETURNS text
LANGUAGE sql AS $$
  SELECT concat_ws(' | ', coalesce(answer, '∅'), coalesce(answered_by::text, '∅'),
                   CASE WHEN answered_at IS NULL THEN '∅' WHEN answered_at = now() THEN 'adesso' ELSE answered_at::text END)
    FROM public.product_questions WHERE id = p_domanda;
$$;

CREATE FUNCTION pg_temp.senza_firma(p_domanda uuid, p_risposta text) RETURNS boolean
LANGUAGE sql AS $$
  SELECT answer = p_risposta AND answered_by IS NULL AND answered_at IS NULL
    FROM public.product_questions WHERE id = p_domanda;
$$;

INSERT INTO esiti SELECT '7 risposta con una data a scelta: la data è quella di adesso',
  e = 'ok' AND pg_temp.stato('e9930000-2222-0000-0000-000000000006') = 'Ecco. | e9930000-0000-0000-0000-00000000000a | adesso',
  e || ' · ' || pg_temp.stato('e9930000-2222-0000-0000-000000000006')
  FROM pg_temp.negozio('e9930000-2222-0000-0000-000000000006',
         $s$answer = 'Ecco.', answered_at = '1990-01-01', answered_by = 'e9930000-0000-0000-0000-00000000000c'$s$) AS e;

-- ⑧: risposta già scritta il 2 gennaio 2026 dal negozio (preparata dal server).
SET LOCAL request.jwt.claims = '{"role":"service_role"}';
UPDATE public.product_questions
   SET answer = 'Alle sette.', answered_by = 'e9930000-0000-0000-0000-00000000000a', answered_at = '2026-01-02 10:00+00'
 WHERE id = 'e9930000-2222-0000-0000-000000000007';
INSERT INTO esiti SELECT '8 senza cambiare la risposta, data e firma restano quelle di prima',
  e = 'ok' AND pg_temp.stato('e9930000-2222-0000-0000-000000000007')
               = 'Alle sette. | e9930000-0000-0000-0000-00000000000a | ' || '2026-01-02 10:00+00'::timestamptz::text,
  e || ' · ' || pg_temp.stato('e9930000-2222-0000-0000-000000000007')
  FROM pg_temp.negozio('e9930000-2222-0000-0000-000000000007',
         $s$answered_at = '1990-01-01', answered_by = 'e9930000-0000-0000-0000-00000000000c'$s$) AS e;

INSERT INTO esiti SELECT '9 risposta tolta (vuota o spazi): firma e data tornano vuote',
  a = 'ok' AND b = 'ok' AND c = 'ok' AND d = 'ok'
    AND pg_temp.stato('e9930000-2222-0000-0000-000000000008') = '∅ | ∅ | ∅'
    AND pg_temp.senza_firma('e9930000-2222-0000-0000-000000000009', '   '),
  concat_ws(' / ', a, b, c, d, pg_temp.stato('e9930000-2222-0000-0000-000000000008'), pg_temp.stato('e9930000-2222-0000-0000-000000000009'))
  FROM pg_temp.rispondi('e9930000-2222-0000-0000-000000000008', 'e9930000-0000-0000-0000-00000000000a') AS a,
       pg_temp.rispondi('e9930000-2222-0000-0000-000000000009', 'e9930000-0000-0000-0000-00000000000a') AS b,
       pg_temp.negozio('e9930000-2222-0000-0000-000000000008', $s$answer = NULL$s$) AS c,
       pg_temp.negozio('e9930000-2222-0000-0000-000000000009', $s$answer = '   '$s$) AS d;

DO $$
DECLARE r record; rossi int;
BEGIN
  FOR r IN SELECT * FROM esiti ORDER BY nome LOOP
    RAISE INFO '%  %  — %', CASE WHEN r.ok THEN 'ok  ' ELSE 'ROTTO' END, r.nome, r.dettaglio;
  END LOOP;
  SELECT count(*) INTO rossi FROM esiti WHERE ok IS NOT TRUE;
  IF rossi > 0 OR (SELECT count(*) FROM esiti) <> 9 THEN
    RAISE EXCEPTION '% controlli su % sono rossi (S01-05)', rossi, (SELECT count(*) FROM esiti);
  END IF;
  RAISE INFO 'S01-05: % controlli verdi', (SELECT count(*) FROM esiti);
END $$;
ROLLBACK;

-- =============================================================================
-- R02 — Il nome del negozio ha un tetto anche nel database (80 caratteri, come il modulo)
-- =============================================================================
--   tests/sql/harness/apply.sh mycity_test && tests/sql/harness/run.sh mycity_test
--
-- Un negoziante collegato, coi suoi permessi, sul suo profilo (come il modulo «Dettagli negozio»):
-- ① non salva un nome di 81 caratteri
-- ② non salva un nome di 504 caratteri
-- ③ salva ancora un nome di 80 caratteri esatti (il tetto non chiude tutto)
-- ④ salva ancora un nome normale
-- Su un profilo vecchio col nome gia' oltre il tetto (entrato prima della regola: qui lo si scrive
-- aggirando la regola da superutente, vedi sotto):
-- ⑤ il negoziante salva la vetrina riscrivendo lo stesso nome (come fa il modulo) e passa
-- ⑥ se cambia il nome con un altro troppo lungo, no
-- Senza la correzione i passi ①, ② e ⑥ sono rossi: il nome lungo entra.
-- Tutto con ROLLBACK.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated;

INSERT INTO auth.users (id, email, raw_user_meta_data, email_confirmed_at) VALUES
  ('e0283000-0000-0000-0000-000000000001', 'forno-r02n@test.it',  '{"role":"seller"}', now()),
  ('e0283000-0000-0000-0000-000000000002', 'bottega-r02n@test.it', '{"role":"seller"}', now());

UPDATE public.profiles SET store_name = 'Forno R02'
 WHERE id = 'e0283000-0000-0000-0000-000000000001';

-- Un profilo vecchio col nome di 120 caratteri, entrato prima della regola: i trigger si saltano con
-- session_replication_role = replica (da superutente), dentro questa transazione che finisce con ROLLBACK.
DO $$
BEGIN
  PERFORM set_config('session_replication_role', 'replica', true);
  UPDATE public.profiles SET store_name = repeat('b', 120)
   WHERE id = 'e0283000-0000-0000-0000-000000000002';
  PERFORM set_config('session_replication_role', 'origin', true);
END $$;

RESET mycity.allow_profile_write;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"e0283000-0000-0000-0000-000000000001","role":"authenticated"}';

DO $$
DECLARE n int; t text;
BEGIN
  BEGIN
    UPDATE public.profiles SET store_name = repeat('a', 81)
     WHERE id = 'e0283000-0000-0000-0000-000000000001';
    GET DIAGNOSTICS n = ROW_COUNT;
    INSERT INTO esiti VALUES ('① negoziante: non salva un nome di 81 caratteri', false, n || ' righe col nome di 81 caratteri');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO esiti VALUES ('① negoziante: non salva un nome di 81 caratteri', true, SQLERRM);
  END;

  BEGIN
    UPDATE public.profiles SET store_name = repeat('Forno ', 84)
     WHERE id = 'e0283000-0000-0000-0000-000000000001';
    GET DIAGNOSTICS n = ROW_COUNT;
    INSERT INTO esiti VALUES ('② negoziante: non salva un nome di 504 caratteri', false, n || ' righe col nome di 504 caratteri');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO esiti VALUES ('② negoziante: non salva un nome di 504 caratteri', true, SQLERRM);
  END;

  BEGIN
    UPDATE public.profiles SET store_name = repeat('c', 80)
     WHERE id = 'e0283000-0000-0000-0000-000000000001';
    GET DIAGNOSTICS n = ROW_COUNT;
    SELECT store_name INTO t FROM public.profiles WHERE id = 'e0283000-0000-0000-0000-000000000001';
    INSERT INTO esiti VALUES ('③ negoziante: salva un nome di 80 caratteri esatti',
      n = 1 AND t = repeat('c', 80), n || ' righe, ' || coalesce(char_length(t)::text, '∅') || ' caratteri');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO esiti VALUES ('③ negoziante: salva un nome di 80 caratteri esatti', false, SQLERRM);
  END;

  BEGIN
    UPDATE public.profiles SET store_name = 'Panificio Rossi'
     WHERE id = 'e0283000-0000-0000-0000-000000000001';
    GET DIAGNOSTICS n = ROW_COUNT;
    SELECT store_name INTO t FROM public.profiles WHERE id = 'e0283000-0000-0000-0000-000000000001';
    INSERT INTO esiti VALUES ('④ negoziante: salva un nome normale',
      n = 1 AND t = 'Panificio Rossi', n || ' righe, nome «' || coalesce(t, '∅') || '»');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO esiti VALUES ('④ negoziante: salva un nome normale', false, SQLERRM);
  END;
END $$;

SET LOCAL request.jwt.claims = '{"sub":"e0283000-0000-0000-0000-000000000002","role":"authenticated"}';

DO $$
DECLARE n int; d text;
BEGIN
  BEGIN
    UPDATE public.profiles SET store_name = repeat('b', 120), store_description = 'Bottega storica'
     WHERE id = 'e0283000-0000-0000-0000-000000000002';
    GET DIAGNOSTICS n = ROW_COUNT;
    SELECT store_description INTO d FROM public.profiles WHERE id = 'e0283000-0000-0000-0000-000000000002';
    INSERT INTO esiti VALUES ('⑤ profilo vecchio: salva la vetrina riscrivendo lo stesso nome',
      n = 1 AND d = 'Bottega storica', n || ' righe, descrizione «' || coalesce(d, '∅') || '»');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO esiti VALUES ('⑤ profilo vecchio: salva la vetrina riscrivendo lo stesso nome', false, SQLERRM);
  END;

  BEGIN
    UPDATE public.profiles SET store_name = repeat('d', 90)
     WHERE id = 'e0283000-0000-0000-0000-000000000002';
    GET DIAGNOSTICS n = ROW_COUNT;
    INSERT INTO esiti VALUES ('⑥ profilo vecchio: non cambia il nome con un altro troppo lungo', false,
      n || ' righe col nome di 90 caratteri');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO esiti VALUES ('⑥ profilo vecchio: non cambia il nome con un altro troppo lungo', true, SQLERRM);
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

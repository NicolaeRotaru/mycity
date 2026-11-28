-- =============================================================================
-- Onda 2 · R06-002 — La posizione del negozio resta dentro Piacenza e dintorni
-- anche quando non passa dal modulo
-- =============================================================================
--   tests/sql/harness/apply.sh mycity_test && tests/sql/harness/run.sh mycity_test
--
-- Il profilo del negozio scrive store_lat e store_lng dal browser, con le
-- regole per riga: il controllo dell'area stava solo nel selettore. Qui il
-- negozio (sessione vera, ruolo authenticated) prova a scrivere una posizione a
-- Milano e il database la rifiuta. Senza la migrazione
-- 999q_la_posizione_del_negozio_resta_in_area il file e' ROSSO.
-- Tutto in transazione, ROLLBACK.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('e2000000-0000-0000-0000-000000000001', 'fornaio-e2@test.it', '{"role":"seller"}'),
  ('e2000000-0000-0000-0000-000000000002', 'storico-e2@test.it', '{"role":"seller"}');

UPDATE public.profiles
   SET is_approved = true, approval_status = 'approved', store_name = 'Pane E2', store_address = 'Via Roma 1, Piacenza'
 WHERE id IN ('e2000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000002');

-- Un negozio storico rimasto fuori riquadro prima della guardia (scritto a guardia spenta).
ALTER TABLE public.profiles DISABLE TRIGGER profiles_posizione_negozio_in_area;
UPDATE public.profiles SET store_lat = 45.4642, store_lng = 9.1900 WHERE id = 'e2000000-0000-0000-0000-000000000002';
ALTER TABLE public.profiles ENABLE TRIGGER profiles_posizione_negozio_in_area;

SET LOCAL mycity.allow_profile_write = '';

-- ── il negozio, dal browser ───────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"e2000000-0000-0000-0000-000000000001","role":"authenticated"}';

DO $$
DECLARE codice text;
BEGIN
  -- Dentro il riquadro (Piazza Cavalli): passa.
  UPDATE public.profiles SET store_lat = 45.0526, store_lng = 9.6930 WHERE id = 'e2000000-0000-0000-0000-000000000001';
  INSERT INTO esiti SELECT 'dentro Piacenza: la posizione si salva', store_lat = 45.0526 AND store_lng = 9.6930,
    format('%s,%s', store_lat, store_lng) FROM public.profiles WHERE id = 'e2000000-0000-0000-0000-000000000001';

  -- Milano: rifiutata con 23514, e la posizione di prima resta.
  BEGIN
    UPDATE public.profiles SET store_lat = 45.4642, store_lng = 9.1900 WHERE id = 'e2000000-0000-0000-0000-000000000001';
    codice := 'passata';
  EXCEPTION WHEN check_violation THEN
    codice := SQLSTATE;
  END;
  INSERT INTO esiti VALUES ('a Milano: rifiutata con 23514', codice = '23514', codice);
  INSERT INTO esiti SELECT 'a Milano: resta la posizione di prima', store_lat = 45.0526 AND store_lng = 9.6930,
    format('%s,%s', store_lat, store_lng) FROM public.profiles WHERE id = 'e2000000-0000-0000-0000-000000000001';

  -- Solo la longitudine fuori (a ovest del riquadro): rifiutata.
  BEGIN
    UPDATE public.profiles SET store_lng = 9.40 WHERE id = 'e2000000-0000-0000-0000-000000000001';
    codice := 'passata';
  EXCEPTION WHEN check_violation THEN
    codice := SQLSTATE;
  END;
  INSERT INTO esiti VALUES ('solo la longitudine fuori: rifiutata', codice = '23514', codice);

  -- Posizione tolta (NULL): ammessa, è il negozio che non l'ha ancora rimessa.
  UPDATE public.profiles SET store_lat = NULL, store_lng = NULL WHERE id = 'e2000000-0000-0000-0000-000000000001';
  INSERT INTO esiti SELECT 'posizione tolta: ammessa', store_lat IS NULL AND store_lng IS NULL, ''
    FROM public.profiles WHERE id = 'e2000000-0000-0000-0000-000000000001';
END $$;

-- ── il negozio storico fuori riquadro ─────────────────────────────────────
RESET ROLE;
SET LOCAL mycity.allow_profile_write = '1';
DO $$
DECLARE codice text := 'passata';
BEGIN
  -- Cambia il nome del negozio: la posizione non cambia, la guardia non lo blocca.
  BEGIN
    UPDATE public.profiles SET store_name = 'Storico E2 nuovo nome' WHERE id = 'e2000000-0000-0000-0000-000000000002';
    UPDATE public.profiles SET store_lat = store_lat WHERE id = 'e2000000-0000-0000-0000-000000000002';
  EXCEPTION WHEN check_violation THEN
    codice := SQLSTATE;
  END;
  INSERT INTO esiti VALUES ('negozio storico fuori riquadro: il resto del profilo si salva', codice = 'passata', codice);
END $$;

INSERT INTO esiti SELECT 'la guardia guarda solo le colonne della posizione',
  pg_get_triggerdef(t.oid) ~* 'before insert or update of store_lat, store_lng on public\.profiles', pg_get_triggerdef(t.oid)
  FROM pg_trigger t WHERE t.tgname = 'profiles_posizione_negozio_in_area';

SELECT nome, CASE WHEN ok THEN 'ok' ELSE 'ROTTO' END AS esito, dettaglio FROM esiti ORDER BY nome;

DO $$
DECLARE rossi int; elenco text; quanti int;
BEGIN
  SELECT count(*) INTO quanti FROM esiti;
  SELECT count(*), coalesce(string_agg(format('%s → %s', e.nome, e.dettaglio), E'\n  '), '')
    INTO rossi, elenco FROM esiti e WHERE e.ok IS NOT TRUE;
  IF quanti < 7 THEN RAISE EXCEPTION 'solo % controlli: ne manca qualcuno', quanti; END IF;
  IF rossi > 0 THEN
    RAISE EXCEPTION E'% controllo/i rosso/i sulla posizione del negozio:\n  %', rossi, elenco;
  END IF;
  RAISE NOTICE 'la posizione del negozio resta in area: % controlli verdi', quanti;
END $$;

ROLLBACK;

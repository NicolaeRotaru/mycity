-- =============================================================================
-- L'ordine di servizio di SDG lo leggono solo l'admin e l'account di SDG (999c)
-- =============================================================================
-- Gira contro un database ricostruito dalle migrazioni vere (999c compresa):
--   tests/sql/harness/apply.sh mycity_test
--   tests/sql/harness/run.sh   mycity_test
--
-- 27/11/2026 — Nicola: quando il titolare conferma l'abbonamento, «in automatico deve arrivare l'ordine del
-- servizio … nella pagina venditore di SDG». L'ordine (ordini_sdg) è il foglio di lavoro di SDG: dentro c'è
-- l'email dell'agente e il piano editoriale. Qui si prova, coi permessi di chi guarda, che:
--   · l'admin e l'account di SDG lo leggono;
--   · il titolare (anche entrato col suo account), un altro negozio e un visitatore no;
--   · dal browser nessuno lo scrive, nemmeno l'admin;
--   · agente e lavoro scritti sul preventivo restano chiusi ai browser come il preventivo (708).
-- Tutto in transazione con ROLLBACK: non lascia dati.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('c999c111-1111-4111-8111-111111111111', 'titolare-999c@test.it', '{"role":"seller"}'),
  ('c999c222-2222-4222-8222-222222222222', 'altro-999c@test.it',    '{"role":"seller"}'),
  ('c999c333-3333-4333-8333-333333333333', 'nicola-999c@test.it',   '{"role":"buyer"}');
UPDATE public.profiles SET role = 'admin' WHERE id = 'c999c333-3333-4333-8333-333333333333';
UPDATE public.profiles SET store_name = 'Caffè 999c' WHERE id = 'c999c111-1111-4111-8111-111111111111';

INSERT INTO public.preventivi_con_codice (seller_id, codice, stato, fascia_scelta, lavoro, agente_email)
VALUES ('c999c111-1111-4111-8111-111111111111', repeat('9', 64), 'accettato', 'business',
        '11111111-2222-4333-8444-555555555555', 'agente-999c@test.it');

INSERT INTO public.ordini_sdg (seller_id, nome_attivita, fascia, canone_centesimi, agente_email, piano)
VALUES ('c999c111-1111-4111-8111-111111111111', 'Caffè 999c', 'business', 50000, 'agente-999c@test.it', '{"contenuti":[]}');

-- Chi legge, col ruolo del browser.
CREATE OR REPLACE FUNCTION pg_temp.quanti_ordini(chi uuid, ruolo text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', chi, 'role', ruolo)::text, true);
  EXECUTE format('SET LOCAL ROLE %I', ruolo);
  BEGIN
    SELECT count(*) INTO n FROM public.ordini_sdg;
    RESET ROLE;
    RETURN n::text;
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
    RETURN 'negato';
  END;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.prova_a_scrivere(chi uuid) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', chi, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE public.ordini_sdg SET fascia = 'premium';
    RESET ROLE;
    RETURN 'scritto';
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
    RETURN 'negato';
  END;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.legge_agente_del_preventivo(chi uuid) RETURNS text LANGUAGE plpgsql AS $$
DECLARE e text;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', chi, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    SELECT agente_email INTO e FROM public.preventivi_con_codice LIMIT 1;
    RESET ROLE;
    RETURN 'letto';
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
    RETURN 'negato';
  END;
END $$;

DO $$
DECLARE v text;
BEGIN
  v := pg_temp.quanti_ordini('c999c333-3333-4333-8333-333333333333', 'authenticated');
  INSERT INTO esiti VALUES ('l admin legge l ordine di SDG', v = '1', v);
  v := pg_temp.quanti_ordini('11111111-1111-1111-1111-5d9000000001', 'authenticated');
  INSERT INTO esiti VALUES ('l account di SDG legge l ordine', v = '1', v);
  v := pg_temp.quanti_ordini('c999c111-1111-4111-8111-111111111111', 'authenticated');
  INSERT INTO esiti VALUES ('il titolare entrato non legge l ordine di SDG', v = '0', v);
  v := pg_temp.quanti_ordini('c999c222-2222-4222-8222-222222222222', 'authenticated');
  INSERT INTO esiti VALUES ('un altro negozio non legge l ordine di SDG', v = '0', v);
  v := pg_temp.quanti_ordini('00000000-0000-0000-0000-000000000000', 'anon');
  INSERT INTO esiti VALUES ('un visitatore senza accesso (chi ha solo il link) non legge l ordine', v = 'negato', v);

  v := pg_temp.prova_a_scrivere('c999c333-3333-4333-8333-333333333333');
  INSERT INTO esiti VALUES ('l admin dal browser non cambia l ordine', v = 'negato', v);
  v := pg_temp.prova_a_scrivere('11111111-1111-1111-1111-5d9000000001');
  INSERT INTO esiti VALUES ('SDG dal browser non cambia l ordine', v = 'negato', v);

  v := pg_temp.legge_agente_del_preventivo('c999c111-1111-4111-8111-111111111111');
  INSERT INTO esiti VALUES ('il titolare non legge agente e lavoro del preventivo', v = 'negato', v);
  v := pg_temp.legge_agente_del_preventivo('c999c333-3333-4333-8333-333333333333');
  INSERT INTO esiti VALUES ('nemmeno l admin li legge dal browser: solo il server', v = 'negato', v);
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

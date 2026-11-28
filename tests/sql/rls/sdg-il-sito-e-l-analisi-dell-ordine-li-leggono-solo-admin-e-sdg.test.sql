-- =============================================================================
-- Il sito e l'analisi dell'ordine di SDG li leggono solo l'admin e SDG (999h)
-- =============================================================================
-- Gira contro un database ricostruito dalle migrazioni vere (999h compresa):
--   tests/sql/harness/apply.sh mycity_test
--   tests/sql/harness/run.sh   mycity_test
--
-- 28/11/2026 — Nicola: quando il cliente accetta nascono in automatico, in base all'abbonamento, il sito, il piano
-- editoriale e l'analisi. Sito e analisi stanno nell'ordine di SDG (colonne della 999h). Qui si prova, coi permessi
-- di chi guarda, che:
--   · l'admin e l'account di SDG leggono sito e analisi di tutti gli ordini;
--   · un titolare, entrato col suo account, dal browser non legge NESSUN ordine: né il suo né, soprattutto, quello
--     di un altro (il suo lavoro lo riceve dal server, filtrato sul suo id);
--   · un visitatore senza accesso non legge niente;
--   · dal browser nessuno scrive sito o analisi, nemmeno l'admin: nessuno «pubblica» o cambia una bozza;
--   · le forme sbagliate sono rifiutate: «pronto» senza il lavoro, un lavoro senza «pronto», «in corso» senza codice.
-- Tutto in transazione con ROLLBACK: non lascia dati.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('c999b111-1111-4111-8111-111111111111', 'titolare-a-999h@test.it', '{"role":"seller"}'),
  ('c999b222-2222-4222-8222-222222222222', 'titolare-b-999h@test.it', '{"role":"seller"}'),
  ('c999b333-3333-4333-8333-333333333333', 'nicola-999h@test.it',     '{"role":"buyer"}');
UPDATE public.profiles SET role = 'admin' WHERE id = 'c999b333-3333-4333-8333-333333333333';

INSERT INTO public.ordini_sdg (seller_id, nome_attivita, fascia, piano, sito, sito_stato, analisi, analisi_stato) VALUES
  ('c999b111-1111-4111-8111-111111111111', 'Bar A 999h', 'base',    '{"contenuti":[]}', '{"pagine":[{"titolo":"Home"}]}', 'pronto', '{"sintesi":["A"]}', 'pronto'),
  ('c999b222-2222-4222-8222-222222222222', 'Bar B 999h', 'premium', '{"contenuti":[]}', '{"pagine":[{"titolo":"Home B"}]}', 'pronto', NULL, 'da_collegare');

-- Quanti siti pronti vede chi guarda, col ruolo del browser; `solo` = cerca solo quello di quel negozio.
CREATE OR REPLACE FUNCTION pg_temp.quanti_siti(chi uuid, ruolo text, solo uuid DEFAULT NULL) RETURNS text LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', chi, 'role', ruolo)::text, true);
  EXECUTE format('SET LOCAL ROLE %I', ruolo);
  BEGIN
    SELECT count(*) INTO n FROM public.ordini_sdg WHERE sito IS NOT NULL AND (solo IS NULL OR seller_id = solo);
    RESET ROLE;
    RETURN n::text;
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
    RETURN 'negato';
  END;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.prova_a_scrivere(chi uuid, comando text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', chi, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    EXECUTE comando;
    GET DIAGNOSTICS n = ROW_COUNT;
    RESET ROLE;
    RETURN 'scritto ' || n;
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
    RETURN 'negato';
  END;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.rifiutato(comando text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE comando;
    RETURN 'passato';
  EXCEPTION WHEN check_violation THEN
    RETURN 'rifiutato';
  END;
END $$;

DO $$
DECLARE v text;
BEGIN
  v := pg_temp.quanti_siti('c999b333-3333-4333-8333-333333333333', 'authenticated');
  INSERT INTO esiti VALUES ('l admin legge il sito di tutti e due gli ordini', v = '2', v);
  v := pg_temp.quanti_siti('11111111-1111-1111-1111-5d9000000001', 'authenticated');
  INSERT INTO esiti VALUES ('l account di SDG legge il sito di tutti e due gli ordini', v = '2', v);

  v := pg_temp.quanti_siti('c999b111-1111-4111-8111-111111111111', 'authenticated', 'c999b222-2222-4222-8222-222222222222');
  INSERT INTO esiti VALUES ('il titolare A non legge il sito del titolare B', v = '0', v);
  v := pg_temp.quanti_siti('c999b222-2222-4222-8222-222222222222', 'authenticated', 'c999b111-1111-4111-8111-111111111111');
  INSERT INTO esiti VALUES ('il titolare B non legge il sito del titolare A', v = '0', v);
  v := pg_temp.quanti_siti('c999b111-1111-4111-8111-111111111111', 'authenticated');
  INSERT INTO esiti VALUES ('dal browser il titolare non legge nessun ordine, nemmeno il suo (lo riceve dal server)', v = '0', v);
  v := pg_temp.quanti_siti('00000000-0000-0000-0000-000000000000', 'anon');
  INSERT INTO esiti VALUES ('un visitatore senza accesso non legge niente', v = 'negato', v);

  v := pg_temp.prova_a_scrivere('c999b111-1111-4111-8111-111111111111', $q$UPDATE public.ordini_sdg SET sito = '{"pagine":[]}' WHERE seller_id = 'c999b222-2222-4222-8222-222222222222'$q$);
  INSERT INTO esiti VALUES ('il titolare A non cambia il sito del titolare B', v = 'negato', v);
  v := pg_temp.prova_a_scrivere('c999b333-3333-4333-8333-333333333333', $q$UPDATE public.ordini_sdg SET analisi_stato = 'errore'$q$);
  INSERT INTO esiti VALUES ('l admin dal browser non cambia l analisi', v = 'negato', v);
  v := pg_temp.prova_a_scrivere('11111111-1111-1111-1111-5d9000000001', $q$UPDATE public.ordini_sdg SET sito_stato = 'errore', sito = NULL$q$);
  INSERT INTO esiti VALUES ('SDG dal browser non cambia il sito', v = 'negato', v);

  v := pg_temp.rifiutato($q$UPDATE public.ordini_sdg SET sito_stato = 'pronto', sito = NULL WHERE nome_attivita = 'Bar A 999h'$q$);
  INSERT INTO esiti VALUES ('un sito «pronto» senza la bozza è rifiutato', v = 'rifiutato', v);
  v := pg_temp.rifiutato($q$UPDATE public.ordini_sdg SET analisi = '{"sintesi":["x"]}' WHERE nome_attivita = 'Bar B 999h'$q$);
  INSERT INTO esiti VALUES ('un analisi scritta senza «pronto» è rifiutata', v = 'rifiutato', v);
  v := pg_temp.rifiutato($q$UPDATE public.ordini_sdg SET analisi_stato = 'in_corso', lavoro_analisi = NULL WHERE nome_attivita = 'Bar B 999h'$q$);
  INSERT INTO esiti VALUES ('un analisi «in corso» senza il codice del lavoro è rifiutata', v = 'rifiutato', v);
  v := pg_temp.rifiutato($q$UPDATE public.ordini_sdg SET sito_stato = 'online' WHERE nome_attivita = 'Bar A 999h'$q$);
  INSERT INTO esiti VALUES ('non esiste uno stato «online»: la bozza non si pubblica da qui', v = 'rifiutato', v);

  -- I servizi scelti sul preventivo (28/11): solo i quattro del listino, almeno uno, nota di 200 caratteri al massimo.
  INSERT INTO public.preventivi_con_codice (seller_id, codice, stato, fascia_scelta, servizi_scelti, nota_agente)
  VALUES ('c999b111-1111-4111-8111-111111111111', repeat('8', 64), 'aperto', 'business', ARRAY['sito_web', 'analisi'], 'vuole far vedere la sala per le feste');
  v := pg_temp.rifiutato($q$UPDATE public.preventivi_con_codice SET servizi_scelti = ARRAY['volantini'] WHERE codice = repeat('8', 64)$q$);
  INSERT INTO esiti VALUES ('un servizio fuori elenco è rifiutato', v = 'rifiutato', v);
  v := pg_temp.rifiutato($q$UPDATE public.preventivi_con_codice SET servizi_scelti = ARRAY[]::text[] WHERE codice = repeat('8', 64)$q$);
  INSERT INTO esiti VALUES ('un elenco di servizi vuoto è rifiutato', v = 'rifiutato', v);
  v := pg_temp.rifiutato($q$UPDATE public.preventivi_con_codice SET nota_agente = repeat('x', 201) WHERE codice = repeat('8', 64)$q$);
  INSERT INTO esiti VALUES ('una nota dell agente oltre 200 caratteri è rifiutata', v = 'rifiutato', v);
  v := pg_temp.prova_a_scrivere('c999b111-1111-4111-8111-111111111111', $q$UPDATE public.preventivi_con_codice SET servizi_scelti = ARRAY['social']$q$);
  INSERT INTO esiti VALUES ('il titolare dal browser non cambia i servizi del suo preventivo', v = 'negato', v);
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

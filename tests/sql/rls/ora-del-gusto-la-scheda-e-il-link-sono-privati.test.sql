-- =============================================================================
-- Ora del Gusto — la scheda di n8n e il link col codice sono privati (migrazione 708)
-- =============================================================================
-- La scheda del locale la legge solo il suo negozio; il link col codice non lo legge nessun
-- browser (né il negozio, né un visitatore): solo il server. Nessuno scrive da fuori.
-- Ora del Gusto esiste in «modalità preventivo»: non approvata, senza richiesta di
-- approvazione, senza prodotti, col suo codice di 64 caratteri.
-- Tutto in transazione con ROLLBACK: non lascia dati.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('a7081111-1111-1111-1111-111111111111', 'altro-negozio-708@test.it', '{"role":"seller"}');

INSERT INTO public.schede_clienti (id_attivita, scheda)
VALUES ('0de1905e-7000-4000-8000-000000000001', '{"tipo":"scheda-cliente","campi":{}}'::jsonb);

RESET mycity.allow_profile_write;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.profiles
   WHERE id = '0de1905e-7000-4000-8000-000000000001' AND role = 'seller' AND NOT is_approved
     AND approval_status IS NULL AND store_name = 'Ora del Gusto' AND business_type = 'bar';
  INSERT INTO esiti VALUES ('Ora del Gusto esiste in modalità preventivo', n = 1, n || ' righe');
  SELECT count(*) INTO n FROM public.products WHERE seller_id = '0de1905e-7000-4000-8000-000000000001';
  INSERT INTO esiti VALUES ('Ora del Gusto non ha prodotti in vendita', n = 0, n || ' prodotti');
  SELECT count(*) INTO n FROM public.preventivi_con_codice
   WHERE seller_id = '0de1905e-7000-4000-8000-000000000001' AND stato = 'aperto' AND codice ~ '^[0-9a-f]{64}$';
  INSERT INTO esiti VALUES ('Ora del Gusto ha il suo codice, aperto', n = 1, n || ' righe');
END $$;

-- Il negozio stesso: legge la sua scheda, non legge il link, non scrive.
SET LOCAL request.jwt.claims = '{"sub":"0de1905e-7000-4000-8000-000000000001","role":"authenticated"}';
SET LOCAL ROLE authenticated;
DO $$
DECLARE n int; esito text;
BEGIN
  -- 864 (26/11/2026): la scheda si legge solo dal server, che sa cosa il negozio ha pagato.
  BEGIN
    SELECT count(*) INTO n FROM public.schede_clienti; esito := n || ' righe lette';
  EXCEPTION WHEN insufficient_privilege THEN esito := 'negato';
  END;
  INSERT INTO esiti VALUES ('il negozio non legge la scheda dal browser (864)', esito = 'negato', esito);
  BEGIN
    SELECT count(*) INTO n FROM public.preventivi_con_codice; esito := n || ' righe lette';
  EXCEPTION WHEN insufficient_privilege THEN esito := 'negato';
  END;
  INSERT INTO esiti VALUES ('il negozio non legge il link col codice', esito = 'negato', esito);
  BEGIN
    UPDATE public.schede_clienti SET scheda = '{"tipo":"finta"}'::jsonb; esito := 'scritta';
  EXCEPTION WHEN insufficient_privilege THEN esito := 'negato';
  END;
  INSERT INTO esiti VALUES ('il negozio non riscrive la scheda', esito = 'negato', esito);
END $$;
RESET ROLE;
RESET request.jwt.claims;

-- Un altro negozio: non vede la scheda di Ora del Gusto.
SET LOCAL request.jwt.claims = '{"sub":"a7081111-1111-1111-1111-111111111111","role":"authenticated"}';
SET LOCAL ROLE authenticated;
DO $$
DECLARE n int; esito text;
BEGIN
  BEGIN
    SELECT count(*) INTO n FROM public.schede_clienti; esito := n || ' righe lette';
  EXCEPTION WHEN insufficient_privilege THEN esito := 'negato';
  END;
  INSERT INTO esiti VALUES ('un altro negozio non vede la scheda', esito = 'negato', esito);
END $$;
RESET ROLE;
RESET request.jwt.claims;

-- Un visitatore senza account: niente di niente.
SET LOCAL ROLE anon;
DO $$
DECLARE esito text; n int;
BEGIN
  BEGIN
    SELECT count(*) INTO n FROM public.schede_clienti; esito := n || ' righe lette';
  EXCEPTION WHEN insufficient_privilege THEN esito := 'negato';
  END;
  INSERT INTO esiti VALUES ('il visitatore non legge le schede', esito = 'negato', esito);
  BEGIN
    SELECT count(*) INTO n FROM public.preventivi_con_codice; esito := n || ' righe lette';
  EXCEPTION WHEN insufficient_privilege THEN esito := 'negato';
  END;
  INSERT INTO esiti VALUES ('il visitatore non legge i codici', esito = 'negato', esito);
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
    RAISE EXCEPTION '% controlli su % sono rossi', rossi, (SELECT count(*) FROM esiti);
  END IF;
  RAISE INFO 'tutti verdi: % controlli', (SELECT count(*) FROM esiti);
END $$;

ROLLBACK;

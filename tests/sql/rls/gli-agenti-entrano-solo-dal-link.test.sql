-- =============================================================================
-- Gli agenti entrano solo dal link d'invito (migrazione 865)
-- =============================================================================
-- Il browser (visitatore o utente collegato) non legge e non scrive né gli inviti né gli agenti, e non può
-- usare un invito. Il server sì: un invito monouso si usa una volta sola; uno scaduto o ritirato mai.
-- Tutto in transazione con ROLLBACK: non lascia dati.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated, service_role;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('a8651111-1111-1111-1111-111111111111', 'curioso-865@test.it', '{"role":"customer"}'),
  ('a8652222-2222-2222-2222-222222222222', 'agente-865@test.it', '{"role":"customer"}');
INSERT INTO public.agenti (user_id, email) VALUES ('a8652222-2222-2222-2222-222222222222', 'agente-865@test.it');

INSERT INTO public.inviti_agente (codice_hash, creato_il, scade_il, usi_max, nota) VALUES
  (repeat('a', 64), now(), now() + interval '14 days', 1, 'monouso valido'),
  (repeat('b', 64), now() - interval '20 days', now() - interval '6 days', 1, 'scaduto'),
  (repeat('c', 64), now(), now() + interval '14 days', 1, 'ritirato');
UPDATE public.inviti_agente SET ritirato_il = now() WHERE codice_hash = repeat('c', 64);

RESET mycity.allow_profile_write;

-- Un utente collegato qualunque.
SET LOCAL request.jwt.claims = '{"sub":"a8651111-1111-1111-1111-111111111111","role":"authenticated"}';
SET LOCAL ROLE authenticated;
DO $$
DECLARE n int; esito text; u uuid;
BEGIN
  BEGIN SELECT count(*) INTO n FROM public.inviti_agente; esito := n || ' righe lette';
  EXCEPTION WHEN insufficient_privilege THEN esito := 'negato'; END;
  INSERT INTO esiti VALUES ('l utente collegato non legge gli inviti', esito = 'negato', esito);
  BEGIN SELECT count(*) INTO n FROM public.agenti; esito := n || ' righe lette';
  EXCEPTION WHEN insufficient_privilege THEN esito := 'negato'; END;
  INSERT INTO esiti VALUES ('l utente collegato non legge gli agenti', esito = 'negato', esito);
  BEGIN INSERT INTO public.agenti (user_id, email) VALUES ('a8651111-1111-1111-1111-111111111111', 'curioso-865@test.it'); esito := 'si è fatto agente';
  EXCEPTION WHEN insufficient_privilege THEN esito := 'negato'; END;
  INSERT INTO esiti VALUES ('l utente collegato non si fa agente da solo', esito = 'negato', esito);
  BEGIN SELECT public.usa_invito_agente(repeat('a', 64)) INTO u; esito := 'usato: ' || coalesce(u::text, 'null');
  EXCEPTION WHEN insufficient_privilege THEN esito := 'negato'; END;
  INSERT INTO esiti VALUES ('l utente collegato non usa un invito', esito = 'negato', esito);
  BEGIN PERFORM public.restituisci_invito_agente(gen_random_uuid()); esito := 'restituito';
  EXCEPTION WHEN insufficient_privilege THEN esito := 'negato'; END;
  INSERT INTO esiti VALUES ('l utente collegato non restituisce posti nei link', esito = 'negato', esito);
END $$;
RESET ROLE;

-- Il visitatore senza account.
SET LOCAL ROLE anon;
DO $$
DECLARE n int; esito text;
BEGIN
  BEGIN SELECT count(*) INTO n FROM public.inviti_agente; esito := n || ' righe lette';
  EXCEPTION WHEN insufficient_privilege THEN esito := 'negato'; END;
  INSERT INTO esiti VALUES ('il visitatore non legge gli inviti', esito = 'negato', esito);
  BEGIN UPDATE public.inviti_agente SET usi_max = 50; esito := 'cambiato';
  EXCEPTION WHEN insufficient_privilege THEN esito := 'negato'; END;
  INSERT INTO esiti VALUES ('il visitatore non cambia gli inviti', esito = 'negato', esito);
END $$;
RESET ROLE;

-- Il server.
SET LOCAL ROLE service_role;
DO $$
DECLARE primo uuid; secondo uuid; scaduto uuid; ritirato uuid; storto text;
BEGIN
  primo := public.usa_invito_agente(repeat('a', 64));
  secondo := public.usa_invito_agente(repeat('a', 64));
  INSERT INTO esiti VALUES ('il link monouso si usa una volta', primo IS NOT NULL AND secondo IS NULL, coalesce(primo::text, 'null') || ' / ' || coalesce(secondo::text, 'null'));
  scaduto := public.usa_invito_agente(repeat('b', 64));
  INSERT INTO esiti VALUES ('un link scaduto non si usa', scaduto IS NULL, coalesce(scaduto::text, 'null'));
  ritirato := public.usa_invito_agente(repeat('c', 64));
  INSERT INTO esiti VALUES ('un link ritirato non si usa', ritirato IS NULL, coalesce(ritirato::text, 'null'));
  BEGIN INSERT INTO public.inviti_agente (codice_hash, scade_il) VALUES ('codice-in-chiaro', now() + interval '1 day'); storto := 'entrato';
  EXCEPTION WHEN check_violation THEN storto := 'rifiutato'; END;
  INSERT INTO esiti VALUES ('il codice in chiaro non entra (solo l impronta)', storto = 'rifiutato', storto);
  -- Un agente è entrato davvero con quel link (la riga c'è): il posto NON torna libero, anche se lo si chiede.
  INSERT INTO public.agenti (user_id, email, invito_id) VALUES ('a8651111-1111-1111-1111-111111111111', 'curioso-865@test.it', primo);
  PERFORM public.restituisci_invito_agente(primo);
  INSERT INTO esiti VALUES ('il posto di un agente entrato davvero non torna libero (link monouso resta monouso)',
    (SELECT usi FROM public.inviti_agente WHERE id = primo) = 1 AND public.usa_invito_agente(repeat('a', 64)) IS NULL,
    (SELECT usi FROM public.inviti_agente WHERE id = primo)::text);
  -- Nessun agente scritto (l'attivazione si è fermata prima): il posto torna libero, e mai sotto zero.
  DELETE FROM public.agenti WHERE user_id = 'a8651111-1111-1111-1111-111111111111';
  PERFORM public.restituisci_invito_agente(primo);
  PERFORM public.restituisci_invito_agente(primo);
  INSERT INTO esiti VALUES ('il posto di un attivazione non riuscita torna libero, mai sotto zero',
    (SELECT usi FROM public.inviti_agente WHERE id = primo) = 0, (SELECT usi FROM public.inviti_agente WHERE id = primo)::text);
END $$;
RESET ROLE;

-- Il diritto all'oblio: l'account di un agente si cancella, e la sua riga se ne va con lui.
DO $$
DECLARE esito text; n int;
BEGIN
  BEGIN DELETE FROM auth.users WHERE id = 'a8652222-2222-2222-2222-222222222222'; esito := 'cancellato';
  EXCEPTION WHEN foreign_key_violation THEN esito := 'bloccato dalla chiave esterna'; END;
  SELECT count(*) INTO n FROM public.agenti WHERE user_id = 'a8652222-2222-2222-2222-222222222222';
  INSERT INTO esiti VALUES ('l account di un agente si cancella, e la riga di agente con lui', esito = 'cancellato' AND n = 0, esito || ', righe rimaste ' || n);
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

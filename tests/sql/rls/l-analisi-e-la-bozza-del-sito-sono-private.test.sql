-- =============================================================================
-- L'analisi del business e la bozza del sito sono private (migrazione 711)
-- =============================================================================
-- analisi_negozi e bozze_sito: il negozio legge solo la sua riga, un altro negozio no, un
-- visitatore niente. Dal browser nessuno scrive (né il negozio stesso): scrive solo il server.
-- Tutto in transazione con ROLLBACK: non lascia dati.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('a7111111-1111-1111-1111-111111111111', 'negozio-711@test.it', '{"role":"seller"}'),
  ('a7112222-2222-2222-2222-222222222222', 'altro-negozio-711@test.it', '{"role":"seller"}');

INSERT INTO public.analisi_negozi (id_attivita, sito, sito_il, canali_richiesti_il)
VALUES ('a7111111-1111-1111-1111-111111111111', '{"velocita":42}'::jsonb, now(), now());
INSERT INTO public.bozze_sito (id_attivita, bozza)
VALUES ('a7111111-1111-1111-1111-111111111111', '{"tipo":"bozza-sito"}'::jsonb);

RESET mycity.allow_profile_write;

-- Il negozio: legge le sue righe, non le riscrive e non ne aggiunge.
SET LOCAL request.jwt.claims = '{"sub":"a7111111-1111-1111-1111-111111111111","role":"authenticated"}';
SET LOCAL ROLE authenticated;
DO $$
DECLARE n int; esito text;
BEGIN
  SELECT count(*) INTO n FROM public.analisi_negozi;
  INSERT INTO esiti VALUES ('il negozio legge la sua analisi', n = 1, n || ' righe');
  SELECT count(*) INTO n FROM public.bozze_sito;
  INSERT INTO esiti VALUES ('il negozio legge la sua bozza', n = 1, n || ' righe');
  BEGIN
    UPDATE public.analisi_negozi SET sito = '{"velocita":100}'::jsonb; esito := 'scritta';
  EXCEPTION WHEN insufficient_privilege THEN esito := 'negato';
  END;
  INSERT INTO esiti VALUES ('il negozio non si alza il voto del sito', esito = 'negato', esito);
  BEGIN
    UPDATE public.analisi_negozi SET sito_il = NULL; esito := 'scritta';
  EXCEPTION WHEN insufficient_privilege THEN esito := 'negato';
  END;
  INSERT INTO esiti VALUES ('il negozio non salta il tetto di un''analisi al giorno', esito = 'negato', esito);
  BEGIN
    UPDATE public.bozze_sito SET bozza = '{"tipo":"finta"}'::jsonb; esito := 'scritta';
  EXCEPTION WHEN insufficient_privilege THEN esito := 'negato';
  END;
  INSERT INTO esiti VALUES ('il negozio non riscrive la bozza', esito = 'negato', esito);
  BEGIN
    DELETE FROM public.bozze_sito; esito := 'cancellata';
  EXCEPTION WHEN insufficient_privilege THEN esito := 'negato';
  END;
  INSERT INTO esiti VALUES ('il negozio non cancella la bozza', esito = 'negato', esito);
END $$;
RESET ROLE;
RESET request.jwt.claims;

-- Un altro negozio: non vede niente del primo, e non scrive per sé.
SET LOCAL request.jwt.claims = '{"sub":"a7112222-2222-2222-2222-222222222222","role":"authenticated"}';
SET LOCAL ROLE authenticated;
DO $$
DECLARE n int; esito text;
BEGIN
  SELECT count(*) INTO n FROM public.analisi_negozi;
  INSERT INTO esiti VALUES ('un altro negozio non vede l''analisi', n = 0, n || ' righe');
  SELECT count(*) INTO n FROM public.bozze_sito;
  INSERT INTO esiti VALUES ('un altro negozio non vede la bozza', n = 0, n || ' righe');
  BEGIN
    INSERT INTO public.analisi_negozi (id_attivita, canali_richiesti_il) VALUES ('a7112222-2222-2222-2222-222222222222', now()); esito := 'scritta';
  EXCEPTION WHEN insufficient_privilege THEN esito := 'negato';
  END;
  INSERT INTO esiti VALUES ('dal browser non si chiede un''analisi a n8n', esito = 'negato', esito);
END $$;
RESET ROLE;
RESET request.jwt.claims;

-- Un visitatore senza account: niente.
SET LOCAL ROLE anon;
DO $$
DECLARE esito text; n int;
BEGIN
  BEGIN
    SELECT count(*) INTO n FROM public.analisi_negozi; esito := n || ' righe lette';
  EXCEPTION WHEN insufficient_privilege THEN esito := 'negato';
  END;
  INSERT INTO esiti VALUES ('il visitatore non legge le analisi', esito = 'negato', esito);
  BEGIN
    SELECT count(*) INTO n FROM public.bozze_sito; esito := n || ' righe lette';
  EXCEPTION WHEN insufficient_privilege THEN esito := 'negato';
  END;
  INSERT INTO esiti VALUES ('il visitatore non legge le bozze', esito = 'negato', esito);
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

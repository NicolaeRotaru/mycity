-- =============================================================================
-- La mappa dei clienti da visitare (migrazione 999i)
-- =============================================================================
-- Il browser (visitatore o utente collegato, anche un agente) non legge e non scrive la tabella e non chiama la
-- funzione del giro: tutto passa dalle rotte del sito con la chiave di servizio. Il giro di n8n aggiorna i dati
-- dell'attività ma non tocca mai prenotazione e stato; non cancella un dossier che questa volta non c'è; spegne
-- (non cancella) chi è uscito dalla fila; lo stato della tabella n8n entra solo per un'attività nuova.
-- Tutto in transazione con ROLLBACK: non lascia dati.
-- =============================================================================

BEGIN;

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated, service_role;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('a999a111-1111-1111-1111-111111111111', 'agente-999i@test.it', '{"role":"customer"}');
INSERT INTO public.agenti (user_id, email) VALUES ('a999a111-1111-1111-1111-111111111111', 'agente-999i@test.it');
INSERT INTO public.clienti_da_visitare (osm, nome, dossier, settimana, prenotata_da, stato) VALUES
  ('node/9991', 'Forno di prova', 'Chi è: un forno', '2026-11-23', 'a999a111-1111-1111-1111-111111111111', 'si'),
  ('node/9992', 'Bar che chiude', NULL, NULL, NULL, 'da_visitare');

-- Un agente collegato (anche lui: la tabella la legge solo il server).
SET LOCAL request.jwt.claims = '{"sub":"a999a111-1111-1111-1111-111111111111","role":"authenticated"}';
SET LOCAL ROLE authenticated;
DO $$
DECLARE n int; esito text;
BEGIN
  BEGIN SELECT count(*) INTO n FROM public.clienti_da_visitare; esito := n || ' righe lette';
  EXCEPTION WHEN insufficient_privilege THEN esito := 'negato'; END;
  INSERT INTO esiti VALUES ('l utente collegato non legge la mappa dei clienti', esito = 'negato', esito);
  BEGIN UPDATE public.clienti_da_visitare SET prenotata_da = 'a999a111-1111-1111-1111-111111111111'; esito := 'prenotato';
  EXCEPTION WHEN insufficient_privilege THEN esito := 'negato'; END;
  INSERT INTO esiti VALUES ('l utente collegato non prenota dal browser', esito = 'negato', esito);
  BEGIN PERFORM public.ricevi_clienti_da_visitare('[]'::jsonb, now()); esito := 'chiamata';
  EXCEPTION WHEN insufficient_privilege THEN esito := 'negato'; END;
  INSERT INTO esiti VALUES ('l utente collegato non chiama il giro di n8n', esito = 'negato', esito);
END $$;
RESET ROLE;

SET LOCAL ROLE anon;
DO $$
DECLARE n int; esito text;
BEGIN
  BEGIN SELECT count(*) INTO n FROM public.clienti_da_visitare; esito := n || ' righe lette';
  EXCEPTION WHEN insufficient_privilege THEN esito := 'negato'; END;
  INSERT INTO esiti VALUES ('il visitatore non legge la mappa dei clienti', esito = 'negato', esito);
END $$;
RESET ROLE;

-- Il server: il giro del lunedì.
SET LOCAL ROLE service_role;
DO $$
DECLARE n int; r record;
BEGIN
  n := public.ricevi_clienti_da_visitare(
    '[{"osm":"node/9991","nome":"Forno di prova (nome nuovo)","lat":45.05,"lon":9.69,"punteggio":101.5,"dossier":"","settimana":"2026-11-30","stato_iniziale":"no"},
      {"osm":"node/9993","nome":"Gelateria nuova","lat":45.06,"lon":9.7,"punteggio":50,"stato_iniziale":"visitata"}]'::jsonb,
    now() + interval '1 minute');
  INSERT INTO esiti VALUES ('il giro riceve due attività', n = 2, n::text);
  SELECT * INTO r FROM public.clienti_da_visitare WHERE osm = 'node/9991';
  INSERT INTO esiti VALUES ('il giro aggiorna i dati dell attività', r.nome = 'Forno di prova (nome nuovo)' AND r.lat = 45.05 AND r.punteggio = 101.5, r.nome);
  INSERT INTO esiti VALUES ('il giro non tocca prenotazione e stato', r.prenotata_da = 'a999a111-1111-1111-1111-111111111111' AND r.stato = 'si', coalesce(r.prenotata_da::text, 'null') || ' ' || r.stato);
  INSERT INTO esiti VALUES ('un dossier assente non cancella quello di prima', r.dossier = 'Chi è: un forno', coalesce(r.dossier, 'null'));
  INSERT INTO esiti VALUES ('la settimana resta la prima', r.settimana = '2026-11-23', r.settimana::text);
  SELECT * INTO r FROM public.clienti_da_visitare WHERE osm = 'node/9993';
  INSERT INTO esiti VALUES ('lo stato della tabella n8n entra per un attività nuova', r.stato = 'visitata', r.stato);
  SELECT * INTO r FROM public.clienti_da_visitare WHERE osm = 'node/9992';
  INSERT INTO esiti VALUES ('chi esce dalla fila si spegne, non si cancella', r.osm IS NOT NULL AND r.in_fila = false, coalesce(r.in_fila::text, 'sparita'));
  -- Un reinvio vecchio non riaccende chi il giro nuovo ha spento, e non riporta indietro visto_il.
  PERFORM public.ricevi_clienti_da_visitare('[{"osm":"node/9992","nome":"Bar che chiude"}]'::jsonb, now() - interval '20 days');
  SELECT * INTO r FROM public.clienti_da_visitare WHERE osm = 'node/9992';
  INSERT INTO esiti VALUES ('un reinvio vecchio non riaccende una riga spenta', r.in_fila = false, r.in_fila::text);
  BEGIN PERFORM public.ricevi_clienti_da_visitare('[]'::jsonb, now() + interval '30 days'); INSERT INTO esiti VALUES ('un giro nel futuro si rifiuta', false, 'accettato');
  EXCEPTION WHEN raise_exception THEN INSERT INTO esiti VALUES ('un giro nel futuro si rifiuta', true, 'rifiutato'); END;
END $$;
RESET ROLE;

-- Il diritto all'oblio: l'account dell'agente si cancella, la prenotazione torna libera, lo stato resta.
DO $$
DECLARE esito text; r record;
BEGIN
  BEGIN DELETE FROM auth.users WHERE id = 'a999a111-1111-1111-1111-111111111111'; esito := 'cancellato';
  EXCEPTION WHEN foreign_key_violation THEN esito := 'bloccato dalla chiave esterna'; END;
  SELECT * INTO r FROM public.clienti_da_visitare WHERE osm = 'node/9991';
  INSERT INTO esiti VALUES ('l account di un agente si cancella e i suoi clienti tornano liberi', esito = 'cancellato' AND r.prenotata_da IS NULL AND r.stato = 'si', esito);
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

-- =============================================================================
-- R14-023 — Due segnali di accesso per lo stesso ingresso lasciano una riga sola
-- =============================================================================
-- Gira contro un database ricostruito dalle migrazioni vere:
--   tests/sql/harness/apply.sh mycity_test
--   tests/sql/harness/run.sh   mycity_test
--
-- Chi entra con email e password manda due segnali quasi insieme a /api/track.
-- La rotta tiene un accesso solo leggendo prima il registro e scrivendo dopo:
-- due segnali arrivati insieme leggono tutti e due «niente» e scrivono due
-- righe, perche' nel database nessuno lo impediva.
--
-- Il contratto: in `activity_events` la seconda copia dello stesso accesso
-- (stessa persona, stessa sessione del browser, meno di mezz'ora; o sessione
-- non nota, meno di un minuto) non entra, ed esce col codice della riga doppia
-- (23505), che la rotta tratta come «gia' registrato». Un accesso da un'altra
-- sessione, o nella stessa scheda dopo la mezz'ora, o di un'altra persona, entra
-- sempre; le altre righe del registro non cambiano.
--
-- Si scrive nella tabella che c'era gia', come fa la rotta (col ruolo del
-- server). Senza la migrazione 384 questa prova e' ROSSA. Tutto in transazione,
-- ROLLBACK.
-- =============================================================================

BEGIN;

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO service_role;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('e1423000-0000-0000-0000-000000000001', 'cliente-r14-023@test.it', '{"role":"buyer"}'),
  ('e1423000-0000-0000-0000-000000000002', 'altra-r14-023@test.it',   '{"role":"buyer"}');

-- Una scrittura di accesso come la fa la rotta: se il database la rifiuta come
-- riga doppia, lo si annota invece di fermare la prova.
CREATE FUNCTION pg_temp.scrivi_accesso(p_user uuid, p_sessione text, p_quando timestamptz DEFAULT now())
RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.activity_events (category, event_type, summary, user_id, actor_id, session_id, created_at)
  VALUES ('auth', 'login', 'Accesso effettuato', p_user, p_user, p_sessione, p_quando);
  RETURN 'scritta';
EXCEPTION WHEN unique_violation THEN
  RETURN 'doppione 23505';
END $$;

SET LOCAL ROLE service_role;

-- =============================================================================
-- ① Il primo segnale entra
-- =============================================================================
INSERT INTO esiti
SELECT '① premessa: il primo segnale dell accesso entra',
       e = 'scritta', e
  FROM (SELECT pg_temp.scrivi_accesso('e1423000-0000-0000-0000-000000000001', 'scheda-1') AS e) x;

-- =============================================================================
-- ② Il secondo segnale dello stesso accesso: stessa persona, stessa sessione
-- =============================================================================
INSERT INTO esiti
SELECT '② il secondo segnale uguale esce come riga doppia (23505)',
       e = 'doppione 23505', e
  FROM (SELECT pg_temp.scrivi_accesso('e1423000-0000-0000-0000-000000000001', 'scheda-1') AS e) x;

INSERT INTO esiti
SELECT '② per lo stesso ingresso resta una riga sola',
       count(*) = 1, format('%s righe', count(*))
  FROM public.activity_events
 WHERE user_id = 'e1423000-0000-0000-0000-000000000001' AND event_type = 'login' AND session_id = 'scheda-1';

-- =============================================================================
-- ③ Il segnale che non sa la sessione, nello stesso minuto, e' lo stesso accesso
-- =============================================================================
INSERT INTO esiti
SELECT '③ senza sessione, nello stesso minuto: e'' lo stesso accesso',
       e = 'doppione 23505', e
  FROM (SELECT pg_temp.scrivi_accesso('e1423000-0000-0000-0000-000000000001', NULL) AS e) x;

-- =============================================================================
-- ④ Le controprove: quello che deve entrare entra
-- =============================================================================
INSERT INTO esiti
SELECT '④ un altra sessione (un altro telefono) nello stesso istante entra',
       e = 'scritta', e
  FROM (SELECT pg_temp.scrivi_accesso('e1423000-0000-0000-0000-000000000001', 'scheda-2') AS e) x;

INSERT INTO esiti
SELECT '④ nella stessa scheda, 31 minuti fa, un accesso',
       e = 'scritta', e
  FROM (SELECT pg_temp.scrivi_accesso('e1423000-0000-0000-0000-000000000001', 'scheda-3', now() - interval '31 minutes') AS e) x;

INSERT INTO esiti
SELECT '④ nella stessa scheda, dopo la mezz ora, e'' un accesso nuovo',
       e = 'scritta', e
  FROM (SELECT pg_temp.scrivi_accesso('e1423000-0000-0000-0000-000000000001', 'scheda-3') AS e) x;

INSERT INTO esiti
SELECT '④ un altra persona con lo stesso id di sessione entra',
       e = 'scritta', e
  FROM (SELECT pg_temp.scrivi_accesso('e1423000-0000-0000-0000-000000000002', 'scheda-1') AS e) x;

DO $$
BEGIN
  INSERT INTO public.activity_events (category, event_type, user_id, session_id, path)
  VALUES ('visitor', 'page_view', 'e1423000-0000-0000-0000-000000000001', 'scheda-1', '/'),
         ('visitor', 'page_view', 'e1423000-0000-0000-0000-000000000001', 'scheda-1', '/');
  INSERT INTO esiti VALUES ('④ due pagine viste uguali restano due righe', true, 'scritte tutte e due');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO esiti VALUES ('④ due pagine viste uguali restano due righe', false, SQLSTATE || ' ' || SQLERRM);
END $$;

INSERT INTO esiti
SELECT '④ alla fine: gli accessi giusti, nessuno di troppo',
       count(*) = 4, format('%s accessi della prima persona (attesi 4: scheda-1, scheda-2, scheda-3 due volte)', count(*))
  FROM public.activity_events
 WHERE user_id = 'e1423000-0000-0000-0000-000000000001' AND event_type = 'login';

RESET ROLE;

-- =============================================================================
-- Verdetto
-- =============================================================================
DO $$
DECLARE r record; rossi int;
BEGIN
  FOR r IN SELECT * FROM esiti ORDER BY nome LOOP
    RAISE INFO '%  %  — %', CASE WHEN r.ok THEN 'ok  ' ELSE 'ROTTO' END, r.nome, r.dettaglio;
  END LOOP;
  SELECT count(*) INTO rossi FROM esiti WHERE ok IS NOT TRUE;
  IF rossi > 0 THEN
    RAISE EXCEPTION '% controlli rossi in questo file', rossi;
  END IF;
END $$;

ROLLBACK;

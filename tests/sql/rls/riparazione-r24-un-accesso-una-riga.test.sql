-- =============================================================================
-- R24 · Un accesso, una riga: i due segnali dello stesso ingresso non fanno due righe
-- =============================================================================
-- Gira contro un database ricostruito dalle migrazioni vere:
--   tests/sql/harness/apply.sh mycity_test
--   tests/sql/harness/run.sh   mycity_test
--
-- Il difetto: chi entra con email e password fa partire due segnali di accesso
-- quasi insieme, e la rotta /api/track legge-e-poi-scrive. Senza un freno sul
-- database, la seconda copia dello stesso accesso diventa una seconda riga nel
-- registro degli accessi (activity_events, event_type 'login').
--
-- Non cerca nomi di trigger o di funzioni: scrive le righe come le scrive la
-- rotta (ruolo service_role) e conta quelle che restano. Controlla anche che chi
-- scrive un accesso tenga il lucchetto della persona fino alla fine della sua
-- transazione: è quello che mette in fila due segnali che arrivano insieme.
-- Senza la correzione è rossa. Tutto in transazione con ROLLBACK.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';

CREATE TEMP TABLE esiti (nome text, verde boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO service_role;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('e0242400-0000-0000-0000-00000000000a', 'r24-acc-a@test.it', '{"role":"buyer","full_name":"Accesso A"}'),
  ('e0242400-0000-0000-0000-00000000000b', 'r24-acc-b@test.it', '{"role":"buyer","full_name":"Accesso B"}'),
  ('e0242400-0000-0000-0000-00000000000c', 'r24-acc-c@test.it', '{"role":"buyer","full_name":"Accesso C"}'),
  ('e0242400-0000-0000-0000-00000000000d', 'r24-acc-d@test.it', '{"role":"buyer","full_name":"Accesso D"}'),
  ('e0242400-0000-0000-0000-00000000000e', 'r24-acc-e@test.it', '{"role":"buyer","full_name":"Accesso E"}'),
  ('e0242400-0000-0000-0000-00000000000f', 'r24-acc-f@test.it', '{"role":"buyer","full_name":"Accesso F"}');

RESET mycity.allow_profile_write;

-- Aiuto: un segnale di accesso scritto come lo scrive la rotta (service_role).
CREATE OR REPLACE FUNCTION pg_temp.accesso(p_chi uuid, p_sessione text, p_fa interval DEFAULT interval '0') RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  SET LOCAL ROLE service_role;
  INSERT INTO public.activity_events (category, event_type, summary, actor_id, user_id, session_id, created_at)
  VALUES ('auth', 'login', 'Accesso effettuato', p_chi, p_chi, p_sessione, now() - p_fa);
  RESET ROLE;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.accessi(p_chi uuid) RETURNS int
LANGUAGE sql AS $$
  SELECT count(*)::int FROM public.activity_events WHERE user_id = p_chi AND event_type = 'login';
$$;

-- ── ① Stessa persona, stessa sessione, due segnali insieme: una riga ─────────
DO $$
DECLARE n int;
BEGIN
  PERFORM pg_temp.accesso('e0242400-0000-0000-0000-00000000000a', 'scheda-1');
  PERFORM pg_temp.accesso('e0242400-0000-0000-0000-00000000000a', 'scheda-1');
  n := pg_temp.accessi('e0242400-0000-0000-0000-00000000000a');
  INSERT INTO esiti VALUES ('1 due segnali dello stesso accesso fanno una riga sola', n = 1,
    format('righe di accesso: %s (attesa 1)', n));
END $$;

-- ── ② Un segnale con la sessione e uno senza, insieme: una riga (i due ordini) ─
DO $$
DECLARE n_d int; n_e int;
BEGIN
  PERFORM pg_temp.accesso('e0242400-0000-0000-0000-00000000000d', 'scheda-d');
  PERFORM pg_temp.accesso('e0242400-0000-0000-0000-00000000000d', NULL);
  PERFORM pg_temp.accesso('e0242400-0000-0000-0000-00000000000e', NULL);
  PERFORM pg_temp.accesso('e0242400-0000-0000-0000-00000000000e', 'scheda-e');
  n_d := pg_temp.accessi('e0242400-0000-0000-0000-00000000000d');
  n_e := pg_temp.accessi('e0242400-0000-0000-0000-00000000000e');
  INSERT INTO esiti VALUES ('2 con la sessione e senza, nello stesso istante, è lo stesso accesso', n_d = 1 AND n_e = 1,
    format('righe: %s e %s (attese 1 e 1)', n_d, n_e));
END $$;

-- ── ③ Un altro telefono subito dopo: è un altro accesso, si scrive sempre ────
DO $$
DECLARE n int;
BEGIN
  PERFORM pg_temp.accesso('e0242400-0000-0000-0000-00000000000b', 'telefono-mio');
  PERFORM pg_temp.accesso('e0242400-0000-0000-0000-00000000000b', 'telefono-di-un-altro');
  n := pg_temp.accessi('e0242400-0000-0000-0000-00000000000b');
  INSERT INTO esiti VALUES ('3 un accesso da un''altra sessione non si nasconde', n = 2,
    format('righe di accesso: %s (attese 2)', n));
END $$;

-- ── ④ Stessa scheda, ma il primo accesso è di 31 minuti fa: è un accesso nuovo ─
DO $$
DECLARE n int;
BEGIN
  PERFORM pg_temp.accesso('e0242400-0000-0000-0000-00000000000c', 'scheda-c', interval '31 minutes');
  PERFORM pg_temp.accesso('e0242400-0000-0000-0000-00000000000c', 'scheda-c');
  n := pg_temp.accessi('e0242400-0000-0000-0000-00000000000c');
  INSERT INTO esiti VALUES ('4 nella stessa scheda dopo mezz''ora è un accesso nuovo', n = 2,
    format('righe di accesso: %s (attese 2)', n));
END $$;

-- ── ⑤ Senza sessione, due minuti di distanza: sono due accessi ──────────────
DO $$
DECLARE n int;
BEGIN
  PERFORM pg_temp.accesso('e0242400-0000-0000-0000-00000000000f', NULL, interval '2 minutes');
  PERFORM pg_temp.accesso('e0242400-0000-0000-0000-00000000000f', NULL);
  n := pg_temp.accessi('e0242400-0000-0000-0000-00000000000f');
  INSERT INTO esiti VALUES ('5 senza sessione, a due minuti di distanza, sono due accessi', n = 2,
    format('righe di accesso: %s (attese 2)', n));
END $$;

-- ── ⑥ Le pagine viste non si toccano: due uguali restano due ─────────────────
DO $$
DECLARE n int;
BEGIN
  SET LOCAL ROLE service_role;
  INSERT INTO public.activity_events (category, event_type, user_id, session_id, path)
  VALUES ('visitor', 'page_view', 'e0242400-0000-0000-0000-00000000000a', 'scheda-1', '/'),
         ('visitor', 'page_view', 'e0242400-0000-0000-0000-00000000000a', 'scheda-1', '/');
  RESET ROLE;
  SELECT count(*) INTO n FROM public.activity_events
   WHERE user_id = 'e0242400-0000-0000-0000-00000000000a' AND event_type = 'page_view';
  INSERT INTO esiti VALUES ('6 le pagine viste non passano dal freno degli accessi', n = 2,
    format('pagine viste: %s (attese 2)', n));
END $$;

-- ── ⑦ Chi scrive un accesso tiene il lucchetto della persona fino alla fine ──
-- Due segnali insieme arrivano in due transazioni: se la prima non tiene niente,
-- la seconda non la aspetta e non la vede. Qui si guarda che, scritto un accesso
-- per una persona nuova, la transazione tenga un lucchetto in più.
DO $$
DECLARE prima int; dopo int;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
    ('e0242400-0000-0000-0000-000000000010', 'r24-acc-g@test.it', '{"role":"buyer","full_name":"Accesso G"}');
  SELECT count(*) INTO prima FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid() AND granted;
  PERFORM pg_temp.accesso('e0242400-0000-0000-0000-000000000010', 'scheda-g');
  SELECT count(*) INTO dopo FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid() AND granted;
  INSERT INTO esiti VALUES ('7 scrivere un accesso mette in fila gli altri della stessa persona', dopo > prima,
    format('lucchetti tenuti: prima %s, dopo %s (attesi di più dopo)', prima, dopo));
END $$;

-- ── Verdetto ──────────────────────────────────────────────────────────────
DO $$
DECLARE rossi int; elenco text;
BEGIN
  SELECT count(*), coalesce(string_agg(format('%s → %s', e.nome, e.dettaglio), E'\n  ' ORDER BY e.nome), '')
    INTO rossi, elenco
  FROM esiti e WHERE e.verde IS NOT TRUE;
  IF rossi > 0 THEN
    RAISE EXCEPTION E'R24 accessi: % controllo/i rosso/i sul registro degli accessi:\n  %', rossi, elenco;
  END IF;
  RAISE INFO 'R24 accessi: un accesso, una riga (% controlli verdi)', (SELECT count(*) FROM esiti);
END $$;

ROLLBACK;

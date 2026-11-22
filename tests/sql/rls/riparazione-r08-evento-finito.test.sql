-- =============================================================================
-- R08 — Non ci si iscrive a un evento finito o annullato (palestra del 7/11)
-- =============================================================================
--   tests/sql/harness/apply.sh mycity_test && tests/sql/harness/run.sh mycity_test
--
-- Un cliente collegato, coi suoi permessi:
-- ① non si iscrive a un evento «live» finito un minuto fa
-- ② non si iscrive a un evento annullato
-- ③ si iscrive ancora a un evento in corso (la regola non chiude tutto)
-- ④ si cancella ancora dall'evento in corso
-- ⑤ non sposta la sua iscrizione dall'evento in corso a quello finito (UPDATE di event_id)
-- ⑥ non la sposta dall'evento in corso a quello annullato
-- ⑦ un UPDATE che non cambia evento, sull'evento in corso, passa come prima
-- Prima della correzione i passi ①, ② (l'INSERT), ⑤ e ⑥ (l'UPDATE) sono rossi: la riga entra.
-- Tutto con ROLLBACK.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('e0800000-0000-0000-0000-000000000001', 'cliente-r08e@test.it', '{"role":"buyer"}');

INSERT INTO public.marketplace_events (id, title, description, starts_at, ends_at, status) VALUES
  ('e0800000-0000-0000-0000-0000000000e1', 'Mercatino appena finito', 'finito',
   now() - interval '2 hours', now() - interval '1 minute', 'live'),
  ('e0800000-0000-0000-0000-0000000000e2', 'Festa annullata', 'annullata',
   now() + interval '2 days', now() + interval '2 days 4 hours', 'cancelled'),
  ('e0800000-0000-0000-0000-0000000000e3', 'Mercatino in corso', 'in corso',
   now() - interval '1 hour', now() + interval '1 hour', 'live'),
  -- Altri due, solo per gli spostamenti: se ① o ② lasciano entrare la riga, lo spostamento non
  -- urta quella riga (stessa persona, stesso evento) e guarda solo la regola.
  ('e0800000-0000-0000-0000-0000000000e4', 'Fiera appena finita', 'finita',
   now() - interval '3 hours', now() - interval '1 minute', 'live'),
  ('e0800000-0000-0000-0000-0000000000e5', 'Sagra annullata', 'annullata',
   now() + interval '3 days', now() + interval '3 days 4 hours', 'cancelled');

RESET mycity.allow_profile_write;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"e0800000-0000-0000-0000-000000000001","role":"authenticated"}';

DO $$
DECLARE n int;
BEGIN
  BEGIN
    INSERT INTO public.event_rsvps (user_id, event_id)
    VALUES ('e0800000-0000-0000-0000-000000000001', 'e0800000-0000-0000-0000-0000000000e1');
    INSERT INTO esiti VALUES ('cliente: non si iscrive a un evento finito', false, 'iscrizione a un evento finito accettata');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO esiti VALUES ('cliente: non si iscrive a un evento finito', true, SQLERRM);
  END;

  BEGIN
    INSERT INTO public.event_rsvps (user_id, event_id)
    VALUES ('e0800000-0000-0000-0000-000000000001', 'e0800000-0000-0000-0000-0000000000e2');
    INSERT INTO esiti VALUES ('cliente: non si iscrive a un evento annullato', false, 'iscrizione a un evento annullato accettata');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO esiti VALUES ('cliente: non si iscrive a un evento annullato', true, SQLERRM);
  END;

  BEGIN
    INSERT INTO public.event_rsvps (user_id, event_id)
    VALUES ('e0800000-0000-0000-0000-000000000001', 'e0800000-0000-0000-0000-0000000000e3');
    INSERT INTO esiti VALUES ('cliente: si iscrive all''evento in corso', true, 'entrata');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO esiti VALUES ('cliente: si iscrive all''evento in corso', false, SQLERRM);
  END;

  BEGIN
    UPDATE public.event_rsvps SET event_id = 'e0800000-0000-0000-0000-0000000000e4'
     WHERE user_id = 'e0800000-0000-0000-0000-000000000001'
       AND event_id = 'e0800000-0000-0000-0000-0000000000e3';
    GET DIAGNOSTICS n = ROW_COUNT;
    INSERT INTO esiti VALUES ('cliente: non sposta l''iscrizione su un evento finito', false,
      n || ' iscrizioni spostate sull''evento finito');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO esiti VALUES ('cliente: non sposta l''iscrizione su un evento finito', true, SQLERRM);
  END;

  BEGIN
    UPDATE public.event_rsvps SET event_id = 'e0800000-0000-0000-0000-0000000000e5'
     WHERE user_id = 'e0800000-0000-0000-0000-000000000001'
       AND event_id = 'e0800000-0000-0000-0000-0000000000e3';
    GET DIAGNOSTICS n = ROW_COUNT;
    INSERT INTO esiti VALUES ('cliente: non sposta l''iscrizione su un evento annullato', false,
      n || ' iscrizioni spostate sull''evento annullato');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO esiti VALUES ('cliente: non sposta l''iscrizione su un evento annullato', true, SQLERRM);
  END;

  BEGIN
    UPDATE public.event_rsvps SET created_at = now()
     WHERE user_id = 'e0800000-0000-0000-0000-000000000001'
       AND event_id = 'e0800000-0000-0000-0000-0000000000e3';
    GET DIAGNOSTICS n = ROW_COUNT;
    INSERT INTO esiti VALUES ('cliente: un UPDATE che non cambia evento passa sull''evento in corso', n = 1,
      n || ' righe aggiornate');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO esiti VALUES ('cliente: un UPDATE che non cambia evento passa sull''evento in corso', false, SQLERRM);
  END;

  BEGIN
    DELETE FROM public.event_rsvps
     WHERE user_id = 'e0800000-0000-0000-0000-000000000001'
       AND event_id = 'e0800000-0000-0000-0000-0000000000e3';
    GET DIAGNOSTICS n = ROW_COUNT;
    INSERT INTO esiti VALUES ('cliente: si cancella dall''evento in corso', n = 1, n || ' righe cancellate');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO esiti VALUES ('cliente: si cancella dall''evento in corso', false, SQLERRM);
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

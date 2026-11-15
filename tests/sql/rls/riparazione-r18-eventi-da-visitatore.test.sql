-- =============================================================================
-- R18-018 — Chi non ha fatto l'accesso legge gli eventi (migrazione 422)
-- =============================================================================
--   tests/sql/harness/apply.sh mycity_test && tests/sql/harness/run.sh mycity_test
--
-- In produzione anon non legge la tabella profiles. Qui si toglie anche sul database
-- ricostruito, dentro la transazione, e poi:
-- ① da visitatore: eventi, negozio del mese e campagne si leggono senza errori
-- ② da visitatore: niente scritture
-- ③ da cliente collegato: legge gli eventi, non li scrive
-- ④ da amministratore: scrive, vede anche l'evento annullato, lo cambia e lo cancella
-- Senza la 422 i passi ① sono rossi: «permission denied for table profiles».
-- Tutto con ROLLBACK.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('e1800000-0000-0000-0000-000000000001', 'negozio-r18e@test.it', '{"role":"seller"}'),
  ('e1800000-0000-0000-0000-000000000002', 'cliente-r18e@test.it', '{"role":"buyer"}'),
  ('e1800000-0000-0000-0000-000000000003', 'capo-r18e@test.it',    '{"role":"admin"}');
UPDATE public.profiles SET is_approved = true, approval_status = 'approved', store_name = 'Bottega di prova'
 WHERE id = 'e1800000-0000-0000-0000-000000000001';
UPDATE public.profiles SET role = 'admin' WHERE id = 'e1800000-0000-0000-0000-000000000003';

INSERT INTO public.marketplace_events (id, title, description, starts_at, ends_at, status) VALUES
  ('e1800000-0000-0000-0000-0000000000e1', 'Mercatino di prova', 'in programma',
   now() + interval '3 days', now() + interval '3 days 4 hours', 'scheduled'),
  ('e1800000-0000-0000-0000-0000000000e2', 'Festa annullata', 'annullata',
   now() + interval '5 days', now() + interval '5 days 4 hours', 'cancelled');
DELETE FROM public.shop_of_month WHERE month = date_trunc('month', now())::date;
INSERT INTO public.shop_of_month (seller_id, month, headline)
VALUES ('e1800000-0000-0000-0000-000000000001', date_trunc('month', now())::date, 'Il forno del mese');
INSERT INTO public.cashback_campaigns (id, name, trigger_event, status)
VALUES ('e1800000-0000-0000-0000-0000000000c1', 'Benvenuto', 'first_order', 'active');

-- Come in produzione: i visitatori non leggono la tabella dei profili (R18-024).
REVOKE SELECT ON public.profiles FROM anon;

RESET mycity.allow_profile_write;

-- ── ① ② Il visitatore ───────────────────────────────────────────────────────
SET LOCAL ROLE anon;
SET LOCAL request.jwt.claims = '{"role":"anon"}';

DO $$
DECLARE n int;
BEGIN
  BEGIN
    SELECT count(*) INTO n FROM public.marketplace_events WHERE id::text LIKE 'e1800000-%';
    INSERT INTO esiti VALUES ('visitatore: legge l''evento in programma (e non l''annullato)', n = 1, n || ' righe');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO esiti VALUES ('visitatore: legge l''evento in programma (e non l''annullato)', false, SQLERRM);
  END;
  BEGIN
    SELECT count(*) INTO n FROM public.shop_of_month WHERE month = date_trunc('month', now())::date;
    INSERT INTO esiti VALUES ('visitatore: legge il negozio del mese', n = 1, n || ' righe');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO esiti VALUES ('visitatore: legge il negozio del mese', false, SQLERRM);
  END;
  BEGIN
    SELECT count(*) INTO n FROM public.cashback_campaigns WHERE id = 'e1800000-0000-0000-0000-0000000000c1';
    INSERT INTO esiti VALUES ('visitatore: legge la campagna attiva', n = 1, n || ' righe');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO esiti VALUES ('visitatore: legge la campagna attiva', false, SQLERRM);
  END;

  BEGIN
    INSERT INTO public.marketplace_events (title, description, starts_at, ends_at)
    VALUES ('Intruso', 'x', now(), now() + interval '1 hour');
    INSERT INTO esiti VALUES ('visitatore: non scrive un evento', false, 'scritto');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO esiti VALUES ('visitatore: non scrive un evento', true, SQLERRM);
  END;
  BEGIN
    UPDATE public.marketplace_events SET title = 'Rubato' WHERE id = 'e1800000-0000-0000-0000-0000000000e1';
    INSERT INTO esiti VALUES ('visitatore: non cambia un evento', false, 'cambiato');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO esiti VALUES ('visitatore: non cambia un evento', true, SQLERRM);
  END;
END $$;

-- ── ③ Il cliente collegato ─────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"e1800000-0000-0000-0000-000000000002","role":"authenticated"}';

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.marketplace_events WHERE id::text LIKE 'e1800000-%';
  INSERT INTO esiti VALUES ('cliente: legge l''evento in programma (e non l''annullato)', n = 1, n || ' righe');
  BEGIN
    INSERT INTO public.marketplace_events (title, description, starts_at, ends_at)
    VALUES ('Intruso', 'x', now(), now() + interval '1 hour');
    INSERT INTO esiti VALUES ('cliente: non scrive un evento', false, 'scritto');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO esiti VALUES ('cliente: non scrive un evento', true, SQLERRM);
  END;
  UPDATE public.marketplace_events SET title = 'Rubato' WHERE id = 'e1800000-0000-0000-0000-0000000000e1';
  GET DIAGNOSTICS n = ROW_COUNT;
  INSERT INTO esiti VALUES ('cliente: non cambia un evento', n = 0, n || ' righe cambiate');
  BEGIN
    INSERT INTO public.shop_of_month (seller_id, month) VALUES ('e1800000-0000-0000-0000-000000000001', '2030-01-01');
    INSERT INTO esiti VALUES ('cliente: non sceglie il negozio del mese', false, 'scritto');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO esiti VALUES ('cliente: non sceglie il negozio del mese', true, SQLERRM);
  END;
END $$;

-- ── ④ L'amministratore ─────────────────────────────────────────────────────
SET LOCAL request.jwt.claims = '{"sub":"e1800000-0000-0000-0000-000000000003","role":"authenticated"}';

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.marketplace_events WHERE id::text LIKE 'e1800000-%';
  INSERT INTO esiti VALUES ('admin: vede anche l''evento annullato', n = 2, n || ' righe');
  INSERT INTO public.marketplace_events (id, title, description, starts_at, ends_at)
  VALUES ('e1800000-0000-0000-0000-0000000000e3', 'Nuovo', 'x', now() + interval '1 day', now() + interval '1 day 1 hour');
  INSERT INTO esiti VALUES ('admin: crea un evento', true, '');
  UPDATE public.marketplace_events SET status = 'scheduled' WHERE id = 'e1800000-0000-0000-0000-0000000000e2';
  GET DIAGNOSTICS n = ROW_COUNT;
  INSERT INTO esiti VALUES ('admin: rimette in programma l''evento annullato', n = 1, n || ' righe cambiate');
  DELETE FROM public.marketplace_events WHERE id = 'e1800000-0000-0000-0000-0000000000e3';
  GET DIAGNOSTICS n = ROW_COUNT;
  INSERT INTO esiti VALUES ('admin: cancella un evento', n = 1, n || ' righe cancellate');
  UPDATE public.shop_of_month SET headline = 'Cambiato' WHERE month = date_trunc('month', now())::date;
  GET DIAGNOSTICS n = ROW_COUNT;
  INSERT INTO esiti VALUES ('admin: cambia il negozio del mese', n = 1, n || ' righe cambiate');
  UPDATE public.cashback_campaigns SET status = 'paused' WHERE id = 'e1800000-0000-0000-0000-0000000000c1';
  GET DIAGNOSTICS n = ROW_COUNT;
  INSERT INTO esiti VALUES ('admin: mette in pausa la campagna', n = 1, n || ' righe cambiate');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO esiti VALUES ('admin: scrive eventi, negozio del mese e campagne', false, SQLERRM);
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

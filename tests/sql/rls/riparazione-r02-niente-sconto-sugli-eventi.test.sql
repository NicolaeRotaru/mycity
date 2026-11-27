-- =============================================================================
-- R02 — Un evento non porta uno sconto che la cassa non applica
-- =============================================================================
--   tests/sql/harness/apply.sh mycity_test && tests/sql/harness/run.sh mycity_test
--
-- La pagina pubblica degli eventi (app/events/page.tsx) mostra «-{discount_percent}%» sulla copertina
-- di ogni evento che ha uno sconto salvato, ma nessun calcolo del prezzo legge marketplace_events: il
-- cliente vedeva «-20%» e pagava il prezzo pieno. Il modulo dell'amministratore non lo chiede piu',
-- ma il database lo accettava ancora (una chiamata diretta, o un evento salvato prima).
--
-- Un amministratore collegato, coi suoi permessi (come il pannello /admin/events):
-- ① non crea un evento con «20%»
-- ② non mette «20%» su un evento che c'e' gia'
-- ③ crea ancora un evento senza sconto
-- ④ cambia ancora lo stato di un evento (il pulsante «Vai live» del pannello)
-- ⑤ dopo tutto questo, nessun evento ha uno sconto da mostrare
-- Senza la correzione i passi ①, ② e ⑤ sono rossi: lo sconto entra e la pagina lo mostra.
-- Tutto con ROLLBACK.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('e0282000-0000-0000-0000-000000000003', 'capo-r02s@test.it', '{"role":"admin"}');
UPDATE public.profiles SET role = 'admin' WHERE id = 'e0282000-0000-0000-0000-000000000003';

INSERT INTO public.marketplace_events (id, title, description, starts_at, ends_at, status) VALUES
  ('e0282000-0000-0000-0000-0000000000e1', 'Mercatino r02s', 'in programma',
   now() + interval '3 days', now() + interval '3 days 4 hours', 'scheduled');

RESET mycity.allow_profile_write;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"e0282000-0000-0000-0000-000000000003","role":"authenticated"}';

DO $$
DECLARE n int; s int;
BEGIN
  BEGIN
    INSERT INTO public.marketplace_events (id, title, description, starts_at, ends_at, discount_percent)
    VALUES ('e0282000-0000-0000-0000-0000000000e2', 'Flash sale r02s', 'x',
            now() + interval '1 day', now() + interval '1 day 4 hours', 20);
    INSERT INTO esiti VALUES ('① admin: non crea un evento con «20%»', false, 'evento con sconto salvato');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO esiti VALUES ('① admin: non crea un evento con «20%»', true, SQLERRM);
  END;

  BEGIN
    UPDATE public.marketplace_events SET discount_percent = 20
     WHERE id = 'e0282000-0000-0000-0000-0000000000e1';
    GET DIAGNOSTICS n = ROW_COUNT;
    INSERT INTO esiti VALUES ('② admin: non mette «20%» su un evento che c''e'' gia''', false, n || ' righe con lo sconto');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO esiti VALUES ('② admin: non mette «20%» su un evento che c''e'' gia''', true, SQLERRM);
  END;

  BEGIN
    INSERT INTO public.marketplace_events (id, title, description, starts_at, ends_at, discount_percent)
    VALUES ('e0282000-0000-0000-0000-0000000000e3', 'Mercatino senza sconto r02s', 'x',
            now() + interval '2 days', now() + interval '2 days 4 hours', NULL);
    INSERT INTO esiti VALUES ('③ admin: crea ancora un evento senza sconto', true, '');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO esiti VALUES ('③ admin: crea ancora un evento senza sconto', false, SQLERRM);
  END;

  BEGIN
    UPDATE public.marketplace_events SET status = 'live'
     WHERE id = 'e0282000-0000-0000-0000-0000000000e1';
    GET DIAGNOSTICS n = ROW_COUNT;
    INSERT INTO esiti VALUES ('④ admin: cambia ancora lo stato di un evento', n = 1, n || ' righe cambiate');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO esiti VALUES ('④ admin: cambia ancora lo stato di un evento', false, SQLERRM);
  END;

  SELECT count(*) INTO s FROM public.marketplace_events
   WHERE id::text LIKE 'e0282000-%' AND discount_percent IS NOT NULL;
  INSERT INTO esiti VALUES ('⑤ nessun evento ha uno sconto da mostrare', s = 0, s || ' eventi con lo sconto');
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

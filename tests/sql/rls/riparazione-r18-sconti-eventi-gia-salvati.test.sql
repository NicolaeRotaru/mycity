-- =============================================================================
-- R18 — La 880 toglie davvero gli sconti degli eventi GIA' SALVATI
-- =============================================================================
--   tests/sql/harness/apply.sh mycity_test && tests/sql/harness/run.sh mycity_test
--
-- La migrazione 880 fa due cose: azzera discount_percent sugli eventi che l'hanno gia' (il badge
-- «-20%» che la cassa non applica) e poi mette il vincolo che lo tiene vuoto. La prova della 880
-- (riparazione-r02-niente-sconto-sugli-eventi) guarda solo il vincolo: su un database ricostruito da
-- zero, quando la 880 gira la tabella degli eventi e' vuota, e la pulizia non tocca niente.
--
-- Qui il database torna com'era PRIMA della 880 (senza il vincolo, con eventi salvati col loro
-- sconto: 20, 35, 0 e uno senza sconto), e si riesegue il file vero della migrazione:
-- ① nessun evento resta con uno sconto da mostrare
-- ② il vincolo torna, e un evento con lo sconto non si salva piu'
-- ③ il resto degli eventi non cambia (titolo e stato restano quelli)
-- ④ la migrazione si puo' rieseguire: la seconda volta non tocca niente e non si ferma
-- Senza la pulizia della 880, ① e' rosso. Tutto con ROLLBACK.
-- =============================================================================

BEGIN;

ALTER TABLE public.marketplace_events DROP CONSTRAINT marketplace_events_niente_sconto_senza_cassa;

INSERT INTO public.marketplace_events (id, title, description, starts_at, ends_at, status, discount_percent) VALUES
  ('e1820000-0000-0000-0000-0000000000e1', 'Inaugurazione r18', 'col «-20%» in vetrina',
   now() + interval '3 days', now() + interval '3 days 4 hours', 'scheduled', 20),
  ('e1820000-0000-0000-0000-0000000000e2', 'Festa del pane r18', 'col «-35%» in vetrina',
   now() - interval '1 hour', now() + interval '3 hours', 'live', 35),
  ('e1820000-0000-0000-0000-0000000000e3', 'Mercatino r18', 'sconto zero',
   now() + interval '5 days', now() + interval '5 days 4 hours', 'scheduled', 0),
  ('e1820000-0000-0000-0000-0000000000e4', 'Serata r18', 'senza sconto',
   now() + interval '6 days', now() + interval '6 days 4 hours', 'scheduled', NULL);

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
CREATE TEMP TABLE prima AS
  SELECT id, title, status FROM public.marketplace_events WHERE id::text LIKE 'e1820000-%';

-- Il file vero della migrazione, non una copia.
\ir ../../../migrations/880_un_evento_non_promette_uno_sconto_che_la_cassa_non_applica.sql

DO $$
DECLARE s int; c int; d int;
BEGIN
  SELECT count(*) INTO s FROM public.marketplace_events
   WHERE id::text LIKE 'e1820000-%' AND discount_percent IS NOT NULL;
  INSERT INTO esiti VALUES ('① nessun evento gia'' salvato resta con lo sconto', s = 0, s || ' eventi con lo sconto');

  SELECT count(*) INTO c FROM pg_constraint
   WHERE conname = 'marketplace_events_niente_sconto_senza_cassa'
     AND conrelid = 'public.marketplace_events'::regclass AND convalidated;
  BEGIN
    UPDATE public.marketplace_events SET discount_percent = 20
     WHERE id = 'e1820000-0000-0000-0000-0000000000e4';
    INSERT INTO esiti VALUES ('② il vincolo torna e lo sconto non si salva', false, c || ' vincoli; sconto salvato');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO esiti VALUES ('② il vincolo torna e lo sconto non si salva', c = 1, c || ' vincoli; ' || SQLERRM);
  END;

  SELECT count(*) INTO d FROM prima p JOIN public.marketplace_events e USING (id)
   WHERE e.title IS DISTINCT FROM p.title OR e.status IS DISTINCT FROM p.status;
  INSERT INTO esiti VALUES ('③ titolo e stato degli eventi non cambiano', d = 0 AND (SELECT count(*) FROM prima) = 4,
                            d || ' eventi cambiati su ' || (SELECT count(*) FROM prima));
END $$;

-- ④ Rieseguita: niente da togliere, e non si ferma sul vincolo che c'e' gia'.
\ir ../../../migrations/880_un_evento_non_promette_uno_sconto_che_la_cassa_non_applica.sql

DO $$
DECLARE s int; c int;
BEGIN
  SELECT count(*) INTO s FROM public.marketplace_events
   WHERE id::text LIKE 'e1820000-%' AND discount_percent IS NOT NULL;
  SELECT count(*) INTO c FROM pg_constraint
   WHERE conname = 'marketplace_events_niente_sconto_senza_cassa'
     AND conrelid = 'public.marketplace_events'::regclass;
  INSERT INTO esiti VALUES ('④ rieseguita non tocca niente e non si ferma', s = 0 AND c = 1, s || ' sconti, ' || c || ' vincoli');
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

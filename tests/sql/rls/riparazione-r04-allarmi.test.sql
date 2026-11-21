-- =============================================================================
-- R04-001 (21/11/2026) — La memoria degli allarmi (operational_alert_log) si
-- pulisce: le righe piu' vecchie dell'attesa piu' lunga (24 ore) se ne vanno.
-- =============================================================================
-- Le righe vecchie si mettono come stanno oggi nel database (scritte prima
-- della pulizia: i trigger spenti durante la semina), poi si scrive come
-- scrivono i giri degli avvisi (insert del turno, upsert dell'attesa, update
-- del turno scaduto) e si guarda cosa resta. Transazione con ROLLBACK.
-- =============================================================================

BEGIN;

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;

-- ① La memoria come la trova oggi la pulizia: righe di giorni fa, righe dentro l'attesa.
SET LOCAL session_replication_role = replica;
INSERT INTO public.operational_alert_log (alert_key, last_sent_at) VALUES
  ('ORDINE_DA_ACCETTARE|r04-vecchio',            now() - interval '3 days'),
  ('CAMPANELLA|ORDINE_DA_ACCETTARE|r04-vecchio', now() - interval '3 days'),
  ('SOS_PUSH|r04-vecchio',                       now() - interval '25 hours'),
  ('RECLAMO_FERMO|r04-dieci-ore',                now() - interval '10 hours'),
  ('CARRELLO_SCADUTO|r04-ventitre-ore',          now() - interval '23 hours'),
  ('ai-tetto-condiviso:ripiego-da',              now() - interval '5 days');
SET LOCAL session_replication_role = origin;

-- Un giro degli avvisi prende il turno di un avviso nuovo (insert, come `prendiIlTurno`).
INSERT INTO public.operational_alert_log (alert_key, last_sent_at)
VALUES ('ORDINE_DA_ACCETTARE|r04-nuovo', now());

DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM public.operational_alert_log WHERE alert_key LIKE '%r04-vecchio';
  INSERT INTO esiti VALUES ('le righe di piu'' di 24 ore se ne vanno alla scrittura dopo', n = 0,
    'righe vecchie rimaste: ' || n);

  SELECT count(*) INTO n FROM public.operational_alert_log
   WHERE alert_key IN ('RECLAMO_FERMO|r04-dieci-ore', 'CARRELLO_SCADUTO|r04-ventitre-ore');
  INSERT INTO esiti VALUES ('le righe dentro l''attesa di un giorno restano', n = 2, 'righe dentro le 24 ore: ' || n);

  SELECT count(*) INTO n FROM public.operational_alert_log WHERE alert_key = 'ai-tetto-condiviso:ripiego-da';
  INSERT INTO esiti VALUES ('l''inizio del guasto del tetto AI resta anche dopo giorni', n = 1, 'righe: ' || n);

  SELECT count(*) INTO n FROM public.operational_alert_log WHERE alert_key = 'ORDINE_DA_ACCETTARE|r04-nuovo';
  INSERT INTO esiti VALUES ('l''avviso appena ricordato resta', n = 1, 'righe: ' || n);
END $$;

-- ② Anche l'upsert dell'attesa (expire-checkouts, release-payouts) pulisce.
SET LOCAL session_replication_role = replica;
INSERT INTO public.operational_alert_log (alert_key, last_sent_at) VALUES
  ('PAYOUT_FERMO|r04-due-giorni', now() - interval '2 days');
SET LOCAL session_replication_role = origin;

INSERT INTO public.operational_alert_log (alert_key, last_sent_at)
VALUES ('CARRELLO_SCADUTO|r04-ventitre-ore', now())
ON CONFLICT (alert_key) DO UPDATE SET last_sent_at = EXCLUDED.last_sent_at;

DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM public.operational_alert_log WHERE alert_key = 'PAYOUT_FERMO|r04-due-giorni';
  INSERT INTO esiti VALUES ('l''upsert dell''attesa toglie le righe vecchie', n = 0, 'righe: ' || n);
END $$;

-- ③ Il turno che rinfresca una chiave scaduta (update) la tiene, e toglie le altre vecchie.
SET LOCAL session_replication_role = replica;
INSERT INTO public.operational_alert_log (alert_key, last_sent_at) VALUES
  ('RESO_FERMO|r04-trenta-ore',   now() - interval '30 hours'),
  ('UPTIME|r04-quattro-giorni',   now() - interval '4 days');
SET LOCAL session_replication_role = origin;

UPDATE public.operational_alert_log
   SET last_sent_at = now()
 WHERE alert_key IN ('RESO_FERMO|r04-trenta-ore')
   AND last_sent_at < now() - interval '6 hours';

DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM public.operational_alert_log WHERE alert_key = 'RESO_FERMO|r04-trenta-ore';
  INSERT INTO esiti VALUES ('la chiave rinfrescata dal turno resta', n = 1, 'righe: ' || n);

  SELECT count(*) INTO n FROM public.operational_alert_log WHERE alert_key = 'UPTIME|r04-quattro-giorni';
  INSERT INTO esiti VALUES ('l''update del turno toglie le altre righe vecchie', n = 0, 'righe: ' || n);
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

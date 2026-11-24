-- =============================================================================
-- R02 — La pulizia della memoria degli allarmi tiene un margine sopra le 24 ore,
-- e la ricerca delle righe vecchie ha un indice su last_sent_at.
-- =============================================================================
--   tests/sql/harness/apply.sh mycity_test && tests/sql/harness/run.sh mycity_test
--
-- ① una riga di 24 ore e 10 minuti resta dopo una scrittura: l'orologio del sito puo' essere
--   indietro rispetto al database, e per chi legge l'avviso giornaliero e' ancora dentro l'attesa
-- ② una riga di 24 ore e 1 minuto resta (il confine non e' piu' quello dell'attesa)
-- ③ una riga di 24 ore e 45 minuti se ne va (il margine non tiene tutto)
-- ④ una riga di 3 giorni se ne va
-- ⑤ c'e' un indice di operational_alert_log che comincia da last_sent_at
-- Senza la correzione ①, ② e ⑤ sono rossi. Transazione con ROLLBACK.
-- =============================================================================

BEGIN;

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;

-- La memoria come la trova la pulizia (trigger spenti durante la semina).
SET LOCAL session_replication_role = replica;
INSERT INTO public.operational_alert_log (alert_key, last_sent_at) VALUES
  ('ORDINE_DA_ACCETTARE|r02m-ventiquattro-e-dieci', now() - interval '24 hours 10 minutes'),
  ('CARRELLO_SCADUTO|r02m-ventiquattro-e-uno',      now() - interval '24 hours 1 minute'),
  ('RECLAMO_FERMO|r02m-ventiquattro-e-quarantacinque', now() - interval '24 hours 45 minutes'),
  ('UPTIME|r02m-tre-giorni',                        now() - interval '3 days');
SET LOCAL session_replication_role = origin;

-- Un giro degli avvisi ricorda un avviso nuovo: la scrittura pulisce.
INSERT INTO public.operational_alert_log (alert_key, last_sent_at)
VALUES ('ORDINE_DA_ACCETTARE|r02m-nuovo', now());

DO $$
DECLARE n bigint; nomi text;
BEGIN
  SELECT count(*) INTO n FROM public.operational_alert_log WHERE alert_key = 'ORDINE_DA_ACCETTARE|r02m-ventiquattro-e-dieci';
  INSERT INTO esiti VALUES ('① la riga di 24 ore e 10 minuti resta', n = 1, 'righe: ' || n);

  SELECT count(*) INTO n FROM public.operational_alert_log WHERE alert_key = 'CARRELLO_SCADUTO|r02m-ventiquattro-e-uno';
  INSERT INTO esiti VALUES ('② la riga di 24 ore e 1 minuto resta', n = 1, 'righe: ' || n);

  SELECT count(*) INTO n FROM public.operational_alert_log WHERE alert_key = 'RECLAMO_FERMO|r02m-ventiquattro-e-quarantacinque';
  INSERT INTO esiti VALUES ('③ la riga di 24 ore e 45 minuti se ne va', n = 0, 'righe: ' || n);

  SELECT count(*) INTO n FROM public.operational_alert_log WHERE alert_key = 'UPTIME|r02m-tre-giorni';
  INSERT INTO esiti VALUES ('④ la riga di 3 giorni se ne va', n = 0, 'righe: ' || n);

  SELECT count(*), coalesce(string_agg(i.relname, ', '), '—') INTO n, nomi
    FROM pg_index x
    JOIN pg_class i ON i.oid = x.indexrelid
    JOIN pg_attribute a ON a.attrelid = x.indrelid AND a.attnum = x.indkey[0]
   WHERE x.indrelid = 'public.operational_alert_log'::regclass
     AND a.attname = 'last_sent_at';
  INSERT INTO esiti VALUES ('⑤ c''e'' un indice che comincia da last_sent_at', n >= 1, 'indici: ' || nomi);
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

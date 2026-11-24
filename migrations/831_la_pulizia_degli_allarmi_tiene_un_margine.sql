-- 831_la_pulizia_degli_allarmi_tiene_un_margine.sql
--
-- IL DIFETTO. La pulizia della memoria degli allarmi (660, `operational_alert_log_toglie_le_vecchie`)
-- toglie le righe con last_sent_at piu' vecchio di 24 ore esatte, e 24 ore e' proprio l'attesa piu'
-- lunga che il sito legge in questa memoria (operational-alerts ATTESA_DI_UN_GIORNO_ORE,
-- expire-checkouts ORE_SILENZIO_CARRELLO). Il confine e' lo stesso, ma lo calcolano due orologi: la
-- pulizia con now() del database, chi legge con l'orologio del sito. Se quello del sito e' indietro di
-- qualche secondo, la riga di un avviso giornaliero sparisce mentre per chi legge e' ancora dentro
-- l'attesa, e l'avviso riparte prima del giorno. In piu' la ricerca delle righe vecchie, che gira a
-- ogni scrittura, non ha un indice su last_sent_at e legge tutta la tabella.
--
-- LA CURA.
--   · La pulizia tiene 24 ore e mezza: mezz'ora di margine sopra l'attesa piu' lunga copre lo
--     sfasamento fra i due orologi e un giro che parte in ritardo. Una riga oltre le 24 ore e mezza
--     non ferma nessun avviso, come prima. Se un giorno un'attesa si allunga oltre le 24 ore, va
--     allungato anche qui (lo diceva gia' la 660).
--   · Un indice su last_sent_at, per la ricerca delle righe vecchie.
-- Tutto il resto della funzione resta com'era nella 660 (la riga del tetto AI non si toglie, SKIP
-- LOCKED, trigger per istruzione).
--
-- Idempotente. NON si applica a mano: lo decide Nicola, come ogni migrazione.
-- REVERSIBILE: rieseguire la funzione della 660 e
--   DROP INDEX IF EXISTS public.operational_alert_log_last_sent_at_idx;
-- LA PROVA: tests/sql/rls/riparazione-r02-allarmi-col-margine.test.sql.

CREATE OR REPLACE FUNCTION public.operational_alert_log_toglie_le_vecchie()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.operational_alert_log
   WHERE alert_key IN (
     SELECT v.alert_key
       FROM public.operational_alert_log v
      WHERE v.last_sent_at < now() - interval '24 hours 30 minutes'
        AND v.alert_key <> 'ai-tetto-condiviso:ripiego-da'
        FOR UPDATE SKIP LOCKED
   );
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.operational_alert_log_toglie_le_vecchie() FROM PUBLIC, anon, authenticated;

CREATE INDEX IF NOT EXISTS operational_alert_log_last_sent_at_idx
  ON public.operational_alert_log (last_sent_at);

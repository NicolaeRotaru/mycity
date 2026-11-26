-- =============================================================================
-- 926 — Un accesso, una riga: anche quando i due segnali arrivano insieme
-- =============================================================================
-- Chi entra con email e password fa partire due segnali di accesso quasi
-- insieme: quello del catalogo eventi (`trackSignedIn`) e quello del tracker che
-- vede cambiare la sessione. La rotta `/api/track` tiene un accesso solo
-- (`accessoGiaRegistrato` in lib/activity.ts), ma legge e POI scrive: se i due
-- segnali si incrociano, tutti e due leggono «nessun accesso recente» e tutti e
-- due scrivono. Nel registro degli accessi — quello che si apre quando a
-- qualcuno rubano l'account — restano due righe per un ingresso solo, e il
-- cruscotto conta doppio. Il codice lo diceva: «il freno vero è sul database, è
-- nella migrazione proposta». Questa è quella migrazione.
--
-- La regola è la stessa della rotta, scritta qui una seconda volta perché è il
-- database a farla rispettare (le due finestre devono restare uguali a
-- FINESTRA_STESSA_SESSIONE_MS e FINESTRA_ACCESSO_DOPPIO_MS di lib/activity.ts):
--   ① stessa persona, stessa sessione del browser, meno di 30 minuti fa:
--      è la seconda copia dello stesso accesso, la riga non si scrive;
--   ② sessione diversa: è un altro accesso (un altro telefono), si scrive SEMPRE;
--   ③ sessione che non si sa (da una parte o dall'altra): meno di 60 secondi
--      fa è la seconda copia.
-- Si guardano gli ultimi 5 accessi della persona, come la rotta.
--
-- Perché un controllo e non un indice unico: la regola è a finestre di tempo e
-- dipende dalla sessione. Un indice su (persona, sessione) fermerebbe anche
-- l'accesso nuovo nella stessa scheda dopo un'ora; un indice su (persona,
-- minuto) fermerebbe l'accesso da un altro telefono nello stesso minuto, che è
-- proprio quello da vedere; e nessuno dei due ferma la coppia «un segnale con la
-- sessione, l'altro senza», che è il caso più comune. I due inserimenti arrivano
-- in due transazioni insieme e nessuna vede l'altra: il lucchetto per persona
-- (pg_advisory_xact_lock, fino alla fine della transazione) li mette in fila, e
-- il secondo vede il primo. La seconda copia si scarta in silenzio (la riga non
-- nasce, nessun errore): per chi scrive non è un guasto.
--
-- Le righe doppie che ci sono già NON si toccano e NON fermano la migrazione:
-- non c'è nessun indice da costruire, il controllo guarda solo le righe nuove.
-- Per vederle:
--   SELECT user_id, session_id, date_trunc('minute', created_at), count(*)
--     FROM public.activity_events
--    WHERE event_type = 'login'
--    GROUP BY 1, 2, 3 HAVING count(*) > 1;
--
-- Prova: tests/sql/rls/riparazione-r24-un-accesso-una-riga.test.sql
-- Per tornare indietro:
--   DROP TRIGGER IF EXISTS activity_events_un_accesso_una_riga ON public.activity_events;
--   DROP FUNCTION IF EXISTS public.activity_events_un_accesso_una_riga();
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.activity_events_un_accesso_una_riga()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sessione text := nullif(NEW.session_id, '');
  v_quando   timestamptz := coalesce(NEW.created_at, now());
BEGIN
  IF NEW.event_type IS DISTINCT FROM 'login' OR NEW.user_id IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('activity_events:login:' || NEW.user_id::text, 0));

  IF EXISTS (
    SELECT 1
      FROM (
        SELECT r.created_at, nullif(r.session_id, '') AS session_id
          FROM public.activity_events r
         WHERE r.user_id = NEW.user_id
           AND r.event_type = 'login'
         ORDER BY r.created_at DESC
         LIMIT 5
      ) recenti
     WHERE CASE
             WHEN v_sessione IS NOT NULL AND recenti.session_id IS NOT NULL
               THEN recenti.session_id = v_sessione
                    AND v_quando - recenti.created_at < interval '30 minutes'
             ELSE v_quando - recenti.created_at < interval '60 seconds'
           END
  ) THEN
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.activity_events_un_accesso_una_riga() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS activity_events_un_accesso_una_riga ON public.activity_events;
CREATE TRIGGER activity_events_un_accesso_una_riga
  BEFORE INSERT ON public.activity_events
  FOR EACH ROW
  WHEN (NEW.event_type = 'login' AND NEW.user_id IS NOT NULL)
  EXECUTE FUNCTION public.activity_events_un_accesso_una_riga();

COMMIT;

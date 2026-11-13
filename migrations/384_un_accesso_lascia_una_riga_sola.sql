-- 384_un_accesso_lascia_una_riga_sola.sql
--
-- R14-023 — Due segnali di accesso per lo stesso ingresso lasciavano due righe.
--
-- Chi entra con email e password fa partire due segnali quasi insieme verso
-- /api/track: quello del catalogo eventi e quello del tracker. La rotta tiene un
-- accesso solo leggendo prima il registro (lib/activity.ts, accessoGiaRegistrato)
-- e scrivendo dopo: fra la lettura e la scrittura c'e' una fessura, e due segnali
-- arrivati insieme leggono tutti e due «nessun accesso recente» e scrivono due
-- righe. Nel database nessun vincolo lo impediva.
--
-- PERCHE' NON UN INDICE UNICO. La regola che la deduplica usa oggi ha delle
-- finestre di tempo, sulla chiave persona + sessione del browser:
--   ① stessa sessione, meno di 30 minuti → e' lo stesso accesso; oltre la mezz'ora,
--      nella stessa scheda, e' un accesso nuovo e va scritto;
--   ② sessione diversa → e' un altro accesso, si scrive sempre (un altro telefono un
--      minuto dopo e' proprio il fatto da guardare quando rubano un account);
--   ③ sessione non nota da una delle due parti → meno di un minuto e' lo stesso accesso.
-- Un indice unico su (user_id, session_id) scarterebbe l'accesso nuovo dopo la mezz'ora
-- (①); uno su fasce di tempo lascerebbe passare due segnali a cavallo del bordo di una
-- fascia. L'equivalente esatto e' la stessa regola dentro il database, sotto un
-- lucchetto per persona: il secondo segnale aspetta che il primo sia scritto, lo vede,
-- e viene rifiutato con il codice della riga doppia (23505). Il codice lo tratta gia'
-- come «gia' registrato», non come un errore (lib/activity.ts, RIGA_GIA_PRESENTE).
--
-- Passano di qui solo gli accessi di una persona (event_type = 'login' con user_id):
-- pagine viste, azioni degli amministratori e cambi dei dati non pagano niente.
-- Le righe gia' presenti, doppie comprese, non si toccano e non bloccano niente: il
-- controllo vale per la riga che entra.
--
-- Idempotente: si puo' rieseguire.
-- REVERSIBILE: DROP TRIGGER IF EXISTS activity_events_un_accesso_una_riga ON public.activity_events;
--              DROP FUNCTION IF EXISTS public.activity_events_un_accesso_una_riga();

CREATE OR REPLACE FUNCTION public.activity_events_un_accesso_una_riga()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Un accesso alla volta per persona. Il lucchetto resta fino alla fine della
  -- transazione: il secondo segnale aspetta qui, e la lettura qui sotto (una
  -- lettura nuova, dopo l'attesa) vede la riga che il primo ha appena scritto.
  PERFORM pg_advisory_xact_lock(hashtextextended('activity_events:login:' || NEW.user_id::text, 0));

  IF EXISTS (
    SELECT 1
      FROM public.activity_events e
     WHERE e.user_id = NEW.user_id
       AND e.event_type = 'login'
       -- La distanza conta nei due versi: il segnale che ha preso il lucchetto per
       -- secondo puo' avere un orario di un soffio prima di quello che l'ha preso primo.
       AND e.created_at > NEW.created_at - interval '30 minutes'
       AND e.created_at < NEW.created_at + interval '30 minutes'
       AND (
             -- ① stessa sessione del browser, meno di mezz'ora
             (NEW.session_id IS NOT NULL AND e.session_id IS NOT NULL AND e.session_id = NEW.session_id)
             -- ③ sessione non nota da una delle due parti, meno di un minuto
          OR ((NEW.session_id IS NULL OR e.session_id IS NULL)
              AND e.created_at > NEW.created_at - interval '1 minute'
              AND e.created_at < NEW.created_at + interval '1 minute')
           )
       -- ② sessioni diverse e tutte e due note: nessuna condizione le prende
  ) THEN
    RAISE EXCEPTION 'activity_events: accesso gia'' registrato per questa persona e questa sessione'
      USING ERRCODE = 'unique_violation';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.activity_events_un_accesso_una_riga() IS
  'R14-023: un accesso (event_type login) per persona e sessione del browser, con le finestre di '
  'lib/activity.ts (30 minuti nella stessa sessione, 1 minuto se la sessione non si sa). Il doppione '
  'esce con 23505, che /api/track tratta come gia'' registrato.';

DROP TRIGGER IF EXISTS activity_events_un_accesso_una_riga ON public.activity_events;
CREATE TRIGGER activity_events_un_accesso_una_riga
  BEFORE INSERT ON public.activity_events
  FOR EACH ROW
  WHEN (NEW.event_type = 'login' AND NEW.user_id IS NOT NULL)
  EXECUTE FUNCTION public.activity_events_un_accesso_una_riga();

-- 165_la_coda_email_ha_un_eta_massima.sql
--
-- 31/10/2026 — LA CODA DELLE EMAIL NON AVEVA UNA SCADENZA.
--
-- `claim_pending_emails` (migrazione 150) prende ogni riga con `send_at`
-- passato, non spedita, non annullata, con meno di cinque tentativi. Nessun
-- limite verso il passato, e l'ordine e' dalla piu' vecchia. Con la posta
-- spenta il giro rinvia le righe di mezz'ora a ogni passaggio
-- (app/api/cron/send-emails, `rilasciaRiga`), senza tetto. Il giorno in cui
-- la posta si accende partivano insieme benvenuti di mesi prima, «il tuo
-- ordine e' pronto» per spese gia' ritirate, promozioni e «ci manchi» scaduti.
--
-- Non si puo' misurare l'eta' da `send_at`: il rinvio lo sposta in avanti a
-- ogni giro, ed e' proprio per questo che la riga non invecchiava mai. Serve
-- una data che nasce con la riga e non si muove piu': `scade_at`.
--
--   ① la colonna;
--   ② chi la scrive: un trigger prima dell'inserimento, cosi' vale per ogni
--      strada che mette righe in coda (iscrizione, ordine pronto/consegnato,
--      quelle future) senza toccarle una per una. L'ora prevista piu' tre
--      giorni: oltre, un messaggio di servizio dice una cosa non piu' vera e
--      uno commerciale disturba;
--   ③ le righe gia' in coda: per quelle mai rinviate `send_at` e' ancora
--      l'ora prevista; per quelle rinviate (hanno `last_error`) l'ora prevista
--      si e' persa, e si parte da quando la riga e' nata — e' la stima che
--      scade prima, scelta apposta: meglio un «ci manchi» non spedito che un
--      benvenuto di giugno;
--   ④ `claim_pending_emails` restituisce anche `scade_at`. A chiudere la riga
--      scaduta, col motivo, e' il giro della coda (`scaduta` nella route).
--
-- Idempotente: si puo' rieseguire.

-- ① La colonna
ALTER TABLE public.email_queue ADD COLUMN IF NOT EXISTS scade_at timestamptz;

-- ② Chi la scrive
CREATE OR REPLACE FUNCTION public.email_queue_mette_la_scadenza()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    IF NEW.scade_at IS NULL THEN
        NEW.scade_at := NEW.send_at + interval '3 days';
    END IF;
    RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.email_queue_mette_la_scadenza() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_email_queue_mette_la_scadenza ON public.email_queue;
CREATE TRIGGER trg_email_queue_mette_la_scadenza
    BEFORE INSERT ON public.email_queue
    FOR EACH ROW EXECUTE FUNCTION public.email_queue_mette_la_scadenza();

-- ③ Le righe gia' in coda
UPDATE public.email_queue
SET scade_at = (CASE WHEN last_error IS NULL THEN send_at ELSE created_at END) + interval '3 days'
WHERE scade_at IS NULL
  AND sent_at IS NULL
  AND cancelled_at IS NULL;

-- ④ La coda restituisce anche la scadenza
-- Stessa funzione della 150 (claim atomico, prenotazione di 15 minuti, massimo
-- cinque tentativi): cambia solo la colonna in piu' in uscita.
DROP FUNCTION IF EXISTS public.claim_pending_emails(int);
CREATE OR REPLACE FUNCTION public.claim_pending_emails(p_max int DEFAULT 50)
RETURNS TABLE (id uuid, user_id uuid, template text, attempts int, metadata jsonb, scade_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    WITH picked AS (
        SELECT q.id
        FROM public.email_queue q
        WHERE q.send_at <= now()
          AND q.sent_at IS NULL
          AND q.cancelled_at IS NULL
          AND q.attempts < 5
          AND (q.claimed_at IS NULL OR q.claimed_at < now() - interval '15 minutes')
        ORDER BY q.send_at
        LIMIT p_max
        FOR UPDATE SKIP LOCKED
    ),
    claimed AS (
        UPDATE public.email_queue q
        SET claimed_at = now()
        FROM picked
        WHERE q.id = picked.id
        RETURNING q.id, q.user_id, q.template, q.attempts, q.metadata, q.scade_at
    )
    SELECT c.id, c.user_id, c.template, c.attempts, c.metadata, c.scade_at FROM claimed c;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_pending_emails(int) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.claim_pending_emails(int) TO service_role;

NOTIFY pgrst, 'reload schema';

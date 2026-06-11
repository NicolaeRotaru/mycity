-- 085_email_queue_real_claim.sql
--
-- FIX affidabilità (doppio invio email).
-- claim_pending_emails (036) NON persisteva alcun claim: il CTE faceva
-- `SET sent_at = NULL` (no-op) e ritornava le righe "picked", non quelle
-- effettivamente reclamate. Due esecuzioni concorrenti del cron send-emails
-- potevano quindi selezionare le STESSE righe e inviare la stessa email due volte.
--
-- Aggiunge email_queue.claimed_at e rende il claim REALE e atomico:
--  - prende solo righe non inviate, non annullate e non già reclamate
--    (o con claim scaduto da >15 min, per recuperare run crashati);
--  - le marca claimed_at = now();
--  - ritorna SOLO le righe effettivamente reclamate.
-- L'endpoint, su invio riuscito, scrive sent_at; su errore rilascia il claim
-- (claimed_at = NULL) per il retry. Idempotente. CREATE OR REPLACE mantiene i grant.

ALTER TABLE public.email_queue ADD COLUMN IF NOT EXISTS claimed_at timestamptz;

CREATE OR REPLACE FUNCTION public.claim_pending_emails(p_max int DEFAULT 50)
RETURNS TABLE (id uuid, user_id uuid, template text)
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
        RETURNING q.id, q.user_id, q.template
    )
    SELECT c.id, c.user_id, c.template FROM claimed c;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_pending_emails(int) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.claim_pending_emails(int) TO service_role;

NOTIFY pgrst, 'reload schema';

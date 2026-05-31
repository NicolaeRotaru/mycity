-- 065: stripe_event_log.processed — fix idempotenza webhook (P2)
--
-- Prima il webhook inseriva l'event_id PRIMA di processarlo: se l'handler andava in
-- errore (500), il retry di Stripe trovava il 23505 e rispondeva 200 "duplicated"
-- SENZA riprocessare → evento perso (es. "pagato ma nessun ordine creato").
-- Ora marchiamo processed=true SOLO a fine handler riuscito; sul retry, se il record
-- esiste ma processed=false, riprocessiamo.
-- Idempotente.

ALTER TABLE public.stripe_event_log ADD COLUMN IF NOT EXISTS processed boolean NOT NULL DEFAULT false;
ALTER TABLE public.stripe_event_log ADD COLUMN IF NOT EXISTS processed_at timestamptz;

-- Gli eventi storici erano gestiti con la vecchia logica: marcali come processed.
UPDATE public.stripe_event_log SET processed = true WHERE processed = false;

NOTIFY pgrst, 'reload schema';

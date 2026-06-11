-- 084_operational_alert_dedup.sql
--
-- FIX affidabilità (alert fatigue).
-- Il cron operational-alerts re-inviava gli STESSI avvisi ad ogni esecuzione
-- (ogni 15 min), sommergendo gli admin di email/notifiche duplicate finché
-- l'anomalia non si risolveva. Introduce un log che permette di NON re-notificare
-- la stessa coppia (tipo + entità) entro un cooldown (gestito dall'endpoint).
--
-- Tabella server-only: RLS abilitato senza policy = accessibile solo a
-- service_role (default deny per anon/authenticated). Idempotente.

CREATE TABLE IF NOT EXISTS public.operational_alert_log (
    alert_key    text PRIMARY KEY,
    last_sent_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.operational_alert_log ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';

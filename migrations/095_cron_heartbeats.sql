-- 095_cron_heartbeats.sql
--
-- DEAD-MAN'S SWITCH dei cron (audit 🟠-25).
--
-- Contesto: i 7 cron (release-payouts, send-emails, send-push, expire-checkouts,
-- expire-stale-orders, abandoned-carts, process-deletions) sono schedulati
-- ESTERNAMENTE (cron-job.org). Se lo scheduler si ferma, il secret cambia o un
-- deploy rompe l'endpoint, NESSUNO se ne accorge: payout non versati, email in
-- coda, ordini orfani non chiusi. Mancava un segnale.
--
-- Meccanismo: ogni cron registra un heartbeat (withCronAuth fa upsert qui ad ogni
-- esecuzione autenticata); il cron operational-alerts confronta i heartbeat con
-- le soglie (lib/cron-health.ts) e allerta gli admin se un cron è fermo.
--
-- Seed con last_run_at = now() così il dead-man scatta solo se i cron SMETTONO di
-- girare (o non vengono mai schedulati) DOPO il deploy — non subito.
--
-- Accesso solo service_role (come operational_alert_log / email_queue): RLS on,
-- nessuna policy → anon/authenticated non leggono, il backend bypassa.
--
-- Idempotente.

CREATE TABLE IF NOT EXISTS public.cron_heartbeats (
  name        text PRIMARY KEY,
  last_run_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.cron_heartbeats ENABLE ROW LEVEL SECURITY;

INSERT INTO public.cron_heartbeats (name, last_run_at) VALUES
  ('release-payouts',     now()),
  ('send-emails',         now()),
  ('send-push',           now()),
  ('expire-checkouts',    now()),
  ('expire-stale-orders', now()),
  ('abandoned-carts',     now()),
  ('process-deletions',   now()),
  ('operational-alerts',  now())
ON CONFLICT (name) DO NOTHING;

NOTIFY pgrst, 'reload schema';

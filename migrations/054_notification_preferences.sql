-- =============================================================================
-- 054 — Preferenze notifiche su DB + base per opt-out email (Step 4)
-- =============================================================================
-- I toggle di /profile/settings stavano solo in localStorage e l'invio email
-- (cron lifecycle) non li rispettava. Li persistiamo su profiles. email_marketing
-- e notif_newsletter sono OPT-IN (default false) per conformità GDPR: il cron
-- marketing invierà solo a chi ha dato consenso. Additivo e idempotente.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS notif_order_updates boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notif_promos boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notif_groups boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notif_newsletter boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS email_marketing boolean NOT NULL DEFAULT false;

NOTIFY pgrst, 'reload schema';

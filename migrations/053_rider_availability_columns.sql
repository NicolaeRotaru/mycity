-- =============================================================================
-- 053 — Disponibilità rider su DB (Step 3)
-- =============================================================================
-- La pagina /rider/availability teneva online/orari/zone solo in localStorage
-- (perse al reload, non leggibili lato server per l'assegnazione ordini).
-- Le persistiamo su profiles (1:1 col rider, riusa la RLS di update del proprio
-- profilo). Additivo e idempotente.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS rider_is_online boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rider_schedule jsonb,
  ADD COLUMN IF NOT EXISTS rider_zones text[] NOT NULL DEFAULT '{}';

NOTIFY pgrst, 'reload schema';

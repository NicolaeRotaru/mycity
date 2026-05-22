-- 007: colonna store_logo su profiles
-- Idempotente.

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS store_logo text;

NOTIFY pgrst, 'reload schema';

-- 010: colonna store_hours su profiles
-- Formato: { "mon": [["09:00","13:00"],["15:30","19:30"]], "tue": [...], ..., "sun": [] }
-- Array vuoto = chiuso. Idempotente.

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS store_hours jsonb;

NOTIFY pgrst, 'reload schema';

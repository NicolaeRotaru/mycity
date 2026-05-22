-- 009: caratteristiche prodotto specifiche per categoria
-- Salviamo le caratteristiche come JSONB. Lo schema dei campi vive lato
-- codice (lib/category-attributes.ts) e cambia in base alla categoria.
-- Idempotente.

ALTER TABLE public.products
    ADD COLUMN IF NOT EXISTS attributes jsonb DEFAULT '{}'::jsonb;

NOTIFY pgrst, 'reload schema';

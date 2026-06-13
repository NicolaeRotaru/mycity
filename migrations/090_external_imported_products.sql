-- 090_external_imported_products.sql
-- Prodotti importati da marketplace esterni (Amazon/eBay/AliExpress).
-- Aggiunge a `products` i campi per: URL sorgente, marketplace, snapshot dati
-- esterni (prezzo + tempo di consegna), timestamp di sync e stato del sync.
-- Lo snapshot viene mostrato ai clienti e rinfrescato in background con TTL.
-- Tutto additivo + idempotente. I CHECK fungono da validazione lato server.

BEGIN;

-- 1) Nuove colonne prodotto --------------------------------------------------
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS external_source_url  text,
  ADD COLUMN IF NOT EXISTS external_marketplace text,
  ADD COLUMN IF NOT EXISTS external_data        jsonb,
  ADD COLUMN IF NOT EXISTS external_synced_at   timestamptz,
  ADD COLUMN IF NOT EXISTS external_sync_status text NOT NULL DEFAULT 'idle';

COMMENT ON COLUMN public.products.external_source_url  IS 'URL del prodotto sul marketplace di origine (Amazon/eBay/…). NULL = prodotto nativo.';
COMMENT ON COLUMN public.products.external_marketplace IS 'Marketplace di origine: ebay|amazon|aliexpress|other.';
COMMENT ON COLUMN public.products.external_data        IS 'Snapshot dati esterni: { price, currency, delivery_min_days, delivery_max_days, delivery_label, availability, source_title, fetched_at }.';
COMMENT ON COLUMN public.products.external_synced_at   IS 'Ultimo refresh riuscito dei dati esterni.';
COMMENT ON COLUMN public.products.external_sync_status IS 'Stato del sync: idle|pending|error. "pending" funge da lock per il debounce del refresh.';

-- Vincoli di dominio (autorità lato server). DROP+ADD per idempotenza.
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_external_marketplace_check;
ALTER TABLE public.products ADD  CONSTRAINT products_external_marketplace_check
  CHECK (external_marketplace IS NULL OR external_marketplace IN ('ebay','amazon','aliexpress','other'));

ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_external_sync_status_check;
ALTER TABLE public.products ADD  CONSTRAINT products_external_sync_status_check
  CHECK (external_sync_status IN ('idle','pending','error'));

-- 2) Indice per lo sweep degli snapshot scaduti (cron/refresh) ----------------
-- Parziale: indicizza solo i prodotti importati, evitando di gonfiare l'indice
-- con i (molti) prodotti nativi che non hanno una sorgente esterna.
CREATE INDEX IF NOT EXISTS idx_products_external_synced_at
  ON public.products (external_synced_at)
  WHERE external_source_url IS NOT NULL;

COMMIT;

NOTIFY pgrst, 'reload schema';

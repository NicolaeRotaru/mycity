-- 072 — Sito vetrina multi-pagina (store_site)
--
-- Colonna JSONB unica che descrive il "sito" che il negozio costruisce dentro il
-- marketplace (logica Shopify): più PAGINE, ognuna composta da SEZIONI ordinate e
-- attivabili, un MENU di navigazione e un TEMA. Gestito dal venditore via /seller/site.
--
-- Scelta single-column (vs nuove tabelle store_pages/store_sections/store_menu):
--  * la RLS è già column-agnostic ("Users can update their own profile" USING
--    auth.uid() = id) e i profili approvati sono leggibili pubblicamente → zero
--    nuove policy da scrivere/verificare;
--  * la vetrina si legge con la stessa SELECT su `profiles` (nessun join / N+1);
--  * un solo ADD COLUMN, un solo entry nei tipi generati, evolvibile senza migration.
-- La validazione di forma/contenuto + i limiti anti-abuso vivono in app
-- (lib/store-site.ts + zod), come già per store_customization (052), store_hours (010),
-- store_media (017).
--
-- Retro-compatibilità: default '{}' => nessun sito definito. In app `normalizeSite`
-- deriva una HOME di default che riproduce esattamente il layout fisso attuale
-- leggendo gli stessi store_customization/store_*; quindi i negozi esistenti rendono
-- identici finché non salvano un sito proprio. Nessuna migrazione dati necessaria.
--
-- Forma (validata in lib/store-site.ts):
-- {
--   "theme": "classico",
--   "pages": [
--     { "id": "...", "slug": "", "title": "Home", "visibility": "public",
--       "seo": { "title": "...", "description": "...", "noindex": false },
--       "sections": [ { "id": "...", "type": "hero", "enabled": true, "config": {...} }, ... ] }
--   ],
--   "menu": { "enabled": false, "links": [ { "id": "...", "label": "...", "target": {...} } ] }
-- }
-- Idempotente.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS store_site jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.profiles.store_site IS
  'Sito vetrina multi-pagina (pagine, sezioni ordinate, menu, tema). Forma validata in app via lib/store-site.ts. Default {} => deriva home dal layout fisso/store_customization.';

NOTIFY pgrst, 'reload schema';

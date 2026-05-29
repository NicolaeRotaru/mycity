-- 052 — Personalizzazione vetrina negozio (store_customization)
--
-- Colonna JSONB unica che raccoglie TUTTE le opzioni estetiche/marketing della
-- vetrina pubblica /store/[id], gestite dal venditore via /seller/profile.
-- Scelta single-column (vs molte colonne): la RLS è già column-agnostic
-- ("Users can update their own profile" USING auth.uid() = id), un solo
-- ADD COLUMN, un solo entry nei tipi generati, evolvibile senza nuove migration.
-- La validazione di forma/contenuto avviene in app (lib/store-customization.ts
-- + zod), come già per store_hours (010) e store_media (017).
--
-- Forma (tutti i campi opzionali; default {} => vetrina "neutra" on-brand):
-- {
--   "theme":        { "accent": "#C0492C", "coverStyle": "terracotta" },
--   "tagline":      "Pane fresco dal 1962",
--   "socials":      { "instagram": "...", "facebook": "...", "tiktok": "...",
--                     "whatsapp": "...", "website": "https://..." },
--   "announcement": { "enabled": true, "text": "...", "until": "2026-06-30" },
--   "featuredProductIds": ["uuid", ...],
--   "badges":       ["produzione_propria", "consegna_rapida", ...]
-- }
-- Idempotente.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS store_customization jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.profiles.store_customization IS
  'Personalizzazione vetrina pubblica (tema/accent, tagline, social, annuncio, prodotti in evidenza, badge). Forma validata in app via lib/store-customization.ts. Default {}.';

NOTIFY pgrst, 'reload schema';

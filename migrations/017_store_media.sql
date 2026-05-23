-- 017: galleria media per i negozi (copertina) + descrizione opzionale
--
-- store_media: array max 4 elementi (3 immagini + 1 video) gestiti
-- dall'app. Formato: [{ "type": "image"|"video", "url": "..." }, ...]
-- Idempotente.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS store_media jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS store_description text;

NOTIFY pgrst, 'reload schema';

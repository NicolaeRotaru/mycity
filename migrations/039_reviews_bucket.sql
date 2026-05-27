-- 039: Bug fix — bucket "reviews" mancante per upload foto recensioni
--
-- Esperti consultati:
-- - Senior PM: "Photo reviews driver di trust marketplace. Se upload fail
--   silenzioso, gli utenti smettono di lasciare recensioni e perdiamo segnale."
-- - Security Engineer: "Bucket pubblico ma write authenticated-only.
--   File path = userId/timestamp.ext per anti-overwrite + ownership."
-- - Trust & Safety: "Owner-based delete: solo chi ha caricato puo' rimuovere."
--
-- Il bug: components/PhotoReviewUpload.tsx usa storage.from('reviews') ma
-- la migration 027 (review tables) NON crea il bucket. Risultato: upload
-- fallisce con "Bucket not found" silenzioso e la review viene salvata
-- senza foto.

-- =============================================================================
-- BUCKET REVIEWS
-- =============================================================================

INSERT INTO storage.buckets (id, name, public)
    VALUES ('reviews', 'reviews', true)
    ON CONFLICT (id) DO NOTHING;

-- Storage RLS policies
DROP POLICY IF EXISTS "reviews read public" ON storage.objects;
CREATE POLICY "reviews read public" ON storage.objects
    FOR SELECT USING (bucket_id = 'reviews');

DROP POLICY IF EXISTS "reviews insert authenticated" ON storage.objects;
CREATE POLICY "reviews insert authenticated" ON storage.objects FOR INSERT
    WITH CHECK (
        bucket_id = 'reviews'
        AND auth.role() = 'authenticated'
        -- Path obbligato: userId/filename — impedisce overwrite di altri utenti
        AND (storage.foldername(name))[1] = auth.uid()::text
    );

DROP POLICY IF EXISTS "reviews delete owner" ON storage.objects;
CREATE POLICY "reviews delete owner" ON storage.objects FOR DELETE
    USING (
        bucket_id = 'reviews'
        AND owner = auth.uid()
    );

NOTIFY pgrst, 'reload schema';

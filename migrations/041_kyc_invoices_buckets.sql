-- 041: Bug fix — bucket "kyc-docs" e "invoices" mancanti
--
-- Pattern identico al fix migration 039 (bucket "reviews" mancante).
-- Il codice usava bucket non creati da nessuna migration → upload silenzioso fail.
--
-- - app/api/kyc/upload-document/route.ts: storage.from('kyc-docs')
-- - app/api/invoices/generate/route.ts:   admin.storage.from('invoices')
--
-- Esperti consultati:
-- - Compliance Officer: "KYC docs e fatture sono PRIVATI per legge (GDPR + AML).
--   Bucket public=false, signed URL solo a admin o owner."
-- - Security Engineer: "Path obbligato userId/... per garantire ownership a
--   livello policy. Owner-based delete per compliance retention."

-- =============================================================================
-- BUCKET kyc-docs (PRIVATO)
-- =============================================================================

INSERT INTO storage.buckets (id, name, public)
    VALUES ('kyc-docs', 'kyc-docs', false)
    ON CONFLICT (id) DO NOTHING;

-- Read: solo owner (utente che ha caricato) o admin (via service role bypass)
DROP POLICY IF EXISTS "kyc-docs read owner" ON storage.objects;
CREATE POLICY "kyc-docs read owner" ON storage.objects
    FOR SELECT USING (
        bucket_id = 'kyc-docs'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );

-- Insert: solo utente autenticato, e path forza userId/...
DROP POLICY IF EXISTS "kyc-docs insert owner" ON storage.objects;
CREATE POLICY "kyc-docs insert owner" ON storage.objects FOR INSERT
    WITH CHECK (
        bucket_id = 'kyc-docs'
        AND auth.role() = 'authenticated'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );

-- Delete: solo owner
DROP POLICY IF EXISTS "kyc-docs delete owner" ON storage.objects;
CREATE POLICY "kyc-docs delete owner" ON storage.objects FOR DELETE
    USING (
        bucket_id = 'kyc-docs'
        AND owner = auth.uid()
    );

-- =============================================================================
-- BUCKET invoices (PRIVATO)
-- =============================================================================

INSERT INTO storage.buckets (id, name, public)
    VALUES ('invoices', 'invoices', false)
    ON CONFLICT (id) DO NOTHING;

-- Read: solo seller proprietario (path = sellerId/orderId.pdf)
DROP POLICY IF EXISTS "invoices read owner" ON storage.objects;
CREATE POLICY "invoices read owner" ON storage.objects
    FOR SELECT USING (
        bucket_id = 'invoices'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );

-- Insert: forzato server-side via service role (no auth.uid() check qui).
-- Il codice in app/api/invoices/generate/route.ts usa admin client.
DROP POLICY IF EXISTS "invoices insert service" ON storage.objects;
CREATE POLICY "invoices insert service" ON storage.objects FOR INSERT
    WITH CHECK (
        bucket_id = 'invoices'
        AND auth.role() = 'service_role'
    );

-- Delete: solo service role (retention compliance)
DROP POLICY IF EXISTS "invoices delete service" ON storage.objects;
CREATE POLICY "invoices delete service" ON storage.objects FOR DELETE
    USING (
        bucket_id = 'invoices'
        AND auth.role() = 'service_role'
    );

NOTIFY pgrst, 'reload schema';

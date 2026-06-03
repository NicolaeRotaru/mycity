-- 070: hardening storage + RLS (security advisor 0024 / 0025 / 0028) + limiti upload.
--
-- Contesto: audit sicurezza/performance. Interventi a BASSO RISCHIO:
--  1a. Limiti server-side sugli upload immagini (file_size_limit + allowed_mime_types)
--      dei bucket pubblici products/reviews/stories. Gli upload via SDK client avevano
--      SOLO controlli client-side (bypassabili con una chiamata diretta). Qui si blocca
--      a livello storage il caricamento di file enormi e di non-immagini (incl. SVG/HTML,
--      potenziale XSS) qualunque sia il client.
--  1b. Blocco del listing/enumerazione dei bucket pubblici (advisor 0025): le SELECT
--      policy "larghe" (bucket_id = '<b>') permettevano di ELENCARE tutti i file del
--      bucket. La lettura via URL pubblico (getPublicUrl) NON passa da questa policy
--      perche' il bucket e' public=true, quindi la VISUALIZZAZIONE delle immagini resta
--      invariata (come gia' avviene per i bucket avatars/stores, che non hanno SELECT
--      policy). Le SELECT vengono ristrette al proprietario (cartella = auth.uid()),
--      coerente col pattern gia' usato per kyc-docs/reviews-insert.
--  2.  RLS WITH CHECK(true) (advisor 0024) su disputes_admin_update, contact_insert_public
--      e newsletter "Anyone can subscribe": resi non-banali SENZA rompere i flussi
--      legittimi. I vincoli rispecchiano i CHECK di colonna gia' esistenti (non possono
--      mai rifiutare una riga che la tabella accetterebbe) + clausola anti-spoofing che
--      impedisce a un insert diretto di attribuire la riga a un user_id arbitrario.
--  4.  Revoca EXECUTE ad anon su touch_loyalty_streak (advisor 0028): e' chiamata solo
--      da contesto autenticato (lib/loyalty.ts <- DailyCheckIn, dietro guardia
--      isAuthenticated) e no-op per anon. NON si toccano is_admin (usata nelle policy
--      RLS USING di products/group_orders/rider_reviews leggibili da anon -> revocare
--      romperebbe il catalogo pubblico) ne' track_story_view (usata dal viewer storie
--      anonimo).
--
-- Idempotente. Sicura da ri-eseguire.

-- =========================================================================
-- 1a. Limiti upload server-side sui bucket immagini pubblici.
--     10 MiB = backstop anti-abuso (il client gia' limita a 5MB su products/reviews;
--     stories non aveva alcun limite). L'allowlist copre ogni formato foto legittimo
--     (incl. HEIC/HEIF da iPhone) ma blocca non-immagini e SVG.
-- =========================================================================
UPDATE storage.buckets
   SET file_size_limit = 10485760,
       allowed_mime_types = ARRAY[
         'image/jpeg','image/png','image/webp','image/gif',
         'image/avif','image/heic','image/heif'
       ]
 WHERE id IN ('products','reviews','stories');

-- =========================================================================
-- 1b. Blocco listing dei bucket pubblici (advisor 0025) -> SELECT owner-scoped.
--     La visualizzazione resta via URL pubblico (non passa da RLS su bucket public).
-- =========================================================================
DROP POLICY IF EXISTS "Anyone can view product images" ON storage.objects;
DROP POLICY IF EXISTS "products read own" ON storage.objects;
CREATE POLICY "products read own" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'products'
    AND (storage.foldername(name))[1] = (auth.uid())::text
  );

DROP POLICY IF EXISTS "reviews read public" ON storage.objects;
DROP POLICY IF EXISTS "reviews read own" ON storage.objects;
CREATE POLICY "reviews read own" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'reviews'
    AND (storage.foldername(name))[1] = (auth.uid())::text
  );

DROP POLICY IF EXISTS "stories read public" ON storage.objects;
DROP POLICY IF EXISTS "stories read own" ON storage.objects;
CREATE POLICY "stories read own" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'stories'
    AND (storage.foldername(name))[1] = (auth.uid())::text
  );

-- =========================================================================
-- 2a. disputes_admin_update: WITH CHECK(true) -> mirror dell'USING admin (advisor 0024).
--     Un non-admin gia' non passava l'USING; l'admin passa entrambe le clausole.
-- =========================================================================
DROP POLICY IF EXISTS disputes_admin_update ON public.disputes;
CREATE POLICY disputes_admin_update ON public.disputes
  FOR UPDATE
  USING      (EXISTS (SELECT 1 FROM public.profiles WHERE id = (SELECT auth.uid()) AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = (SELECT auth.uid()) AND role = 'admin'));

-- =========================================================================
-- 2b. contact_insert_public: WITH CHECK(true) -> shape-gate + anti-spoof (advisor 0024).
--     I primi 3 vincoli rispecchiano VERBATIM i CHECK di colonna (028) -> non possono
--     mai rifiutare una riga gia' accettata dalla tabella. L'ultima riga impedisce a un
--     insert diretto (PostgREST) di attribuire il messaggio a un user_id non proprio.
-- =========================================================================
DROP POLICY IF EXISTS contact_insert_public ON public.contact_messages;
CREATE POLICY contact_insert_public ON public.contact_messages
  FOR INSERT
  WITH CHECK (
    char_length(name) BETWEEN 2 AND 120
    AND char_length(message) BETWEEN 10 AND 5000
    AND email ~* '^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$'
    AND (user_id IS NULL OR user_id = (SELECT auth.uid()))
  );

-- =========================================================================
-- 2c. newsletter "Anyone can subscribe": WITH CHECK(true) -> sanity + anti-spoof.
--     newsletter_subscribers non ha CHECK di colonna sul DB: uso vincoli larghi che
--     non rifiutano nessuna email reale (richiede '@' non iniziale + lunghezza plausibile).
-- =========================================================================
DROP POLICY IF EXISTS "Anyone can subscribe" ON public.newsletter_subscribers;
CREATE POLICY "Anyone can subscribe" ON public.newsletter_subscribers
  FOR INSERT
  WITH CHECK (
    char_length(email) BETWEEN 3 AND 254
    AND position('@' IN email) > 1
    AND (user_id IS NULL OR user_id = (SELECT auth.uid()))
  );

-- =========================================================================
-- 4. Revoca anon EXECUTE su touch_loyalty_streak (advisor 0028).
--    Stesso stile del loop REVOKE/GRANT di 067. Mantiene authenticated + service_role.
-- =========================================================================
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef = true
      AND p.proname = 'touch_loyalty_streak'
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', r.sig);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

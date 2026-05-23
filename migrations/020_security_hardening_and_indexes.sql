-- ============================================================================
-- Migration 020: Security hardening + indici performance
-- ============================================================================
-- - Restringe RLS su tabelle con "USING (true)" che esponevano dati a tutti
-- - Aggiunge validazione email su newsletter_subscribers
-- - Aggiunge 8 indici per query critiche (notifications, reviews, addresses, ecc.)
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1) REVIEWS: leggibile solo per prodotti pubblicamente visibili
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Anyone can view reviews" ON public.reviews;
CREATE POLICY "Reviews readable for visible products only" ON public.reviews
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.products
      WHERE products.id = reviews.product_id
        AND products.status = 'available'
    )
  );

-- ----------------------------------------------------------------------------
-- 2) STORE_REVIEWS: leggibile solo per negozi approvati
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Anyone can view store reviews" ON public.store_reviews;
DROP POLICY IF EXISTS "Anyone reads store reviews" ON public.store_reviews;
CREATE POLICY "Store reviews readable for approved stores" ON public.store_reviews
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = store_reviews.store_id
        AND profiles.role = 'seller'
        AND profiles.is_approved = true
    )
  );

-- ----------------------------------------------------------------------------
-- 3) RIDER_REVIEWS: leggibili solo dall'interessato (rider stesso, buyer, admin)
--    Le rider review NON sono content pubblico, sono feedback interno.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Anyone can view rider reviews" ON public.rider_reviews;
DROP POLICY IF EXISTS "Anyone reads rider reviews" ON public.rider_reviews;
CREATE POLICY "Rider reviews readable by involved parties" ON public.rider_reviews
  FOR SELECT
  USING (
    rider_id = auth.uid()                       -- il rider vede le sue
    OR reviewer_id = auth.uid()                 -- il buyer vede la sua
    OR public.is_admin()                        -- admin vede tutto
  );

-- ----------------------------------------------------------------------------
-- 4) GROUP_ORDERS: non rivelare gruppi non ancora attivi o scaduti a chi non
--    è l'organizzatore. I gruppi OPEN/COMPLETED restano pubblici (è valore
--    di acquisto sociale), gli altri stati no.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Anyone can view group orders" ON public.group_orders;
DROP POLICY IF EXISTS "Anyone reads group orders" ON public.group_orders;
CREATE POLICY "Public group orders readable" ON public.group_orders
  FOR SELECT
  USING (
    status IN ('OPEN', 'COMPLETED')
    OR seller_id = auth.uid()
    OR public.is_admin()
  );

-- ----------------------------------------------------------------------------
-- 5) GROUP_PARTICIPANTS: non esporre la lista di chi partecipa. Solo il
--    partecipante stesso e il seller del gruppo possono vederla.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Anyone can view group participants" ON public.group_participants;
DROP POLICY IF EXISTS "Anyone reads group participants" ON public.group_participants;
CREATE POLICY "Group participants readable by self or seller" ON public.group_participants
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.group_orders
      WHERE group_orders.id = group_participants.group_id
        AND group_orders.seller_id = auth.uid()
    )
    OR public.is_admin()
  );

-- Aggregati pubblici (current_quantity in group_orders) restano leggibili a tutti.

-- ----------------------------------------------------------------------------
-- 6) NEWSLETTER_SUBSCRIBERS: validazione email + solo utenti autenticati o
--    primo subscribe via captcha (qui restiamo permissivi ma con validazione).
-- ----------------------------------------------------------------------------
-- Validazione formato email
ALTER TABLE public.newsletter_subscribers
  DROP CONSTRAINT IF EXISTS newsletter_subscribers_email_format;
ALTER TABLE public.newsletter_subscribers
  ADD CONSTRAINT newsletter_subscribers_email_format
  CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$');

-- Lunghezza massima
ALTER TABLE public.newsletter_subscribers
  DROP CONSTRAINT IF EXISTS newsletter_subscribers_email_length;
ALTER TABLE public.newsletter_subscribers
  ADD CONSTRAINT newsletter_subscribers_email_length
  CHECK (char_length(email) <= 254);

-- ============================================================================
-- INDICI PERFORMANCE
-- ============================================================================

-- 1) Notifications: query principale è per (user_id, is_read, created_at DESC)
CREATE INDEX IF NOT EXISTS notifications_user_read_created_idx
  ON public.notifications (user_id, is_read, created_at DESC);

-- 2) Reviews: lista review per prodotto, ordinata per data
CREATE INDEX IF NOT EXISTS reviews_product_created_idx
  ON public.reviews (product_id, created_at DESC);

-- 3) Order items per order
CREATE INDEX IF NOT EXISTS order_items_order_idx
  ON public.order_items (order_id);

-- 4) User addresses: lookup default address per user
CREATE INDEX IF NOT EXISTS user_addresses_user_default_idx
  ON public.user_addresses (user_id, is_default)
  WHERE is_default = true;

-- 5) Favorites per user
CREATE INDEX IF NOT EXISTS favorites_user_created_idx
  ON public.favorites (user_id, created_at DESC);

-- 6) Store reviews aggregati per store
CREATE INDEX IF NOT EXISTS store_reviews_store_rating_idx
  ON public.store_reviews (store_id, rating);

-- 7) Rider reviews aggregati per rider
CREATE INDEX IF NOT EXISTS rider_reviews_rider_rating_idx
  ON public.rider_reviews (rider_id, rating);

-- 8) Coupons attivi per code lookup al checkout
CREATE INDEX IF NOT EXISTS coupons_code_active_idx
  ON public.coupons (code)
  WHERE active = true;

-- 9) Products by seller (dashboard seller)
CREATE INDEX IF NOT EXISTS products_seller_status_idx
  ON public.products (seller_id, status, created_at DESC);

COMMIT;

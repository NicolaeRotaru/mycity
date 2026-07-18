-- ============================================================================
-- Migration 109: Fix #37 — corregge la migrazione 020 (fallita per colonne errate)
-- ============================================================================
-- La migrazione 020 era avvolta in BEGIN…COMMIT e faceva ROLLBACK su:
--   riga 51: "reviewer_id" non esiste su rider_reviews (colonna reale: "user_id")
--   riga 82: "group_participants.group_id" → colonna reale: "group_order_id"
-- Risultato: tutte le policy e gli indici della 020 non erano mai stati applicati.
-- Questa migrazione applica tutto ciò che la 020 voleva fare, con i nomi corretti.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1) REVIEWS: leggibile solo per prodotti pubblicamente visibili
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Anyone can view reviews" ON public.reviews;
DROP POLICY IF EXISTS "Reviews readable for visible products only" ON public.reviews;
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
DROP POLICY IF EXISTS "Store reviews readable for approved stores" ON public.store_reviews;
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
-- 3) RIDER_REVIEWS: corretto "reviewer_id" → "user_id"
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Anyone can view rider reviews" ON public.rider_reviews;
DROP POLICY IF EXISTS "Anyone reads rider reviews" ON public.rider_reviews;
DROP POLICY IF EXISTS "Anyone can read rider reviews" ON public.rider_reviews;
DROP POLICY IF EXISTS "Rider reviews readable by involved parties" ON public.rider_reviews;
CREATE POLICY "Rider reviews readable by involved parties" ON public.rider_reviews
  FOR SELECT
  USING (
    rider_id = auth.uid()        -- il rider vede le sue
    OR user_id = auth.uid()      -- il buyer vede la sua (fix: era reviewer_id)
    OR public.is_admin()         -- admin vede tutto
  );

-- ----------------------------------------------------------------------------
-- 4) GROUP_ORDERS: non esporre gruppi non attivi
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Anyone can view group orders" ON public.group_orders;
DROP POLICY IF EXISTS "Anyone reads group orders" ON public.group_orders;
DROP POLICY IF EXISTS "Public group orders readable" ON public.group_orders;
CREATE POLICY "Public group orders readable" ON public.group_orders
  FOR SELECT
  USING (
    status IN ('OPEN', 'COMPLETED')
    OR seller_id = auth.uid()
    OR public.is_admin()
  );

-- ----------------------------------------------------------------------------
-- 5) GROUP_PARTICIPANTS: corretto "group_id" → "group_order_id"
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Anyone can view group participants" ON public.group_participants;
DROP POLICY IF EXISTS "Anyone reads group participants" ON public.group_participants;
DROP POLICY IF EXISTS "Group participants readable by self or seller" ON public.group_participants;
CREATE POLICY "Group participants readable by self or seller" ON public.group_participants
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.group_orders
      WHERE group_orders.id = group_participants.group_order_id  -- fix: era group_id
        AND group_orders.seller_id = auth.uid()
    )
    OR public.is_admin()
  );

-- ----------------------------------------------------------------------------
-- 6) NEWSLETTER_SUBSCRIBERS: validazione email
-- ----------------------------------------------------------------------------
ALTER TABLE public.newsletter_subscribers
  DROP CONSTRAINT IF EXISTS newsletter_subscribers_email_format;
ALTER TABLE public.newsletter_subscribers
  ADD CONSTRAINT newsletter_subscribers_email_format
  CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$');

ALTER TABLE public.newsletter_subscribers
  DROP CONSTRAINT IF EXISTS newsletter_subscribers_email_length;
ALTER TABLE public.newsletter_subscribers
  ADD CONSTRAINT newsletter_subscribers_email_length
  CHECK (char_length(email) <= 254);

-- ============================================================================
-- INDICI PERFORMANCE (non applicati per il rollback della 020)
-- ============================================================================
CREATE INDEX IF NOT EXISTS notifications_user_read_created_idx
  ON public.notifications (user_id, is_read, created_at DESC);

CREATE INDEX IF NOT EXISTS reviews_product_created_idx
  ON public.reviews (product_id, created_at DESC);

CREATE INDEX IF NOT EXISTS order_items_order_idx
  ON public.order_items (order_id);

CREATE INDEX IF NOT EXISTS user_addresses_user_default_idx
  ON public.user_addresses (user_id, is_default)
  WHERE is_default = true;

CREATE INDEX IF NOT EXISTS favorites_user_created_idx
  ON public.favorites (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS store_reviews_store_rating_idx
  ON public.store_reviews (store_id, rating);

CREATE INDEX IF NOT EXISTS rider_reviews_rider_rating_idx
  ON public.rider_reviews (rider_id, rating);

CREATE INDEX IF NOT EXISTS coupons_code_active_idx
  ON public.coupons (code)
  WHERE active = true;

CREATE INDEX IF NOT EXISTS products_seller_status_idx
  ON public.products (seller_id, status, created_at DESC);

COMMIT;

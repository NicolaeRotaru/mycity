-- 014: MVP sprint — indirizzi salvati, wishlist, recensioni shop+rider,
-- coupon, primo ordine sconto, compenso rider dinamico.
--
-- Idempotente.

-- ============================================
-- 1) Indirizzi salvati del buyer
-- ============================================
CREATE TABLE IF NOT EXISTS public.user_addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label text NOT NULL,           -- "Casa", "Ufficio", "Mamma"
  full_name text NOT NULL,
  phone text NOT NULL,
  address text NOT NULL,
  city text NOT NULL,
  zip text NOT NULL,
  notes text,
  lat double precision,
  lng double precision,
  is_default boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.user_addresses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users own their addresses" ON public.user_addresses;
CREATE POLICY "Users own their addresses"
  ON public.user_addresses
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS user_addresses_user_idx ON public.user_addresses(user_id);

-- ============================================
-- 2) Wishlist (favorites)
-- ============================================
CREATE TABLE IF NOT EXISTS public.favorites (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (user_id, product_id)
);

ALTER TABLE public.favorites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users own favorites" ON public.favorites;
CREATE POLICY "Users own favorites"
  ON public.favorites
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ============================================
-- 3) Store reviews (1 per ordine)
-- ============================================
CREATE TABLE IF NOT EXISTS public.store_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  rating int NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment text,
  created_at timestamptz DEFAULT now(),
  UNIQUE (order_id, user_id)
);

ALTER TABLE public.store_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read store reviews" ON public.store_reviews;
CREATE POLICY "Anyone can read store reviews"
  ON public.store_reviews FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Buyers can review delivered orders" ON public.store_reviews;
CREATE POLICY "Buyers can review delivered orders"
  ON public.store_reviews FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.orders
      WHERE id = order_id
        AND user_id = auth.uid()
        AND store_id = store_reviews.store_id
        AND delivery_status = 'DELIVERED'
    )
  );

CREATE INDEX IF NOT EXISTS store_reviews_store_idx ON public.store_reviews(store_id);

-- ============================================
-- 4) Rider reviews (1 per ordine)
-- ============================================
CREATE TABLE IF NOT EXISTS public.rider_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  rating int NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment text,
  created_at timestamptz DEFAULT now(),
  UNIQUE (order_id, user_id)
);

ALTER TABLE public.rider_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read rider reviews" ON public.rider_reviews;
CREATE POLICY "Anyone can read rider reviews"
  ON public.rider_reviews FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Buyers can review their rider" ON public.rider_reviews;
CREATE POLICY "Buyers can review their rider"
  ON public.rider_reviews FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.orders
      WHERE id = order_id
        AND user_id = auth.uid()
        AND rider_id = rider_reviews.rider_id
        AND delivery_status = 'DELIVERED'
    )
  );

CREATE INDEX IF NOT EXISTS rider_reviews_rider_idx ON public.rider_reviews(rider_id);

-- ============================================
-- 5) Coupon
-- ============================================
CREATE TABLE IF NOT EXISTS public.coupons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  type text NOT NULL CHECK (type IN ('PERCENT', 'FIXED', 'FREE_SHIPPING')),
  value numeric(10, 2) NOT NULL DEFAULT 0,
  min_subtotal numeric(10, 2) DEFAULT 0,
  max_uses int,
  uses_count int DEFAULT 0,
  first_order_only boolean DEFAULT false,
  expires_at timestamptz,
  active boolean DEFAULT true,
  description text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;

-- Tutti possono leggere coupon attivi (per validare al checkout)
DROP POLICY IF EXISTS "Anyone can read active coupons" ON public.coupons;
CREATE POLICY "Anyone can read active coupons"
  ON public.coupons FOR SELECT
  USING (active = true);

-- Solo admin CRUD coupon (uses is_admin() della migration 012)
DROP POLICY IF EXISTS "Admins can manage coupons" ON public.coupons;
CREATE POLICY "Admins can manage coupons"
  ON public.coupons FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ============================================
-- 6) Colonne orders per coupon e ricalcolo compenso
-- ============================================
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS coupon_code text,
  ADD COLUMN IF NOT EXISTS discount_amount numeric(10, 2) DEFAULT 0;

-- ============================================
-- 7) Seed: coupon di benvenuto + uno generico
-- ============================================
INSERT INTO public.coupons (code, type, value, first_order_only, description, active)
VALUES
  ('BENVENUTO10', 'PERCENT', 10, true, 'Sconto del 10% sul tuo primo ordine', true),
  ('SPED5',       'FIXED',    5, false, '€5 di sconto su ordini sopra i €25', true)
ON CONFLICT (code) DO NOTHING;

UPDATE public.coupons SET min_subtotal = 25 WHERE code = 'SPED5';

NOTIFY pgrst, 'reload schema';

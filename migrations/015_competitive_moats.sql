-- 015: feature competitive — gruppo acquisto, referral, ritiro in negozio,
-- newsletter, live activity feed.
-- Idempotente.

-- ============================================
-- 1) GRUPPO D'ACQUISTO
-- ============================================
CREATE TABLE IF NOT EXISTS public.group_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  seller_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  organizer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title text,
  target_quantity int NOT NULL CHECK (target_quantity >= 2),
  current_quantity int NOT NULL DEFAULT 0,
  discount_percent int NOT NULL CHECK (discount_percent BETWEEN 5 AND 80),
  unit_price numeric(10, 2) NOT NULL,
  discounted_price numeric(10, 2) NOT NULL,
  deadline timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('OPEN', 'COMPLETED', 'EXPIRED', 'CANCELED')) DEFAULT 'OPEN',
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.group_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_order_id uuid NOT NULL REFERENCES public.group_orders(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  quantity int NOT NULL DEFAULT 1 CHECK (quantity > 0),
  joined_at timestamptz DEFAULT now(),
  UNIQUE (group_order_id, user_id)
);

ALTER TABLE public.group_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_participants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone reads group orders" ON public.group_orders;
CREATE POLICY "Anyone reads group orders" ON public.group_orders
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Sellers create their group orders" ON public.group_orders;
CREATE POLICY "Sellers create their group orders" ON public.group_orders
  FOR INSERT WITH CHECK (seller_id = auth.uid() AND organizer_id = auth.uid());

DROP POLICY IF EXISTS "Sellers update their group orders" ON public.group_orders;
CREATE POLICY "Sellers update their group orders" ON public.group_orders
  FOR UPDATE USING (seller_id = auth.uid());

DROP POLICY IF EXISTS "Anyone reads participants" ON public.group_participants;
CREATE POLICY "Anyone reads participants" ON public.group_participants
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Users join groups" ON public.group_participants;
CREATE POLICY "Users join groups" ON public.group_participants
  FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can leave groups" ON public.group_participants;
CREATE POLICY "Users can leave groups" ON public.group_participants
  FOR DELETE USING (user_id = auth.uid());

-- Trigger per mantenere current_quantity allineato
CREATE OR REPLACE FUNCTION public.update_group_quantity()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.group_orders
    SET current_quantity = current_quantity + NEW.quantity,
        status = CASE
          WHEN (current_quantity + NEW.quantity) >= target_quantity THEN 'COMPLETED'
          ELSE status
        END
    WHERE id = NEW.group_order_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.group_orders
    SET current_quantity = GREATEST(0, current_quantity - OLD.quantity)
    WHERE id = OLD.group_order_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS update_group_quantity_trigger ON public.group_participants;
CREATE TRIGGER update_group_quantity_trigger
  AFTER INSERT OR DELETE ON public.group_participants
  FOR EACH ROW EXECUTE FUNCTION public.update_group_quantity();

CREATE INDEX IF NOT EXISTS group_orders_status_idx ON public.group_orders(status, deadline);
CREATE INDEX IF NOT EXISTS group_orders_seller_idx ON public.group_orders(seller_id);

-- Realtime per live updates del contatore
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'group_orders'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.group_orders';
  END IF;
END $$;

-- ============================================
-- 2) REFERRAL
-- ============================================
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS referral_code text,
  ADD COLUMN IF NOT EXISTS referred_by uuid REFERENCES public.profiles(id);

-- Genera referral_code univoco per profili esistenti (usa md5 perche'
-- UUID demo come 11111111-... darebbero tutti gli stessi primi 8 char)
UPDATE public.profiles
SET referral_code = upper(substr(md5(id::text), 1, 8))
WHERE referral_code IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_referral_code_idx ON public.profiles(referral_code);

CREATE TABLE IF NOT EXISTS public.referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  referred_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reward_amount numeric(10, 2) NOT NULL DEFAULT 5,
  rewarded boolean DEFAULT false,
  rewarded_at timestamptz,
  created_at timestamptz DEFAULT now(),
  UNIQUE (referred_id)
);

ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users see their referrals" ON public.referrals;
CREATE POLICY "Users see their referrals" ON public.referrals
  FOR SELECT USING (referrer_id = auth.uid() OR referred_id = auth.uid());

DROP POLICY IF EXISTS "Authenticated users can create referral" ON public.referrals;
CREATE POLICY "Authenticated users can create referral" ON public.referrals
  FOR INSERT WITH CHECK (referred_id = auth.uid());

-- Aggiorna trigger handle_new_user per generare referral_code
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
DECLARE
    role_choice text;
BEGIN
    role_choice := COALESCE(new.raw_user_meta_data->>'role', 'buyer');
    INSERT INTO public.profiles (id, role, is_approved, referral_code)
    VALUES (
        new.id,
        CASE
          WHEN role_choice = 'seller' THEN 'seller'
          WHEN role_choice = 'rider'  THEN 'rider'
          ELSE 'buyer'
        END,
        CASE WHEN role_choice IN ('seller', 'rider') THEN true ELSE false END,
        upper(substr(md5(new.id::text), 1, 8))
    );
    RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 3) SCONTO RITIRO IN NEGOZIO
-- ============================================
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS pickup_in_store boolean DEFAULT false;

-- ============================================
-- 4) NEWSLETTER
-- ============================================
CREATE TABLE IF NOT EXISTS public.newsletter_subscribers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  city text DEFAULT 'Piacenza',
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.newsletter_subscribers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can subscribe" ON public.newsletter_subscribers;
CREATE POLICY "Anyone can subscribe" ON public.newsletter_subscribers
  FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Admins read subs" ON public.newsletter_subscribers;
CREATE POLICY "Admins read subs" ON public.newsletter_subscribers
  FOR SELECT USING (public.is_admin());

NOTIFY pgrst, 'reload schema';

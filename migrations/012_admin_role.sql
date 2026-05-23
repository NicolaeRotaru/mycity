-- 012: ruolo admin + funzione is_admin() + policies RLS per accesso completo
--
-- L'admin puo' vedere:
-- - tutti i profili (e modificarli)
-- - tutti gli ordini
-- - tutti gli order_items
-- - tutti i prodotti
--
-- La funzione is_admin() è SECURITY DEFINER per evitare la ricorsione
-- (una policy su profiles che fa SELECT su profiles entrerebbe in loop).
--
-- Idempotente.

-- 1) Allarga il check del ruolo per includere 'admin'
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('seller', 'buyer', 'rider', 'admin', 'pending_approval'));

-- 2) Funzione is_admin() — SECURITY DEFINER bypassa RLS, evitando loop
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;

-- 3) Policy admin su profiles
DROP POLICY IF EXISTS "Admins can read all profiles" ON public.profiles;
CREATE POLICY "Admins can read all profiles"
  ON public.profiles FOR SELECT
  USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can update all profiles" ON public.profiles;
CREATE POLICY "Admins can update all profiles"
  ON public.profiles FOR UPDATE
  USING (public.is_admin());

-- 4) Policy admin su orders
DROP POLICY IF EXISTS "Admins can read all orders" ON public.orders;
CREATE POLICY "Admins can read all orders"
  ON public.orders FOR SELECT
  USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can update all orders" ON public.orders;
CREATE POLICY "Admins can update all orders"
  ON public.orders FOR UPDATE
  USING (public.is_admin());

-- 5) Policy admin su order_items
DROP POLICY IF EXISTS "Admins can read all order_items" ON public.order_items;
CREATE POLICY "Admins can read all order_items"
  ON public.order_items FOR SELECT
  USING (public.is_admin());

-- 6) Policy admin su products (puo' vedere anche prodotti non disponibili)
DROP POLICY IF EXISTS "Admins can read all products" ON public.products;
CREATE POLICY "Admins can read all products"
  ON public.products FOR SELECT
  USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can update all products" ON public.products;
CREATE POLICY "Admins can update all products"
  ON public.products FOR UPDATE
  USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can delete all products" ON public.products;
CREATE POLICY "Admins can delete all products"
  ON public.products FOR DELETE
  USING (public.is_admin());

-- 7) Policy admin su notifications (per debug)
DROP POLICY IF EXISTS "Admins can read all notifications" ON public.notifications;
CREATE POLICY "Admins can read all notifications"
  ON public.notifications FOR SELECT
  USING (public.is_admin());

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- Migration 023: nascondi prodotti di seller non approvati (defense-in-depth)
-- ============================================================================
-- Anche se l'app filtra esplicitamente nelle query, qui mettiamo una RLS
-- che impedisce A CHIUNQUE (anche bot/scraper che usassero direttamente
-- la API) di leggere prodotti di un seller con is_approved=false (sospesi,
-- rifiutati o ancora in attesa).
--
-- Eccezioni:
--  - il seller stesso vede sempre i propri prodotti (per /seller/products)
--  - admin vede tutto
-- ============================================================================

BEGIN;

DROP POLICY IF EXISTS "Anyone can view available products" ON public.products;
DROP POLICY IF EXISTS "Products visible to public if seller approved" ON public.products;

-- Pubblico: solo prodotti disponibili di seller approvati
CREATE POLICY "Products visible to public if seller approved" ON public.products
  FOR SELECT
  USING (
    status = 'available'
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = products.seller_id
        AND profiles.is_approved = true
    )
  );

-- Il seller vede sempre i propri prodotti (per dashboard /seller/products),
-- anche se è sospeso (così quando viene riattivato non perde nulla)
DROP POLICY IF EXISTS "Seller sees own products" ON public.products;
CREATE POLICY "Seller sees own products" ON public.products
  FOR SELECT
  USING (seller_id = auth.uid());

-- Admin vede tutto
DROP POLICY IF EXISTS "Admin sees all products" ON public.products;
CREATE POLICY "Admin sees all products" ON public.products
  FOR SELECT
  USING (public.is_admin());

COMMIT;

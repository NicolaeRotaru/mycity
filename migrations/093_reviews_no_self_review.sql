-- 093_reviews_no_self_review.sql
--
-- ANTI-FRODE recensioni: impedisce l'auto-recensione (recensore = venditore/rider).
--
-- Contesto: le policy INSERT garantivano il "verified purchase" (ordine DELIVERED
-- del recensore) ma NON escludevano il caso in cui il recensore fosse anche il
-- venditore del prodotto/negozio o il rider dell'ordine. Con un secondo account o
-- un auto-acquisto un venditore poteva gonfiarsi le stelle. Reputazione = denaro:
-- va guadagnata solo da terzi reali.
--
-- Meccanismo: aggiunge alle 3 policy INSERT (reviews prodotto, store_reviews,
-- rider_reviews) la clausola di auto-esclusione. La regola vive in RLS, quindi
-- non è bypassabile via PostgREST. Le policy SELECT pubbliche restano invariate.
--
-- Idempotente (DROP POLICY IF EXISTS + CREATE).

-- 1) Recensioni prodotto: il recensore non può essere il venditore del prodotto.
DROP POLICY IF EXISTS "Verified buyers can write reviews" ON public.reviews;
CREATE POLICY "Verified buyers can write reviews"
  ON public.reviews FOR INSERT
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND NOT EXISTS (
      SELECT 1 FROM public.products p
      WHERE p.id = reviews.product_id
        AND p.seller_id = (SELECT auth.uid())
    )
    AND EXISTS (
      SELECT 1
      FROM public.order_items oi
      JOIN public.orders o ON o.id = oi.order_id
      WHERE oi.product_id = reviews.product_id
        AND o.user_id = (SELECT auth.uid())
        AND o.delivery_status = 'DELIVERED'
    )
  );

-- 2) Recensioni negozio: il recensore non può essere il negozio stesso.
DROP POLICY IF EXISTS "Buyers can review delivered orders" ON public.store_reviews;
CREATE POLICY "Buyers can review delivered orders"
  ON public.store_reviews FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND store_id <> auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.orders
      WHERE id = order_id
        AND user_id = auth.uid()
        AND store_id = store_reviews.store_id
        AND delivery_status = 'DELIVERED'
    )
  );

-- 3) Recensioni rider: il recensore non può essere il rider stesso.
DROP POLICY IF EXISTS "Buyers can review their rider" ON public.rider_reviews;
CREATE POLICY "Buyers can review their rider"
  ON public.rider_reviews FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND rider_id <> auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.orders
      WHERE id = order_id
        AND user_id = auth.uid()
        AND rider_id = rider_reviews.rider_id
        AND delivery_status = 'DELIVERED'
    )
  );

NOTIFY pgrst, 'reload schema';

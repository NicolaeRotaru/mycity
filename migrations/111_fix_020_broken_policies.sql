-- 111: Corregge le policy rimaste permissive perché la migrazione 020 falliva
--      in transazione (colonne inesistenti: reviewer_id, group_participants.group_id).
--
-- La 020 era in BEGIN/COMMIT: al primo errore faceva ROLLBACK completo, lasciando:
--   - rider_reviews: policy "Anyone can read rider reviews" (USING true) ancora attiva
--   - group_participants: policy "Anyone reads participants" (USING true) ancora attiva
--   - 9 indici di performance mai creati
--
-- Colonne reali (verificate nelle migration 014/015):
--   - rider_reviews: rider_id, user_id (non reviewer_id)
--   - group_participants: group_order_id (non group_id)
--
-- Idempotente.

BEGIN;

-- ============================================================================
-- 1) RIDER_REVIEWS: drop della policy permissiva + policy corretta
-- ============================================================================
DROP POLICY IF EXISTS "Anyone can read rider reviews" ON public.rider_reviews;
DROP POLICY IF EXISTS "Anyone can view rider reviews" ON public.rider_reviews;
DROP POLICY IF EXISTS "Anyone reads rider reviews" ON public.rider_reviews;
DROP POLICY IF EXISTS "Rider reviews readable by involved parties" ON public.rider_reviews;

CREATE POLICY "Rider reviews readable by involved parties" ON public.rider_reviews
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()        -- il buyer vede la sua
    OR rider_id = auth.uid()    -- il rider vede le sue
    OR public.is_admin()        -- admin vede tutto
  );

-- ============================================================================
-- 2) GROUP_PARTICIPANTS: drop della policy permissiva + policy corretta
-- ============================================================================
DROP POLICY IF EXISTS "Anyone reads participants" ON public.group_participants;
DROP POLICY IF EXISTS "Anyone can view participants" ON public.group_participants;
DROP POLICY IF EXISTS "Anyone can view group participants" ON public.group_participants;
DROP POLICY IF EXISTS "Group participants readable by self or seller" ON public.group_participants;

CREATE POLICY "Group participants readable by self or seller" ON public.group_participants
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.group_orders
      WHERE group_orders.id = group_participants.group_order_id  -- colonna corretta
        AND group_orders.seller_id = auth.uid()
    )
    OR public.is_admin()
  );

-- ============================================================================
-- 3) Indici di performance mai creati dalla 020 (a causa del ROLLBACK)
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_notifications_user_read
  ON public.notifications(user_id, is_read);

CREATE INDEX IF NOT EXISTS idx_reviews_product_id
  ON public.reviews(product_id);

CREATE INDEX IF NOT EXISTS idx_reviews_user_id
  ON public.reviews(user_id);

CREATE INDEX IF NOT EXISTS idx_rider_reviews_rider_id
  ON public.rider_reviews(rider_id);

CREATE INDEX IF NOT EXISTS idx_rider_reviews_user_id
  ON public.rider_reviews(user_id);

CREATE INDEX IF NOT EXISTS idx_favorites_user_id
  ON public.favorites(user_id);

CREATE INDEX IF NOT EXISTS idx_favorites_product_id
  ON public.favorites(product_id);

CREATE INDEX IF NOT EXISTS idx_group_participants_group_order_id
  ON public.group_participants(group_order_id);

CREATE INDEX IF NOT EXISTS idx_group_participants_user_id
  ON public.group_participants(user_id);

COMMIT;

NOTIFY pgrst, 'reload schema';

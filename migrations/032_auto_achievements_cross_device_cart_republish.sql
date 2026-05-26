-- 032: trigger automatici per achievements + cross-device cart + auto-republish
-- Idempotente. Ragiona come gli esperti senior:
-- - Behavioral Scientist: achievements automatici = aha moment ogni X
-- - CRM Manager: cross-device cart = continuità esperienza
-- - Senior PM: auto-republish = recupero revenue silente

-- =============================================================================
-- AUTO-UNLOCK ACHIEVEMENTS
-- =============================================================================

-- Trigger su orders DELIVERED → controlla milestone buyer
CREATE OR REPLACE FUNCTION public.check_buyer_achievements_on_order()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_order_count int;
    v_unique_stores int;
BEGIN
    -- Solo su transizioni a DELIVERED
    IF NEW.delivery_status <> 'DELIVERED' OR (TG_OP = 'UPDATE' AND OLD.delivery_status = 'DELIVERED') THEN
        RETURN NEW;
    END IF;
    IF NEW.user_id IS NULL THEN
        RETURN NEW;
    END IF;

    -- Conta ordini completati
    SELECT COUNT(*) INTO v_order_count
    FROM public.orders
    WHERE user_id = NEW.user_id AND delivery_status = 'DELIVERED';

    -- Unique stores
    SELECT COUNT(DISTINCT seller_id) INTO v_unique_stores
    FROM public.orders
    WHERE user_id = NEW.user_id AND delivery_status = 'DELIVERED';

    -- Sblocca milestone
    IF v_order_count >= 1  THEN PERFORM public.unlock_achievement(NEW.user_id, 'first_order');  END IF;
    IF v_order_count >= 5  THEN PERFORM public.unlock_achievement(NEW.user_id, 'order_5');      END IF;
    IF v_order_count >= 10 THEN PERFORM public.unlock_achievement(NEW.user_id, 'order_10');     END IF;
    IF v_order_count >= 25 THEN PERFORM public.unlock_achievement(NEW.user_id, 'order_25');     END IF;
    IF v_unique_stores >= 3  THEN PERFORM public.unlock_achievement(NEW.user_id, 'explorer_3');  END IF;
    IF v_unique_stores >= 10 THEN PERFORM public.unlock_achievement(NEW.user_id, 'explorer_10'); END IF;

    -- Award loyalty points: 1 punto per ogni euro speso
    IF NEW.total_cents IS NOT NULL AND NEW.total_cents > 0 THEN
        PERFORM public.award_loyalty_points(
            NEW.user_id,
            FLOOR(NEW.total_cents / 100)::int,
            'order_completed',
            NEW.id
        );
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_buyer_achievements ON public.orders;
CREATE TRIGGER trg_buyer_achievements
    AFTER INSERT OR UPDATE OF delivery_status ON public.orders
    FOR EACH ROW
    EXECUTE FUNCTION public.check_buyer_achievements_on_order();

-- Trigger su reviews INSERT → check reviewer_5 + Top rated per seller
CREATE OR REPLACE FUNCTION public.check_achievements_on_review()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_review_count int;
    v_seller_id uuid;
    v_seller_review_count int;
    v_seller_avg_rating numeric;
BEGIN
    -- Buyer: 5 recensioni
    SELECT COUNT(*) INTO v_review_count FROM public.reviews WHERE user_id = NEW.user_id;
    IF v_review_count >= 5 THEN
        PERFORM public.unlock_achievement(NEW.user_id, 'reviewer_5');
    END IF;

    -- Seller: Top rated (rating medio 4.5+ con almeno 10 recensioni)
    SELECT seller_id INTO v_seller_id FROM public.products WHERE id = NEW.product_id;
    IF v_seller_id IS NOT NULL THEN
        SELECT COUNT(*), AVG(rating)
        INTO v_seller_review_count, v_seller_avg_rating
        FROM public.reviews r
        JOIN public.products p ON p.id = r.product_id
        WHERE p.seller_id = v_seller_id;
        IF v_seller_review_count >= 10 AND v_seller_avg_rating >= 4.5 THEN
            PERFORM public.unlock_achievement(v_seller_id, 'seller_top_rated');
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_review_achievements ON public.reviews;
CREATE TRIGGER trg_review_achievements
    AFTER INSERT ON public.reviews
    FOR EACH ROW
    EXECUTE FUNCTION public.check_achievements_on_review();

-- Trigger su referrals → ambasciatore (3 convertiti)
CREATE OR REPLACE FUNCTION public.check_referral_achievements()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_converted_count int;
BEGIN
    IF NEW.status <> 'first_order' AND NEW.status <> 'rewarded' THEN
        RETURN NEW;
    END IF;
    SELECT COUNT(*) INTO v_converted_count
    FROM public.referrals
    WHERE referrer_id = NEW.referrer_id
      AND status IN ('first_order','rewarded');
    IF v_converted_count >= 3 THEN
        PERFORM public.unlock_achievement(NEW.referrer_id, 'referrer_3');
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_referral_achievements ON public.referrals;
CREATE TRIGGER trg_referral_achievements
    AFTER UPDATE OF status ON public.referrals
    FOR EACH ROW
    EXECUTE FUNCTION public.check_referral_achievements();

-- =============================================================================
-- CARRELLO CROSS-DEVICE (Supabase-backed)
-- =============================================================================
-- Una riga per user_id, JSON del carrello sincronizzato.
-- Il client mergia con localStorage al login: se cloud più recente vince.

CREATE TABLE IF NOT EXISTS public.user_carts (
    user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
    items jsonb NOT NULL DEFAULT '[]'::jsonb,
    updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_carts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_carts_own_rw ON public.user_carts;
CREATE POLICY user_carts_own_rw ON public.user_carts
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- =============================================================================
-- AUTO-REPUBLISH out-of-stock quando torna in stock
-- =============================================================================
-- Trigger su products UPDATE stock 0 → N: se il prodotto era 'available_soon'
-- o status='out_of_stock', auto-set 'available'.

CREATE OR REPLACE FUNCTION public.auto_republish_on_restock()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Trigger solo se stock va da 0 a > 0
    IF OLD.stock IS DISTINCT FROM 0 OR NEW.stock IS NULL OR NEW.stock <= 0 THEN
        RETURN NEW;
    END IF;
    IF NEW.status NOT IN ('out_of_stock','sold_out','draft') THEN
        RETURN NEW;
    END IF;

    -- Auto-pubblica
    NEW.status := 'available';

    -- Notifica utenti che lo avevano in wishlist
    INSERT INTO public.notifications (user_id, title, body, link)
    SELECT f.user_id, '✨ Torna disponibile!', NEW.name || ' è di nuovo in stock.', '/product/' || NEW.id
    FROM public.favorites f
    WHERE f.product_id = NEW.id;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_republish ON public.products;
CREATE TRIGGER trg_auto_republish
    BEFORE UPDATE OF stock ON public.products
    FOR EACH ROW
    EXECUTE FUNCTION public.auto_republish_on_restock();

-- =============================================================================
-- HELPER: applica miglior promo seller a un prezzo
-- =============================================================================
-- Restituisce il prezzo scontato in base alla promo attiva più conveniente
-- del seller per quel prodotto.

CREATE OR REPLACE FUNCTION public.product_active_discount(p_product uuid)
RETURNS int
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_seller uuid;
    v_category uuid;
    v_best_discount int := 0;
BEGIN
    SELECT seller_id, category_id INTO v_seller, v_category
    FROM public.products WHERE id = p_product;
    IF v_seller IS NULL THEN
        RETURN 0;
    END IF;

    SELECT COALESCE(MAX(discount_percent), 0)
    INTO v_best_discount
    FROM public.seller_promotions
    WHERE seller_id = v_seller
      AND status = 'active'
      AND starts_at <= now()
      AND ends_at >= now()
      AND (
        scope = 'store'
        OR (scope = 'category' AND category_id = v_category)
        OR (scope = 'products' AND p_product = ANY(product_ids))
      );
    RETURN v_best_discount;
END;
$$;

GRANT EXECUTE ON FUNCTION public.product_active_discount(uuid) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

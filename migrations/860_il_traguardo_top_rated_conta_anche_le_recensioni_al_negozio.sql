-- =============================================================================
-- 860 — Il traguardo «Top rated» del venditore conta anche le recensioni al negozio
-- =============================================================================
-- COS'ERA ROTTO. `check_achievements_on_review` (032) calcolava numero e media
-- delle recensioni del venditore solo su `reviews` (le recensioni ai prodotti),
-- e il trigger stava solo su `reviews`. Le recensioni al NEGOZIO
-- (`store_reviews`) non entravano mai: un negozio recensito soprattutto come
-- negozio non arrivava alle 10 recensioni, e uno con recensioni al negozio
-- pessime prendeva lo stesso il traguardo grazie ai soli prodotti.
--
-- LA REGOLA. Il traguardo resta «media 4.5+ su almeno 10 recensioni», ma le
-- recensioni sono tutte e due: ai prodotti del venditore e al suo negozio. La
-- stessa funzione gira adesso anche dopo ogni nuova recensione al negozio
-- (`TG_TABLE_NAME` dice da quale tabella arriva). Il traguardo «5 recensioni»
-- del cliente resta com'era: conta le recensioni ai prodotti.
--
-- Si puo' rieseguire. NON si applica a mano: lo decide Nicola, come ogni migrazione.
-- REVERSIBILE: rieseguire il blocco di check_achievements_on_review della 032 e
-- DROP TRIGGER trg_store_review_achievements ON public.store_reviews.
-- LA PROVA: tests/sql/rls/riparazione-r05-traguardo-votato.test.sql.
-- =============================================================================

BEGIN;

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
    IF TG_TABLE_NAME = 'store_reviews' THEN
        -- Recensione al negozio: il venditore e' il negozio recensito.
        v_seller_id := NEW.store_id;
    ELSE
        -- Buyer: 5 recensioni (ai prodotti, come prima)
        SELECT COUNT(*) INTO v_review_count FROM public.reviews WHERE user_id = NEW.user_id;
        IF v_review_count >= 5 THEN
            PERFORM public.unlock_achievement(NEW.user_id, 'reviewer_5');
        END IF;

        SELECT seller_id INTO v_seller_id FROM public.products WHERE id = NEW.product_id;
    END IF;

    -- Seller: Top rated (rating medio 4.5+ con almeno 10 recensioni, ai prodotti E al negozio)
    IF v_seller_id IS NOT NULL THEN
        SELECT COUNT(*), AVG(voto)
          INTO v_seller_review_count, v_seller_avg_rating
          FROM (
                SELECT r.rating AS voto
                  FROM public.reviews r
                  JOIN public.products p ON p.id = r.product_id
                 WHERE p.seller_id = v_seller_id
                UNION ALL
                SELECT sr.rating
                  FROM public.store_reviews sr
                 WHERE sr.store_id = v_seller_id
               ) tutte;
        IF v_seller_review_count >= 10 AND v_seller_avg_rating >= 4.5 THEN
            PERFORM public.unlock_achievement(v_seller_id, 'seller_top_rated');
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_store_review_achievements ON public.store_reviews;
CREATE TRIGGER trg_store_review_achievements
    AFTER INSERT ON public.store_reviews
    FOR EACH ROW
    EXECUTE FUNCTION public.check_achievements_on_review();

COMMIT;

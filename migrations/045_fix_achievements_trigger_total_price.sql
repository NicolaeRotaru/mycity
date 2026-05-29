-- =============================================================================
-- 045 — FIX CRITICO: la conferma consegna falliva sempre ("Verifica fallita")
-- =============================================================================
-- Causa: il trigger check_buyer_achievements_on_order() (AFTER UPDATE OF
-- delivery_status, sul passaggio a DELIVERED) referenzia NEW.total_cents, ma la
-- tabella orders NON ha quella colonna (usa total_price, in euro). Il riferimento
-- a una colonna inesistente solleva un'eccezione → l'UPDATE a DELIVERED dentro
-- verify_delivery_code() fallisce → la RPC torna errore → il rider vede sempre
-- "Verifica fallita", anche col codice corretto.
--
-- Fix:
--  1) usare NEW.total_price (euro) → punti fedeltà = FLOOR(euro) (1 punto/euro).
--  2) blindare: la gamification non deve MAI rompere la consegna → l'intero
--     corpo è protetto da EXCEPTION WHEN OTHERS → RETURN NEW.

CREATE OR REPLACE FUNCTION public.check_buyer_achievements_on_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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

    SELECT COUNT(*) INTO v_order_count
    FROM public.orders
    WHERE user_id = NEW.user_id AND delivery_status = 'DELIVERED';

    SELECT COUNT(DISTINCT seller_id) INTO v_unique_stores
    FROM public.orders
    WHERE user_id = NEW.user_id AND delivery_status = 'DELIVERED';

    IF v_order_count >= 1  THEN PERFORM public.unlock_achievement(NEW.user_id, 'first_order');  END IF;
    IF v_order_count >= 5  THEN PERFORM public.unlock_achievement(NEW.user_id, 'order_5');      END IF;
    IF v_order_count >= 10 THEN PERFORM public.unlock_achievement(NEW.user_id, 'order_10');     END IF;
    IF v_order_count >= 25 THEN PERFORM public.unlock_achievement(NEW.user_id, 'order_25');     END IF;
    IF v_unique_stores >= 3  THEN PERFORM public.unlock_achievement(NEW.user_id, 'explorer_3');  END IF;
    IF v_unique_stores >= 10 THEN PERFORM public.unlock_achievement(NEW.user_id, 'explorer_10'); END IF;

    -- 1 punto fedeltà per ogni euro speso (total_price è in euro).
    IF NEW.total_price IS NOT NULL AND NEW.total_price > 0 THEN
        PERFORM public.award_loyalty_points(
            NEW.user_id,
            FLOOR(NEW.total_price)::int,
            'order_completed',
            NEW.id
        );
    END IF;

    RETURN NEW;
EXCEPTION
    WHEN OTHERS THEN
        -- La gamification è best-effort: non deve MAI bloccare la consegna.
        RETURN NEW;
END;
$function$;

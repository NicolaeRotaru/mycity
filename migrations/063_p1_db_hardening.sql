-- 063: P1 hardening DB — lockdown SECURITY DEFINER, search_path, dispute, lockout OTP
--
-- - SECURITY DEFINER lockdown: revoca EXECUTE ad anon/authenticated sulle funzioni
--   trigger (i trigger girano comunque) e sulle RPC server/cron-only. Restano eseguibili
--   solo le RPC realmente chiamate dal client e is_admin (usata nelle policy RLS).
-- - search_path immutabile sulle 3 funzioni residue segnalate dall'advisor.
-- - dispute: apribile SOLO da una parte dell'ordine (buyer o seller); 1 sola aperta per
--   ordine; all'apertura blocca il payout (orders.dispute_status='OPEN').
-- - OTP pickup/consegna: lockout anti-brute-force (5 tentativi → 15 min).
-- Idempotente.

-- =========================================================
-- 1) search_path immutabile (advisor function_search_path_mutable)
-- =========================================================
ALTER FUNCTION public.touch_updated_at() SET search_path = public;
ALTER FUNCTION public.product_active_discount(uuid) SET search_path = public;
ALTER FUNCTION public.search_products_smart(text, integer) SET search_path = public;

-- =========================================================
-- 2) Lockdown SECURITY DEFINER: revoca EXECUTE ad anon/authenticated
--    (funzioni trigger + RPC server/cron-only). NON tocca le RPC client né is_admin.
-- =========================================================
DO $$
DECLARE
  fn text;
  trigger_fns text[] := ARRAY[
    'auto_republish_on_restock()','award_photo_review_bonus()','cancel_lifecycle_on_first_order()',
    'check_achievements_on_review()','check_buyer_achievements_on_order()','check_referral_achievements()',
    'contact_messages_rate_limit()','create_order_verification_codes()','enforce_order_update_rules()',
    'enforce_profile_update_rules()','enqueue_lifecycle_emails()','handle_new_profile_welcome_bonus()',
    'handle_new_user()','newsletter_rate_limit()','notify_admins_on_sos()','notify_favorite_price_drop()',
    'notify_riders_on_accepted()','notify_riders_on_ready()','product_views_dedup()','reviews_set_verified()',
    'update_conversation_on_message()','update_group_quantity()'
  ];
  server_fns text[] := ARRAY[
    'award_loyalty_points(uuid,integer,text,uuid)','claim_pending_emails(integer)',
    'increment_coupon_usage(text)','list_abandoned_carts_to_recover(integer)',
    'mark_abandoned_cart_email_sent(uuid)','next_invoice_number(uuid,integer)',
    'process_expired_deletions()','unlock_achievement(uuid,text)'
  ];
BEGIN
  FOREACH fn IN ARRAY (trigger_fns || server_fns)
  LOOP
    BEGIN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM anon, authenticated', fn);
    EXCEPTION WHEN undefined_function THEN
      RAISE NOTICE 'skip (assente): %', fn;
    END;
  END LOOP;
END $$;

-- =========================================================
-- 3) DISPUTE: apribile solo da una parte dell'ordine + 1 aperta per ordine + blocca payout
-- =========================================================
DROP POLICY IF EXISTS disputes_open_insert ON public.disputes;
CREATE POLICY disputes_open_insert ON public.disputes
  FOR INSERT WITH CHECK (
    (SELECT auth.uid()) = opener_id
    AND EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_id
        AND ((SELECT auth.uid()) = o.user_id OR (SELECT auth.uid()) = o.seller_id)
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS disputes_one_open_per_order
  ON public.disputes(order_id) WHERE status IN ('open', 'under_review');

-- All'apertura della dispute: blocca il payout dell'ordine (il cron salta dispute_status NOT NULL)
CREATE OR REPLACE FUNCTION public.dispute_block_payout()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM set_config('mycity.allow_order_write', '1', true);
  UPDATE public.orders
    SET dispute_status = 'OPEN', disputed_at = now()
  WHERE id = NEW.order_id AND dispute_status IS NULL;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_dispute_block_payout ON public.disputes;
CREATE TRIGGER trg_dispute_block_payout
  AFTER INSERT ON public.disputes
  FOR EACH ROW EXECUTE FUNCTION public.dispute_block_payout();
REVOKE EXECUTE ON FUNCTION public.dispute_block_payout() FROM anon, authenticated;

-- =========================================================
-- 4) OTP pickup/consegna: lockout anti-brute-force (5 tentativi → 15 min)
-- =========================================================
ALTER TABLE public.order_pickup_codes   ADD COLUMN IF NOT EXISTS attempts int NOT NULL DEFAULT 0;
ALTER TABLE public.order_pickup_codes   ADD COLUMN IF NOT EXISTS locked_until timestamptz;
ALTER TABLE public.order_delivery_codes ADD COLUMN IF NOT EXISTS attempts int NOT NULL DEFAULT 0;
ALTER TABLE public.order_delivery_codes ADD COLUMN IF NOT EXISTS locked_until timestamptz;

CREATE OR REPLACE FUNCTION public.verify_pickup_code(p_order_id uuid, p_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE stored_code text; current_status text; is_assigned boolean; v_seller_id uuid; v_buyer_id uuid;
        v_attempts int; v_locked timestamptz;
BEGIN
  PERFORM set_config('mycity.allow_order_write', '1', true);
  SELECT (rider_id = auth.uid() AND delivery_status = 'ASSIGNED'), seller_id, user_id, delivery_status
  INTO is_assigned, v_seller_id, v_buyer_id, current_status
  FROM public.orders WHERE id = p_order_id;
  IF v_seller_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'ORDER_NOT_FOUND'); END IF;
  IF NOT is_assigned THEN RETURN jsonb_build_object('ok', false, 'reason', 'NOT_ASSIGNED_OR_WRONG_STATUS', 'status', current_status); END IF;

  SELECT code, attempts, locked_until INTO stored_code, v_attempts, v_locked
  FROM public.order_pickup_codes WHERE order_id = p_order_id;
  IF v_locked IS NOT NULL AND v_locked > now() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'LOCKED');
  END IF;
  IF stored_code IS NULL OR stored_code != trim(p_code) THEN
    UPDATE public.order_pickup_codes
      SET attempts = attempts + 1,
          locked_until = CASE WHEN attempts + 1 >= 5 THEN now() + interval '15 minutes' ELSE locked_until END
      WHERE order_id = p_order_id;
    RETURN jsonb_build_object('ok', false, 'reason', 'WRONG_CODE');
  END IF;

  UPDATE public.order_pickup_codes SET verified_at = now(), attempts = 0, locked_until = NULL WHERE order_id = p_order_id;
  UPDATE public.orders SET delivery_status = 'PICKED_UP', picked_up_at = now() WHERE id = p_order_id;
  INSERT INTO public.notifications (user_id, title, body, link) VALUES
    (v_buyer_id,  '✋ Ordine ritirato dal rider', 'Il rider ha ritirato il tuo ordine dal negozio. Sta arrivando da te.', '/orders/' || p_order_id),
    (v_seller_id, '✋ Ordine ritirato', 'Il rider ha confermato il ritiro con il codice.', '/seller/orders/' || p_order_id);
  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.verify_delivery_code(p_order_id uuid, p_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE stored_code text; current_status text; can_verify boolean; v_seller_id uuid; v_buyer_id uuid;
        v_attempts int; v_locked timestamptz;
BEGIN
  PERFORM set_config('mycity.allow_order_write', '1', true);
  SELECT (rider_id = auth.uid() AND delivery_status IN ('PICKED_UP', 'OUT_FOR_DELIVERY')), seller_id, user_id, delivery_status
  INTO can_verify, v_seller_id, v_buyer_id, current_status
  FROM public.orders WHERE id = p_order_id;
  IF v_seller_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'ORDER_NOT_FOUND'); END IF;
  IF NOT can_verify THEN RETURN jsonb_build_object('ok', false, 'reason', 'WRONG_STATUS', 'status', current_status); END IF;

  SELECT code, attempts, locked_until INTO stored_code, v_attempts, v_locked
  FROM public.order_delivery_codes WHERE order_id = p_order_id;
  IF v_locked IS NOT NULL AND v_locked > now() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'LOCKED');
  END IF;
  IF stored_code IS NULL OR stored_code != trim(p_code) THEN
    UPDATE public.order_delivery_codes
      SET attempts = attempts + 1,
          locked_until = CASE WHEN attempts + 1 >= 5 THEN now() + interval '15 minutes' ELSE locked_until END
      WHERE order_id = p_order_id;
    RETURN jsonb_build_object('ok', false, 'reason', 'WRONG_CODE');
  END IF;

  UPDATE public.order_delivery_codes SET verified_at = now(), attempts = 0, locked_until = NULL WHERE order_id = p_order_id;
  UPDATE public.orders SET delivery_status = 'DELIVERED', delivered_at = now() WHERE id = p_order_id;
  INSERT INTO public.notifications (user_id, title, body, link) VALUES
    (v_buyer_id,  '✅ Ordine consegnato', 'Il tuo ordine è stato consegnato. Buon appetito!', '/orders/' || p_order_id),
    (v_seller_id, '✅ Ordine consegnato', 'L''ordine è stato consegnato al cliente.', '/seller/orders/' || p_order_id);
  RETURN jsonb_build_object('ok', true);
END;
$$;

NOTIFY pgrst, 'reload schema';

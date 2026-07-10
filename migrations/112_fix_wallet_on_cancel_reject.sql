-- 112: restituisce il credito wallet su annullo buyer e rifiuto venditore
--
-- PROBLEMA: cancel_order e seller_reject_order non stornano wallet_applied_cents.
-- Solo expire-stale-orders lo fa. Fix: aggiungi wallet_credit in entrambe le RPC.
--
-- Idempotente: usa CREATE OR REPLACE con la firma esatta delle versioni esistenti
-- (062_atomic_stock_reservation.sql) — stessa signature, stesso return type jsonb,
-- stessa SECURITY DEFINER + SET search_path. Si aggiunge solo il blocco wallet
-- prima dell'UPDATE finale.

-- cancel_order: ripristina lo stock e il credito wallet all'annullo del buyer
CREATE OR REPLACE FUNCTION public.cancel_order(p_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_seller_id uuid;
  v_rider_id  uuid;
  v_wallet    int;
  v_uid       uuid;
  current_status text;
  is_owner    boolean;
BEGIN
  PERFORM set_config('mycity.allow_order_write', '1', true);

  SELECT (user_id = auth.uid()), seller_id, rider_id, delivery_status,
         user_id, COALESCE(wallet_applied_cents, 0)
    INTO is_owner, v_seller_id, v_rider_id, current_status, v_uid, v_wallet
    FROM public.orders
   WHERE id = p_order_id;

  IF v_seller_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'ORDER_NOT_FOUND');
  END IF;
  IF NOT is_owner THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NOT_OWNER');
  END IF;
  IF current_status NOT IN ('NEW') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'TOO_LATE', 'status', current_status);
  END IF;

  UPDATE public.orders
     SET delivery_status = 'CANCELED', canceled_at = now()
   WHERE id = p_order_id;

  PERFORM public.restore_stock_for_order(p_order_id);

  -- Restituisci credito wallet se era stato usato nell'ordine
  IF v_wallet > 0 THEN
    PERFORM public.wallet_credit(v_uid, v_wallet, 'order_canceled_refund', p_order_id::text);
  END IF;

  IF v_seller_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, title, body, link) VALUES
      (v_seller_id,
       '❌ Ordine annullato dal cliente',
       'Il cliente ha annullato l''ordine #' || substr(p_order_id::text, 1, 6) || ' prima della tua conferma.',
       '/seller/orders/' || p_order_id);
  END IF;
  IF v_rider_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, title, body, link) VALUES
      (v_rider_id,
       '❌ Ordine annullato',
       'L''ordine #' || substr(p_order_id::text, 1, 6) || ' e'' stato annullato.',
       '/rider');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- seller_reject_order: ripristina lo stock e il credito wallet al rifiuto del venditore
CREATE OR REPLACE FUNCTION public.seller_reject_order(p_order_id uuid, p_reason text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_buyer_id     uuid;
  v_wallet       int;
  current_status text;
  is_seller      boolean;
BEGIN
  PERFORM set_config('mycity.allow_order_write', '1', true);

  SELECT (seller_id = auth.uid()), user_id, delivery_status,
         COALESCE(wallet_applied_cents, 0)
    INTO is_seller, v_buyer_id, current_status, v_wallet
    FROM public.orders
   WHERE id = p_order_id;

  IF v_buyer_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'ORDER_NOT_FOUND');
  END IF;
  IF NOT is_seller THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NOT_SELLER');
  END IF;
  IF current_status NOT IN ('NEW', 'ACCEPTED') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'TOO_LATE', 'status', current_status);
  END IF;

  UPDATE public.orders
     SET delivery_status = 'CANCELED', canceled_at = now()
   WHERE id = p_order_id;

  PERFORM public.restore_stock_for_order(p_order_id);

  -- Restituisci credito wallet se era stato usato nell'ordine
  IF v_wallet > 0 THEN
    PERFORM public.wallet_credit(v_buyer_id, v_wallet, 'order_rejected_refund', p_order_id::text);
  END IF;

  INSERT INTO public.notifications (user_id, title, body, link) VALUES
    (v_buyer_id,
     '❌ Ordine rifiutato dal negozio',
     COALESCE('Motivo: ' || p_reason, 'Il negozio non puo'' completare il tuo ordine. Niente addebiti.'),
     '/orders/' || p_order_id);

  RETURN jsonb_build_object('ok', true);
END;
$$;

NOTIFY pgrst, 'reload schema';

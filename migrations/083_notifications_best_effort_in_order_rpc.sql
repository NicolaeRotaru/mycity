-- 083_notifications_best_effort_in_order_rpc.sql
--
-- FIX affidabilità (avanzamento ordine bloccato da una notifica).
-- In verify_pickup_code / verify_delivery_code (063) l'INSERT in `notifications`
-- avveniva nella STESSA transazione dell'UPDATE che porta l'ordine a
-- PICKED_UP / DELIVERED. Se l'INSERT della notifica fallisce (vincolo, lock,
-- colonna futura, ecc.) l'intera transazione abortisce e l'ordine NON avanza:
-- il rider conferma la consegna ma lo stato resta indietro.
--
-- Le notifiche sono best-effort: le isoliamo in un sotto-blocco
-- BEGIN ... EXCEPTION WHEN OTHERS THEN NULL così non bloccano mai la transizione.
-- Corpo identico a 063 a meno del wrapping EXCEPTION attorno agli INSERT.
-- CREATE OR REPLACE preserva i GRANT esistenti (064/067). Idempotente.

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
  -- Notifica best-effort: un errore qui non deve far fallire l'avanzamento ordine.
  BEGIN
    INSERT INTO public.notifications (user_id, title, body, link) VALUES
      (v_buyer_id,  '✋ Ordine ritirato dal rider', 'Il rider ha ritirato il tuo ordine dal negozio. Sta arrivando da te.', '/orders/' || p_order_id),
      (v_seller_id, '✋ Ordine ritirato', 'Il rider ha confermato il ritiro con il codice.', '/seller/orders/' || p_order_id);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
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
  -- Notifica best-effort: un errore qui non deve far fallire l'avanzamento ordine.
  BEGIN
    INSERT INTO public.notifications (user_id, title, body, link) VALUES
      (v_buyer_id,  '✅ Ordine consegnato', 'Il tuo ordine è stato consegnato. Buon appetito!', '/orders/' || p_order_id),
      (v_seller_id, '✅ Ordine consegnato', 'L''ordine è stato consegnato al cliente.', '/seller/orders/' || p_order_id);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  RETURN jsonb_build_object('ok', true);
END;
$$;

NOTIFY pgrst, 'reload schema';

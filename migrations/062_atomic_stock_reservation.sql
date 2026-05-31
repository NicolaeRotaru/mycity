-- 062: P0-4 — prevenzione overselling con riserva atomica dello stock
--
-- Problema: lo stock non veniva MAI decrementato → un prodotto con stock=1 si vendeva
-- infinite volte (incassi su merce inesistente, valanga di rimborsi).
--
-- Soluzione: RPC atomiche con guard `stock >= qty`.
--   - reserve_stock(items):        decrementa tutti gli item; RAISE se uno è insufficiente
--                                  (rollback dell'intera riserva). Usata da checkout (carta)
--                                  e ordini COD PRIMA di prendere soldi / creare ordini.
--   - restore_stock(items):        ripristina (checkout scaduto / sessione Stripe fallita).
--   - restore_stock_for_order(id): ripristina leggendo order_items (annullo / rimborso pieno).
--
-- Semantica stock NULL = illimitato (coerente col check esistente `typeof stock === 'number'`).
-- Le RPC NON sono esposte ad anon/authenticated (solo server service-role + RPC fidate).
-- Idempotente.

CREATE OR REPLACE FUNCTION public.reserve_stock(p_items jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  it jsonb;
  v_pid uuid;
  v_qty int;
  v_updated int;
BEGIN
  FOR it IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_pid := (it->>'product_id')::uuid;
    v_qty := (it->>'qty')::int;
    IF v_pid IS NULL OR v_qty IS NULL OR v_qty <= 0 THEN
      CONTINUE;
    END IF;
    -- stock NULL = illimitato (la riga matcha, valore resta NULL); numerico = guard
    UPDATE public.products
      SET stock = stock - v_qty
      WHERE id = v_pid AND (stock IS NULL OR stock >= v_qty);
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated = 0 THEN
      RAISE EXCEPTION 'OUT_OF_STOCK:%', v_pid USING ERRCODE = '23514';
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.restore_stock(p_items jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  it jsonb;
BEGIN
  FOR it IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    UPDATE public.products
      SET stock = stock + (it->>'qty')::int
      WHERE id = (it->>'product_id')::uuid AND stock IS NOT NULL;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.restore_stock_for_order(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.products p
    SET stock = p.stock + oi.quantity
  FROM public.order_items oi
  WHERE oi.order_id = p_order_id
    AND oi.product_id = p.id
    AND p.stock IS NOT NULL;
END;
$$;

-- Niente esecuzione diretta da client: solo backend service-role o RPC fidate.
REVOKE ALL ON FUNCTION public.reserve_stock(jsonb) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.restore_stock(jsonb) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.restore_stock_for_order(uuid) FROM anon, authenticated;

-- cancel_order: ripristina lo stock riservato all'annullo del buyer (stato NEW)
CREATE OR REPLACE FUNCTION public.cancel_order(p_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_seller_id uuid; v_rider_id uuid; current_status text; is_owner boolean;
BEGIN
  PERFORM set_config('mycity.allow_order_write', '1', true);
  SELECT (user_id = auth.uid()), seller_id, rider_id, delivery_status
  INTO is_owner, v_seller_id, v_rider_id, current_status
  FROM public.orders WHERE id = p_order_id;
  IF v_seller_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'ORDER_NOT_FOUND'); END IF;
  IF NOT is_owner THEN RETURN jsonb_build_object('ok', false, 'reason', 'NOT_OWNER'); END IF;
  IF current_status NOT IN ('NEW') THEN RETURN jsonb_build_object('ok', false, 'reason', 'TOO_LATE', 'status', current_status); END IF;
  UPDATE public.orders SET delivery_status = 'CANCELED', canceled_at = now() WHERE id = p_order_id;
  PERFORM public.restore_stock_for_order(p_order_id);
  IF v_seller_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, title, body, link) VALUES
      (v_seller_id, '❌ Ordine annullato dal cliente', 'Il cliente ha annullato l''ordine #' || substr(p_order_id::text, 1, 6) || ' prima della tua conferma.', '/seller/orders/' || p_order_id);
  END IF;
  IF v_rider_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, title, body, link) VALUES
      (v_rider_id, '❌ Ordine annullato', 'L''ordine #' || substr(p_order_id::text, 1, 6) || ' e'' stato annullato.', '/rider');
  END IF;
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- seller_reject_order: ripristina lo stock riservato al rifiuto del venditore
CREATE OR REPLACE FUNCTION public.seller_reject_order(p_order_id uuid, p_reason text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_buyer_id uuid; current_status text; is_seller boolean;
BEGIN
  PERFORM set_config('mycity.allow_order_write', '1', true);
  SELECT (seller_id = auth.uid()), user_id, delivery_status
  INTO is_seller, v_buyer_id, current_status
  FROM public.orders WHERE id = p_order_id;
  IF v_buyer_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'ORDER_NOT_FOUND'); END IF;
  IF NOT is_seller THEN RETURN jsonb_build_object('ok', false, 'reason', 'NOT_SELLER'); END IF;
  IF current_status NOT IN ('NEW', 'ACCEPTED') THEN RETURN jsonb_build_object('ok', false, 'reason', 'TOO_LATE', 'status', current_status); END IF;
  UPDATE public.orders SET delivery_status = 'CANCELED', canceled_at = now() WHERE id = p_order_id;
  PERFORM public.restore_stock_for_order(p_order_id);
  INSERT INTO public.notifications (user_id, title, body, link) VALUES
    (v_buyer_id, '❌ Ordine rifiutato dal negozio', COALESCE('Motivo: ' || p_reason, 'Il negozio non puo'' completare il tuo ordine. Niente addebiti.'), '/orders/' || p_order_id);
  RETURN jsonb_build_object('ok', true);
END;
$$;

NOTIFY pgrst, 'reload schema';

-- 066: P2 — stato REFUNDED/PARTIALLY_REFUNDED + rilascio consegna rider
--
-- - payment_status: aggiunge REFUNDED e PARTIALLY_REFUNDED (prima i rimborsi venivano
--   marcati 'FAILED', confondendo "mai pagato" con "pagato poi rimborsato") + colonna
--   refunded_amount_cents per la reportistica finanziaria.
-- - rider_release_order: il rider può rilasciare un ordine ASSIGNED (rimette READY,
--   rider_id NULL) se non può completarlo → evita consegne orfane bloccate su un rider.
-- Idempotente.

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_payment_status_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_payment_status_check
  CHECK (payment_status IN ('PAID', 'FAILED', 'PENDING', 'REFUNDED', 'PARTIALLY_REFUNDED'));

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS refunded_amount_cents int NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.rider_release_order(p_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_status text; is_mine boolean;
BEGIN
  PERFORM set_config('mycity.allow_order_write', '1', true);
  SELECT (rider_id = auth.uid()), delivery_status INTO is_mine, v_status
  FROM public.orders WHERE id = p_order_id;
  IF is_mine IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'ORDER_NOT_FOUND'); END IF;
  IF NOT is_mine THEN RETURN jsonb_build_object('ok', false, 'reason', 'NOT_YOURS'); END IF;
  -- Solo prima del ritiro: dopo PICKED_UP il rider ha la merce, serve intervento admin.
  IF v_status NOT IN ('ASSIGNED') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'TOO_LATE', 'status', v_status);
  END IF;
  UPDATE public.orders
    SET delivery_status = 'READY', rider_id = NULL,
        rider_lat = NULL, rider_lng = NULL, rider_position_updated_at = NULL
  WHERE id = p_order_id;
  RETURN jsonb_build_object('ok', true);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.rider_release_order(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rider_release_order(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

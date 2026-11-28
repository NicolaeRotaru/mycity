-- 999t_il_ritiro_in_negozio_non_corre_con_l_annullo.sql
--
-- Collaudo dell'onda 2 (28/11/2026). Il ritiro in negozio è acceso al lancio (R12-009), e
-- `confirm_pickup_by_seller` (179) leggeva lo stato dell'ordine e poi lo scriveva DELIVERED senza
-- condizione: un annullo dell'amministrazione arrivato fra la lettura e la scrittura veniva
-- sovrascritto. Il cliente rimborsato, la merce consegnata, il negozio non pagato.
--
-- Ora la riga dell'ordine si blocca alla lettura (FOR UPDATE) e la scrittura vale solo se l'ordine
-- è ancora ACCEPTED o READY; altrimenti WRONG_STATUS, come quando lo stato è già sbagliato.
-- Il resto della funzione è quello della 179. Si può rieseguire (CREATE OR REPLACE; i permessi
-- restano quelli della 425).
--
-- Indietro: rieseguire la definizione della 179.

BEGIN;

CREATE OR REPLACE FUNCTION public.confirm_pickup_by_seller(p_order_id uuid, p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_seller_id uuid;
  v_buyer_id uuid;
  v_pickup boolean;
  v_status text;
  v_method text;
  v_payout text;
  stored_code text;
  v_attempts int;
  v_locked timestamptz;
BEGIN
  SELECT seller_id, user_id, coalesce(pickup_in_store, false), delivery_status, payment_method, payout_status
    INTO v_seller_id, v_buyer_id, v_pickup, v_status, v_method, v_payout
  FROM public.orders WHERE id = p_order_id
  -- 999t: la riga si blocca subito. Un annullo dell'amministrazione nello stesso istante aspetta,
  -- o è già passato e qui si legge CANCELED (WRONG_STATUS).
  FOR UPDATE;

  IF v_seller_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'ORDER_NOT_FOUND');
  END IF;
  IF v_seller_id <> auth.uid() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'FORBIDDEN');
  END IF;
  IF NOT v_pickup THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NOT_PICKUP');
  END IF;
  IF v_status NOT IN ('ACCEPTED', 'READY') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'WRONG_STATUS', 'status', v_status);
  END IF;

  SELECT code, attempts, locked_until INTO stored_code, v_attempts, v_locked
  FROM public.order_delivery_codes WHERE order_id = p_order_id;

  IF v_locked IS NOT NULL AND v_locked > now() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'LOCKED');
  END IF;
  -- 125: un codice assente o vuoto e' un rifiuto, non un confronto che da' NULL.
  IF p_code IS NULL OR btrim(p_code) = '' OR stored_code IS NULL OR stored_code IS DISTINCT FROM btrim(p_code) THEN
    UPDATE public.order_delivery_codes
       SET attempts = attempts + 1,
           locked_until = CASE WHEN attempts + 1 >= 5 THEN now() + interval '15 minutes' ELSE locked_until END
     WHERE order_id = p_order_id;
    RETURN jsonb_build_object('ok', false, 'reason', 'WRONG_CODE');
  END IF;

  UPDATE public.order_delivery_codes
     SET verified_at = now(), attempts = 0, locked_until = NULL
   WHERE order_id = p_order_id;

  -- Solo qui: il chiamante e' il negozio dell'ordine, il ritiro e' suo e il codice e' giusto.
  PERFORM set_config('mycity.allow_order_write', '1', true);

  UPDATE public.orders
     SET delivery_status = 'DELIVERED',
         delivered_at = now(),
         payment_status = CASE WHEN v_method = 'cod' THEN 'PAID' ELSE payment_status END,
         payout_status = CASE
           WHEN v_method = 'cod' THEN 'CASH_IN_STORE'
           WHEN v_payout = 'AWAITING_REMITTANCE' THEN 'HELD'
           ELSE v_payout
         END
   WHERE id = p_order_id
     AND delivery_status IN ('ACCEPTED', 'READY');
  -- 999t: se lo stato è cambiato nel frattempo, il ritiro non si registra.
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'WRONG_STATUS');
  END IF;

  BEGIN
    INSERT INTO public.notifications (category, user_id, title, body, link) VALUES
      ('order', v_buyer_id, 'Ordine ritirato',
       'Hai ritirato il tuo ordine in negozio. Grazie! Puoi lasciare una recensione.',
       '/orders/' || p_order_id);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object('ok', true);
END;
$function$;

COMMIT;

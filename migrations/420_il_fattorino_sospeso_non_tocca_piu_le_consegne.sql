-- Il fattorino sospeso non tocca piu' le consegne che aveva in mano.
--
-- IL DIFETTO (R18-025). Sospendere un fattorino (app/api/admin/users/[id]/moderate/route.ts) cambia
-- solo is_approved e approval_status. L'approvazione si guardava solo all'ingresso, quando prende
-- l'ordine (prendi_ordine, 270): dopo, il sospeso
--   · leggeva ancora gli ordini suoi coi recapiti del cliente: la regola di lettura
--     «Riders can view available and own orders» (127, riga 718; ultima versione 215, riga 761)
--     guarda solo rider_id e lo stato;
--   · ritirava col codice del negozio (verify_pickup_code, ultima versione 127, riga 499) e chiudeva
--     la consegna col codice del cliente (verify_delivery_code, ultima versione 215, riga 832): le due
--     funzioni sono SECURITY DEFINER e controllavano solo rider_id e lo stato, scavalcando la regola
--     di aggiornamento diretto, che invece usa is_rider_approvato() (161, riga 366).
--
-- LA CURA. is_rider_approvato() (114: ruolo rider e is_approved, risponde solo su chi chiama) entra
-- nelle due funzioni e nella regola di lettura. Il resto delle due funzioni e' identico alla versione
-- in vigore: stessa firma, stessi permessi (CREATE OR REPLACE li tiene), stessi codici di risposta.
-- Il sospeso riceve quelli che conosce gia' il pannello (components/VerifyCodeDialog.tsx):
-- NOT_ASSIGNED_OR_WRONG_STATUS al ritiro, WRONG_STATUS alla consegna.
-- Non si usa is_rider_in_regola() (270): con la patente o la polizza scadute a meta' giro la consegna
-- gia' presa si finisce (270, intestazione). La sospensione e' un'altra cosa: la decide una persona.
--
-- Le altre due meta' della voce stanno fuori da qui:
--   · la rotta di sospensione rimette in bacheca gli ordini ASSIGNED del fattorino e avvisa
--     l'amministratore per quelli gia' ritirati (PICKED_UP, OUT_FOR_DELIVERY), che chiude lui
--     (admin_chiudi_consegna, 360);
--   · le rotte app/api/rider/cash-confirm e app/api/rider/orders/[id]/cliente-assente leggono col
--     client di servizio e non passano da qui.
--
-- REVERSIBILE: rieseguire verify_pickup_code e verify_delivery_code senza la riga
-- «AND public.is_rider_approvato()», e la regola di lettura com'e' nella 215 (riga 761).
--
-- LA PROVA: tests/sql/rls/riparazione-r18-rider-sospeso.test.sql. Un fattorino sospeso con un ordine
-- assegnato e uno ritirato: non legge i recapiti, non ritira, non consegna. Quello approvato si'.

BEGIN;

CREATE OR REPLACE FUNCTION public.verify_pickup_code(p_order_id uuid, p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE stored_code text; current_status text; is_assigned boolean; v_seller_id uuid; v_buyer_id uuid;
        v_attempts int; v_locked timestamptz;
BEGIN
  IF p_code IS NULL OR btrim(p_code) = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'WRONG_CODE');
  END IF;

  -- 420 (R18-025) — e solo se e' ancora un fattorino approvato: il sospeso non ritira.
  SELECT (rider_id = (SELECT auth.uid()) AND delivery_status = 'ASSIGNED' AND public.is_rider_approvato()),
         seller_id, user_id, delivery_status
  INTO is_assigned, v_seller_id, v_buyer_id, current_status
  FROM public.orders WHERE id = p_order_id;
  IF v_seller_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'ORDER_NOT_FOUND'); END IF;
  IF is_assigned IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NOT_ASSIGNED_OR_WRONG_STATUS', 'status', current_status);
  END IF;

  SELECT code, attempts, locked_until INTO stored_code, v_attempts, v_locked
  FROM public.order_pickup_codes WHERE order_id = p_order_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'CODE_NOT_ISSUED');
  END IF;

  IF v_locked IS NOT NULL AND v_locked > now() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'LOCKED');
  END IF;

  IF stored_code IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'CODE_NOT_ISSUED');
  END IF;

  IF stored_code IS DISTINCT FROM btrim(p_code) THEN
    UPDATE public.order_pickup_codes
      SET attempts = attempts + 1,
          locked_until = CASE WHEN attempts + 1 >= 5 THEN now() + interval '15 minutes' ELSE locked_until END
      WHERE order_id = p_order_id;
    IF v_attempts + 1 >= 5 THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'LOCKED');
    END IF;
    RETURN jsonb_build_object('ok', false, 'reason', 'WRONG_CODE');
  END IF;

  PERFORM set_config('mycity.allow_order_write', '1', true);

  UPDATE public.order_pickup_codes SET verified_at = now(), attempts = 0, locked_until = NULL
    WHERE order_id = p_order_id;
  UPDATE public.orders SET delivery_status = 'PICKED_UP', picked_up_at = now() WHERE id = p_order_id;
  BEGIN
    INSERT INTO public.notifications (user_id, title, body, link, category) VALUES
      (v_buyer_id,  'Ordine ritirato dal rider', 'Il rider ha ritirato il tuo ordine dal negozio. Sta arrivando da te.', '/orders/' || p_order_id, 'order'),
      (v_seller_id, 'Ordine ritirato', 'Il rider ha confermato il ritiro con il codice.', '/seller/orders/' || p_order_id, 'order');
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  RETURN jsonb_build_object('ok', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.verify_delivery_code(p_order_id uuid, p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE stored_code text; current_status text; can_verify boolean; v_seller_id uuid; v_buyer_id uuid;
        v_attempts int; v_locked timestamptz;
        v_metodo text; v_incasso timestamptz;
        v_scritte int;
BEGIN
  IF p_code IS NULL OR btrim(p_code) = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'WRONG_CODE');
  END IF;

  -- 420 (R18-025) — e solo se e' ancora un fattorino approvato: il sospeso non chiude la consegna.
  SELECT (rider_id = (SELECT auth.uid()) AND delivery_status IN ('PICKED_UP', 'OUT_FOR_DELIVERY')
          AND public.is_rider_approvato()),
         seller_id, user_id, delivery_status, payment_method, cash_confirmed_at
  INTO can_verify, v_seller_id, v_buyer_id, current_status, v_metodo, v_incasso
  FROM public.orders WHERE id = p_order_id
  FOR UPDATE;
  IF v_seller_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'ORDER_NOT_FOUND'); END IF;
  IF can_verify IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'WRONG_STATUS', 'status', current_status);
  END IF;

  -- R33 — Contanti: prima l'incasso, poi la consegna. Senza incasso dichiarato
  -- la rimessa della sera salta l'ordine e il negozio non viene pagato.
  IF v_metodo = 'cod' AND v_incasso IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'CASH_NOT_CONFIRMED');
  END IF;

  -- FOR UPDATE: i tentativi simultanei si mettono in fila, così il contatore
  -- conta davvero. Senza, cinque tentativi insieme valgono uno.
  SELECT code, attempts, locked_until INTO stored_code, v_attempts, v_locked
  FROM public.order_delivery_codes WHERE order_id = p_order_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'CODE_NOT_ISSUED');
  END IF;

  IF v_locked IS NOT NULL AND v_locked > now() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'LOCKED');
  END IF;

  IF stored_code IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'CODE_NOT_ISSUED');
  END IF;

  IF stored_code IS DISTINCT FROM btrim(p_code) THEN
    UPDATE public.order_delivery_codes
      SET attempts = attempts + 1,
          locked_until = CASE WHEN attempts + 1 >= 5 THEN now() + interval '15 minutes' ELSE locked_until END
      WHERE order_id = p_order_id;
    IF v_attempts + 1 >= 5 THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'LOCKED');
    END IF;
    RETURN jsonb_build_object('ok', false, 'reason', 'WRONG_CODE');
  END IF;

  -- Da qui in poi si scrive: la chiave si alza adesso, non prima.
  PERFORM set_config('mycity.allow_order_write', '1', true);

  UPDATE public.orders
    SET delivery_status = 'DELIVERED', delivered_at = now(),
        rider_lat = NULL, rider_lng = NULL, rider_position_updated_at = NULL
    WHERE id = p_order_id
      AND delivery_status IN ('PICKED_UP', 'OUT_FOR_DELIVERY');
  GET DIAGNOSTICS v_scritte = ROW_COUNT;
  IF v_scritte = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'WRONG_STATUS');
  END IF;
  UPDATE public.order_delivery_codes SET verified_at = now(), attempts = 0, locked_until = NULL
    WHERE order_id = p_order_id;
  BEGIN
    INSERT INTO public.notifications (user_id, title, body, link, category) VALUES
      (v_buyer_id,  'Ordine consegnato', 'Il tuo ordine è stato consegnato. Buon appetito!', '/orders/' || p_order_id, 'order'),
      (v_seller_id, 'Ordine consegnato', 'L''ordine è stato consegnato al cliente.', '/seller/orders/' || p_order_id, 'order');
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'verify_delivery_code: avvisi di consegna non scritti per %: %', p_order_id, SQLERRM;
  END;
  RETURN jsonb_build_object('ok', true);
END;
$function$;

-- La regola di lettura del fattorino: quella della 215, con l'approvazione davanti.
-- (SELECT …) perche' Postgres la calcoli una volta per domanda, non una per riga.
DROP POLICY IF EXISTS "Riders can view available and own orders" ON public.orders;
CREATE POLICY "Riders can view available and own orders" ON public.orders
  FOR SELECT
  TO authenticated
  USING (
    (SELECT public.is_rider_approvato())
    AND rider_id = (SELECT auth.uid())
    AND (
      delivery_status NOT IN ('DELIVERED', 'CANCELED')
      OR (delivery_status = 'DELIVERED' AND (delivered_at IS NULL OR delivered_at > now() - interval '7 days'))
      OR (delivery_status = 'CANCELED' AND canceled_at > now() - interval '7 days')
    )
  );

COMMIT;

NOTIFY pgrst, 'reload schema';

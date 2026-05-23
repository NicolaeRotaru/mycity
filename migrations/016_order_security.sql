-- 016: cancellazione ordine + verifica anti-frode con codici pickup/delivery
--
-- Architettura sicura:
-- - 2 tabelle separate (pickup, delivery) con RLS che separa visibilita':
--   seller vede SOLO il codice pickup, buyer vede SOLO il codice delivery
-- - Funzioni SECURITY DEFINER per verifica: il rider non puo' MAI leggere
--   i codici, puo' solo "tentare la verifica" passando il codice ricevuto
-- - Cancellazione ordine via funzione: solo da buyer, solo se stato NEW
-- - Notifiche inserite direttamente nelle funzioni server-side (atomiche)
-- - Backfill automatico dei codici per gli ordini esistenti
--
-- Idempotente.

-- ============================================
-- 1) Tabelle codici verifica
-- ============================================
CREATE TABLE IF NOT EXISTS public.order_pickup_codes (
  order_id uuid PRIMARY KEY REFERENCES public.orders(id) ON DELETE CASCADE,
  code text NOT NULL,
  verified_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.order_delivery_codes (
  order_id uuid PRIMARY KEY REFERENCES public.orders(id) ON DELETE CASCADE,
  code text NOT NULL,
  verified_at timestamptz,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.order_pickup_codes   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_delivery_codes ENABLE ROW LEVEL SECURITY;

-- Pickup code: visibile SOLO al seller dell'ordine
DROP POLICY IF EXISTS "Seller reads pickup code" ON public.order_pickup_codes;
CREATE POLICY "Seller reads pickup code" ON public.order_pickup_codes
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.orders
      WHERE id = order_id AND seller_id = auth.uid()
    )
  );

-- Admin vede tutto (per debug/supporto)
DROP POLICY IF EXISTS "Admin reads pickup codes" ON public.order_pickup_codes;
CREATE POLICY "Admin reads pickup codes" ON public.order_pickup_codes
  FOR SELECT USING (public.is_admin());

-- Delivery code: visibile SOLO al buyer dell'ordine
DROP POLICY IF EXISTS "Buyer reads delivery code" ON public.order_delivery_codes;
CREATE POLICY "Buyer reads delivery code" ON public.order_delivery_codes
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.orders
      WHERE id = order_id AND user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Admin reads delivery codes" ON public.order_delivery_codes;
CREATE POLICY "Admin reads delivery codes" ON public.order_delivery_codes
  FOR SELECT USING (public.is_admin());

-- ============================================
-- 2) Funzione: genera codice 6 cifre
-- ============================================
CREATE OR REPLACE FUNCTION public.generate_verification_code()
RETURNS text
LANGUAGE sql
AS $$
  SELECT lpad(floor(random() * 1000000)::text, 6, '0');
$$;

-- ============================================
-- 3) Trigger: crea codici quando nasce un ordine
-- ============================================
CREATE OR REPLACE FUNCTION public.create_order_verification_codes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.order_pickup_codes (order_id, code)
  VALUES (NEW.id, public.generate_verification_code())
  ON CONFLICT (order_id) DO NOTHING;

  INSERT INTO public.order_delivery_codes (order_id, code)
  VALUES (NEW.id, public.generate_verification_code())
  ON CONFLICT (order_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS create_codes_on_order_insert ON public.orders;
CREATE TRIGGER create_codes_on_order_insert
  AFTER INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.create_order_verification_codes();

-- Backfill per ordini esistenti senza codici
INSERT INTO public.order_pickup_codes (order_id, code)
SELECT o.id, public.generate_verification_code()
FROM public.orders o
WHERE NOT EXISTS (SELECT 1 FROM public.order_pickup_codes c WHERE c.order_id = o.id);

INSERT INTO public.order_delivery_codes (order_id, code)
SELECT o.id, public.generate_verification_code()
FROM public.orders o
WHERE NOT EXISTS (SELECT 1 FROM public.order_delivery_codes c WHERE c.order_id = o.id);

-- ============================================
-- 4) Funzione: verifica codice PICKUP (chiamata dal rider)
-- ============================================
CREATE OR REPLACE FUNCTION public.verify_pickup_code(p_order_id uuid, p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  stored_code text;
  current_status text;
  is_assigned boolean;
  v_seller_id uuid;
  v_buyer_id  uuid;
BEGIN
  -- Verifica: ordine assegnato al rider chiamante, stato ASSIGNED
  SELECT
    (rider_id = auth.uid() AND delivery_status = 'ASSIGNED'),
    seller_id,
    user_id,
    delivery_status
  INTO is_assigned, v_seller_id, v_buyer_id, current_status
  FROM public.orders
  WHERE id = p_order_id;

  IF v_seller_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'ORDER_NOT_FOUND');
  END IF;
  IF NOT is_assigned THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NOT_ASSIGNED_OR_WRONG_STATUS', 'status', current_status);
  END IF;

  SELECT code INTO stored_code FROM public.order_pickup_codes WHERE order_id = p_order_id;
  IF stored_code IS NULL OR stored_code != trim(p_code) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'WRONG_CODE');
  END IF;

  -- Aggiorna codice e ordine
  UPDATE public.order_pickup_codes SET verified_at = now() WHERE order_id = p_order_id;
  UPDATE public.orders
  SET delivery_status = 'PICKED_UP',
      picked_up_at = now()
  WHERE id = p_order_id;

  -- Notifiche atomiche
  INSERT INTO public.notifications (user_id, title, body, link) VALUES
    (v_buyer_id,  '✋ Ordine ritirato dal rider',
       'Il rider ha ritirato il tuo ordine dal negozio. Sta arrivando da te.',
       '/orders/' || p_order_id),
    (v_seller_id, '✋ Ordine ritirato',
       'Il rider ha confermato il ritiro con il codice.',
       '/seller/orders/' || p_order_id);

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ============================================
-- 5) Funzione: verifica codice DELIVERY (chiamata dal rider)
-- ============================================
CREATE OR REPLACE FUNCTION public.verify_delivery_code(p_order_id uuid, p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  stored_code text;
  current_status text;
  can_verify boolean;
  v_seller_id uuid;
  v_buyer_id  uuid;
BEGIN
  -- Verifica: ordine assegnato al rider chiamante, stato PICKED_UP o OUT_FOR_DELIVERY
  SELECT
    (rider_id = auth.uid() AND delivery_status IN ('PICKED_UP', 'OUT_FOR_DELIVERY')),
    seller_id,
    user_id,
    delivery_status
  INTO can_verify, v_seller_id, v_buyer_id, current_status
  FROM public.orders
  WHERE id = p_order_id;

  IF v_seller_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'ORDER_NOT_FOUND');
  END IF;
  IF NOT can_verify THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'WRONG_STATUS', 'status', current_status);
  END IF;

  SELECT code INTO stored_code FROM public.order_delivery_codes WHERE order_id = p_order_id;
  IF stored_code IS NULL OR stored_code != trim(p_code) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'WRONG_CODE');
  END IF;

  UPDATE public.order_delivery_codes SET verified_at = now() WHERE order_id = p_order_id;
  UPDATE public.orders
  SET delivery_status = 'DELIVERED',
      delivered_at = now()
  WHERE id = p_order_id;

  INSERT INTO public.notifications (user_id, title, body, link) VALUES
    (v_buyer_id,  '✅ Ordine consegnato',
       'Il tuo ordine è stato consegnato. Buon appetito!',
       '/orders/' || p_order_id),
    (v_seller_id, '✅ Ordine consegnato',
       'L''ordine è stato consegnato al cliente.',
       '/seller/orders/' || p_order_id);

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ============================================
-- 6) Funzione: cancellazione ordine (solo buyer, solo stato NEW)
-- ============================================
CREATE OR REPLACE FUNCTION public.cancel_order(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seller_id uuid;
  v_rider_id uuid;
  current_status text;
  is_owner boolean;
BEGIN
  SELECT
    (user_id = auth.uid()),
    seller_id,
    rider_id,
    delivery_status
  INTO is_owner, v_seller_id, v_rider_id, current_status
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
  SET delivery_status = 'CANCELED',
      canceled_at = now()
  WHERE id = p_order_id;

  -- Notifica seller
  IF v_seller_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, title, body, link) VALUES
      (v_seller_id, '❌ Ordine annullato dal cliente',
       'Il cliente ha annullato l''ordine #' || substr(p_order_id::text, 1, 6) || ' prima della tua conferma.',
       '/seller/orders/' || p_order_id);
  END IF;
  IF v_rider_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, title, body, link) VALUES
      (v_rider_id, '❌ Ordine annullato',
       'L''ordine #' || substr(p_order_id::text, 1, 6) || ' e'' stato annullato.',
       '/rider');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ============================================
-- 7) Funzione: cancellazione da parte del SELLER (rifiuta)
-- ============================================
CREATE OR REPLACE FUNCTION public.seller_reject_order(p_order_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_buyer_id uuid;
  current_status text;
  is_seller boolean;
BEGIN
  SELECT
    (seller_id = auth.uid()),
    user_id,
    delivery_status
  INTO is_seller, v_buyer_id, current_status
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
  SET delivery_status = 'CANCELED',
      canceled_at = now()
  WHERE id = p_order_id;

  INSERT INTO public.notifications (user_id, title, body, link) VALUES
    (v_buyer_id, '❌ Ordine rifiutato dal negozio',
       COALESCE('Motivo: ' || p_reason, 'Il negozio non puo'' completare il tuo ordine. Niente addebiti.'),
       '/orders/' || p_order_id);

  RETURN jsonb_build_object('ok', true);
END;
$$;

NOTIFY pgrst, 'reload schema';

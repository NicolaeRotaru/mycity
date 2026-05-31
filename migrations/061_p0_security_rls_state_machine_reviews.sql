-- 061: P0 security hardening — escalation privilegi, macchina a stati ordini, integrità recensioni
--
-- Chiude i blocker go-live dell'audit senior (Amazon/eBay/Glovo):
--   - P0-1: escalation privilegi su profiles (self-update senza WITH CHECK → auto-seller/auto-admin)
--   - P0-2: seller auto-segna DELIVERED e incassa l'escrow senza spedire
--   - P0-3: rider salta l'OTP / si auto-assegna ordini altrui / sporca i GPS di consegne non sue
--   - P0-6: recensioni falsificabili (nessun gate acquisto, verified_purchase deciso dal client)
--   - (P2) generate_verification_code: search_path mutabile (genera gli OTP)
--
-- Strategia (come i senior): trigger BEFORE UPDATE che validano transizioni di stato e
-- congelano le colonne sensibili, con esenzione esplicita per:
--   (a) admin               → public.is_admin()
--   (b) backend server      → JWT role = 'service_role' (route con getAdminSupabase)
--   (c) RPC fidate          → flag di sessione mycity.allow_order_write/allow_profile_write
-- Tutte le transizioni "ad alto valore" (PICKED_UP, DELIVERED, CANCELED) restano possibili
-- SOLO tramite le RPC SECURITY DEFINER esistenti (che impostano il flag).
--
-- Idempotente.

-- =========================================================
-- 1) PROFILES — blocca auto-escalation (P0-1)
--    Consente la candidatura seller (role='seller', is_approved=false, approval_status='pending')
--    ma vieta auto-approvazione, auto-promozione admin e modifica dei campi Stripe/KYC/billing.
-- =========================================================
CREATE OR REPLACE FUNCTION public.enforce_profile_update_rules()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_priv boolean := public.is_admin()
    OR coalesce((SELECT auth.jwt() ->> 'role'), '') = 'service_role'
    OR coalesce(current_setting('mycity.allow_profile_write', true), '') = '1';
BEGIN
  IF is_priv THEN
    RETURN NEW;
  END IF;

  -- Vietato auto-promuoversi admin
  IF NEW.role = 'admin' AND OLD.role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'profiles: cambio ruolo riservato allo staff' USING ERRCODE = '42501';
  END IF;

  -- Vietato auto-approvarsi (false/null -> true)
  IF NEW.is_approved = true AND OLD.is_approved IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'profiles: approvazione riservata allo staff' USING ERRCODE = '42501';
  END IF;

  -- approval_status: l'utente può solo richiedere ('pending'); approvazioni/rifiuti/sospensioni allo staff
  IF NEW.approval_status IS DISTINCT FROM OLD.approval_status
     AND coalesce(NEW.approval_status, '') NOT IN ('pending', '') THEN
    RAISE EXCEPTION 'profiles: stato approvazione riservato allo staff' USING ERRCODE = '42501';
  END IF;

  -- Campi gestiti SOLO da staff/server (audit approvazione + Stripe Connect + KYC + subscription)
  IF NEW.approved_by              IS DISTINCT FROM OLD.approved_by
  OR NEW.approved_at              IS DISTINCT FROM OLD.approved_at
  OR NEW.stripe_account_id        IS DISTINCT FROM OLD.stripe_account_id
  OR NEW.stripe_charges_enabled   IS DISTINCT FROM OLD.stripe_charges_enabled
  OR NEW.stripe_payouts_enabled   IS DISTINCT FROM OLD.stripe_payouts_enabled
  OR NEW.stripe_details_submitted IS DISTINCT FROM OLD.stripe_details_submitted
  OR NEW.kyc_provider_status      IS DISTINCT FROM OLD.kyc_provider_status
  OR NEW.kyc_provider_check_id    IS DISTINCT FROM OLD.kyc_provider_check_id
  OR NEW.kyc_provider_checked_at  IS DISTINCT FROM OLD.kyc_provider_checked_at
  OR NEW.subscription_status      IS DISTINCT FROM OLD.subscription_status
  THEN
    RAISE EXCEPTION 'profiles: campo riservato non modificabile' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_profile_update ON public.profiles;
CREATE TRIGGER trg_enforce_profile_update
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_profile_update_rules();

-- =========================================================
-- 2) ORDERS — macchina a stati + freeze colonne sensibili (P0-2, P0-3)
-- =========================================================
CREATE OR REPLACE FUNCTION public.enforce_order_update_rules()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := (SELECT auth.uid());
  is_priv boolean := public.is_admin()
    OR coalesce((SELECT auth.jwt() ->> 'role'), '') = 'service_role'
    OR coalesce(current_setting('mycity.allow_order_write', true), '') = '1';
BEGIN
  IF is_priv THEN
    RETURN NEW;
  END IF;

  -- Freeze: denaro / pagamento / payout / contanti / prova di consegna / fattura / proprietà / PII consegna
  IF NEW.total_price            IS DISTINCT FROM OLD.total_price
  OR NEW.payment_status         IS DISTINCT FROM OLD.payment_status
  OR NEW.payment_method         IS DISTINCT FROM OLD.payment_method
  OR NEW.shipping_cost          IS DISTINCT FROM OLD.shipping_cost
  OR NEW.discount_amount        IS DISTINCT FROM OLD.discount_amount
  OR NEW.coupon_code            IS DISTINCT FROM OLD.coupon_code
  OR NEW.application_fee_cents  IS DISTINCT FROM OLD.application_fee_cents
  OR NEW.seller_payout_cents    IS DISTINCT FROM OLD.seller_payout_cents
  OR NEW.payout_status          IS DISTINCT FROM OLD.payout_status
  OR NEW.payout_at              IS DISTINCT FROM OLD.payout_at
  OR NEW.rider_payout_status    IS DISTINCT FROM OLD.rider_payout_status
  OR NEW.rider_transfer_id      IS DISTINCT FROM OLD.rider_transfer_id
  OR NEW.rider_payout_at        IS DISTINCT FROM OLD.rider_payout_at
  OR NEW.cash_collected_cents   IS DISTINCT FROM OLD.cash_collected_cents
  OR NEW.cash_photo_url         IS DISTINCT FROM OLD.cash_photo_url
  OR NEW.cash_signature_url     IS DISTINCT FROM OLD.cash_signature_url
  OR NEW.cash_confirmed_at      IS DISTINCT FROM OLD.cash_confirmed_at
  OR NEW.cash_collected_by      IS DISTINCT FROM OLD.cash_collected_by
  OR NEW.delivery_photo_url     IS DISTINCT FROM OLD.delivery_photo_url
  OR NEW.delivery_signature_url IS DISTINCT FROM OLD.delivery_signature_url
  OR NEW.stripe_session_id      IS DISTINCT FROM OLD.stripe_session_id
  OR NEW.stripe_payment_intent  IS DISTINCT FROM OLD.stripe_payment_intent
  OR NEW.stripe_charge_id       IS DISTINCT FROM OLD.stripe_charge_id
  OR NEW.stripe_transfer_id     IS DISTINCT FROM OLD.stripe_transfer_id
  OR NEW.stripe_refund_id       IS DISTINCT FROM OLD.stripe_refund_id
  OR NEW.stripe_transfer_group  IS DISTINCT FROM OLD.stripe_transfer_group
  OR NEW.stripe_reversal_id     IS DISTINCT FROM OLD.stripe_reversal_id
  OR NEW.dispute_status         IS DISTINCT FROM OLD.dispute_status
  OR NEW.disputed_at            IS DISTINCT FROM OLD.disputed_at
  OR NEW.invoice_number         IS DISTINCT FROM OLD.invoice_number
  OR NEW.delivered_at           IS DISTINCT FROM OLD.delivered_at
  OR NEW.picked_up_at           IS DISTINCT FROM OLD.picked_up_at
  OR NEW.user_id                IS DISTINCT FROM OLD.user_id
  OR NEW.seller_id              IS DISTINCT FROM OLD.seller_id
  OR NEW.delivery_full_name     IS DISTINCT FROM OLD.delivery_full_name
  OR NEW.delivery_phone         IS DISTINCT FROM OLD.delivery_phone
  OR NEW.delivery_address       IS DISTINCT FROM OLD.delivery_address
  THEN
    RAISE EXCEPTION 'orders: modifica di un campo protetto non consentita' USING ERRCODE = '42501';
  END IF;

  -- rider_id modificabile SOLO come "claim" (NULL -> se stesso) contestuale a READY -> ASSIGNED
  IF NEW.rider_id IS DISTINCT FROM OLD.rider_id THEN
    IF NOT (OLD.rider_id IS NULL AND NEW.rider_id = uid
            AND OLD.delivery_status = 'READY' AND NEW.delivery_status = 'ASSIGNED') THEN
      RAISE EXCEPTION 'orders: riassegnazione rider non consentita' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Transizioni di stato consentite ai client; tutte le altre passano SOLO da RPC fidate (flag)
  IF NEW.delivery_status IS DISTINCT FROM OLD.delivery_status THEN
    IF OLD.seller_id = uid AND (
         (OLD.delivery_status = 'NEW'      AND NEW.delivery_status = 'ACCEPTED')
      OR (OLD.delivery_status = 'ACCEPTED' AND NEW.delivery_status = 'READY')
    ) THEN
      NULL; -- seller: accetta / pronto
    ELSIF OLD.delivery_status = 'READY' AND OLD.rider_id IS NULL
          AND NEW.delivery_status = 'ASSIGNED' AND NEW.rider_id = uid THEN
      NULL; -- rider: claim atomico
    ELSIF OLD.rider_id = uid
          AND OLD.delivery_status = 'PICKED_UP' AND NEW.delivery_status = 'OUT_FOR_DELIVERY' THEN
      NULL; -- rider: in consegna
    ELSE
      RAISE EXCEPTION 'orders: transizione % -> % non consentita',
        OLD.delivery_status, NEW.delivery_status USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_order_update ON public.orders;
CREATE TRIGGER trg_enforce_order_update
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.enforce_order_update_rules();

-- ---------------------------------------------------------
-- 2b) RPC di transizione "ad alto valore": impostano il flag così possono
--     eseguire PICKED_UP / DELIVERED / CANCELED bypassando il trigger.
--     (logica invariata rispetto alle definizioni live, aggiunto solo set_config)
-- ---------------------------------------------------------
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
  PERFORM set_config('mycity.allow_order_write', '1', true);

  SELECT
    (rider_id = auth.uid() AND delivery_status = 'ASSIGNED'),
    seller_id, user_id, delivery_status
  INTO is_assigned, v_seller_id, v_buyer_id, current_status
  FROM public.orders WHERE id = p_order_id;

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

  UPDATE public.order_pickup_codes SET verified_at = now() WHERE order_id = p_order_id;
  UPDATE public.orders SET delivery_status = 'PICKED_UP', picked_up_at = now() WHERE id = p_order_id;

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
  PERFORM set_config('mycity.allow_order_write', '1', true);

  SELECT
    (rider_id = auth.uid() AND delivery_status IN ('PICKED_UP', 'OUT_FOR_DELIVERY')),
    seller_id, user_id, delivery_status
  INTO can_verify, v_seller_id, v_buyer_id, current_status
  FROM public.orders WHERE id = p_order_id;

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
  UPDATE public.orders SET delivery_status = 'DELIVERED', delivered_at = now() WHERE id = p_order_id;

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
  PERFORM set_config('mycity.allow_order_write', '1', true);

  SELECT (user_id = auth.uid()), seller_id, rider_id, delivery_status
  INTO is_owner, v_seller_id, v_rider_id, current_status
  FROM public.orders WHERE id = p_order_id;

  IF v_seller_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'ORDER_NOT_FOUND');
  END IF;
  IF NOT is_owner THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NOT_OWNER');
  END IF;
  IF current_status NOT IN ('NEW') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'TOO_LATE', 'status', current_status);
  END IF;

  UPDATE public.orders SET delivery_status = 'CANCELED', canceled_at = now() WHERE id = p_order_id;

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

CREATE OR REPLACE FUNCTION public.seller_reject_order(p_order_id uuid, p_reason text DEFAULT NULL::text)
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
  PERFORM set_config('mycity.allow_order_write', '1', true);

  SELECT (seller_id = auth.uid()), user_id, delivery_status
  INTO is_seller, v_buyer_id, current_status
  FROM public.orders WHERE id = p_order_id;

  IF v_buyer_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'ORDER_NOT_FOUND');
  END IF;
  IF NOT is_seller THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NOT_SELLER');
  END IF;
  IF current_status NOT IN ('NEW', 'ACCEPTED') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'TOO_LATE', 'status', current_status);
  END IF;

  UPDATE public.orders SET delivery_status = 'CANCELED', canceled_at = now() WHERE id = p_order_id;

  INSERT INTO public.notifications (user_id, title, body, link) VALUES
    (v_buyer_id, '❌ Ordine rifiutato dal negozio',
       COALESCE('Motivo: ' || p_reason, 'Il negozio non puo'' completare il tuo ordine. Niente addebiti.'),
       '/orders/' || p_order_id);

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- =========================================================
-- 3) REVIEWS — gate acquisto + unicità + verified_purchase server-side (P0-6)
-- =========================================================
DROP POLICY IF EXISTS "Authenticated users can write reviews" ON public.reviews;
DROP POLICY IF EXISTS "Verified buyers can write reviews" ON public.reviews;
CREATE POLICY "Verified buyers can write reviews"
  ON public.reviews FOR INSERT
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND EXISTS (
      SELECT 1
      FROM public.order_items oi
      JOIN public.orders o ON o.id = oi.order_id
      WHERE oi.product_id = reviews.product_id
        AND o.user_id = (SELECT auth.uid())
        AND o.delivery_status = 'DELIVERED'
    )
  );

-- 1 sola recensione per (prodotto, utente)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reviews_product_user_unique') THEN
    ALTER TABLE public.reviews
      ADD CONSTRAINT reviews_product_user_unique UNIQUE (product_id, user_id);
  END IF;
END $$;

-- verified_purchase deciso SOLO server-side (la policy garantisce già l'acquisto consegnato)
CREATE OR REPLACE FUNCTION public.reviews_set_verified()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.verified_purchase := true;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reviews_set_verified ON public.reviews;
CREATE TRIGGER trg_reviews_set_verified
  BEFORE INSERT ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public.reviews_set_verified();

-- =========================================================
-- 4) generate_verification_code: search_path immutabile (P2, adiacente alla sicurezza OTP)
-- =========================================================
CREATE OR REPLACE FUNCTION public.generate_verification_code()
RETURNS text
LANGUAGE sql
SET search_path = ''
AS $$
  SELECT lpad(floor(random() * 1000000)::text, 6, '0');
$$;

NOTIFY pgrst, 'reload schema';

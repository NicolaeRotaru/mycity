-- =============================================================================
-- 185 — Il carrello conta i "primi ordini" come la cassa
-- =============================================================================
-- IL DIFETTO. Il codice di benvenuto (first_order_only) si controlla in due
-- posti: la cassa (lib/coupons.ts → validateCoupon, lato server) e il carrello
-- (lib/coupons.ts → validateCouponFromBrowser → questa funzione check_coupon).
-- La cassa era già stata corretta: contano solo gli ordini andati a buon fine,
-- fuori gli ANNULLATI e quelli col pagamento FALLITO. La 114 invece contava
-- ancora TUTTI gli ordini del cliente.
--
-- Esempio: Maria fa il primo ordine con BENVENUTO10, il negozio lo annulla e il
-- sito le scrive «il codice torna utilizzabile». Martedì lo riprova: il carrello
-- (questa funzione) risponde «Codice valido solo al primo ordine» e lo sconto
-- non compare, anche se la cassa lo accetterebbe.
--
-- LA CORREZIONE. Stessa regola della cassa, parola per parola:
--   delivery_status <> 'CANCELED' AND payment_status <> 'FAILED'
-- (è ciò che fa .neq() di PostgREST). Un ordine consegnato e poi rimborsato
-- resta dentro: il primo acquisto c'è stato.
--
-- Tutto il resto della funzione è identico alla 114 (firma, permessi, risposte).
--
-- RITORNO INDIETRO (down): rieseguire il blocco CREATE OR REPLACE FUNCTION
-- public.check_coupon della migrazione 114 (righe 315-379), che rimette il
-- conteggio di tutti gli ordini. Nessun dato viene toccato: è solo la funzione.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.check_coupon(p_code text, p_subtotal numeric)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c public.coupons;
  uid uuid := (SELECT auth.uid());
  ordini int;
  sconto numeric := 0;
  spedizione_gratis boolean := false;
BEGIN
  IF uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'Devi accedere per usare un codice');
  END IF;

  SELECT * INTO c FROM public.coupons
   WHERE code = upper(trim(p_code)) AND active = true;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'Codice non valido');
  END IF;

  IF c.expires_at IS NOT NULL AND c.expires_at < now() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'Codice scaduto');
  END IF;
  IF c.max_uses IS NOT NULL AND c.uses_count >= c.max_uses THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'Codice esaurito');
  END IF;
  IF p_subtotal < c.min_subtotal THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'Spesa minima richiesta: €' || to_char(c.min_subtotal, 'FM999999990.00'));
  END IF;
  IF c.first_order_only THEN
    -- Stessa regola di validateCoupon (lib/coupons.ts): gli ordini annullati e
    -- quelli col pagamento fallito non sono un "primo ordine".
    SELECT count(*) INTO ordini FROM public.orders
     WHERE user_id = uid
       AND delivery_status <> 'CANCELED'
       AND payment_status <> 'FAILED';
    IF ordini > 0 THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'Codice valido solo al primo ordine');
    END IF;
  END IF;

  IF c.type = 'PERCENT' THEN
    sconto := round(p_subtotal * (c.value / 100.0), 2);
  ELSIF c.type = 'FIXED' THEN
    sconto := least(p_subtotal, c.value);
  ELSIF c.type = 'FREE_SHIPPING' THEN
    spedizione_gratis := true;
  END IF;

  -- Solo i campi che servono a mostrare il codice applicato: niente max_uses,
  -- uses_count, min_subtotal degli altri codici, niente elenco.
  RETURN jsonb_build_object(
    'ok', true,
    'discount', sconto,
    'freeShipping', spedizione_gratis,
    'coupon', jsonb_build_object(
      'id', c.id, 'code', c.code, 'type', c.type, 'value', c.value,
      'description', c.description
    )
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.check_coupon(text, numeric) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.check_coupon(text, numeric) TO authenticated, service_role;

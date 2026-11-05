-- =============================================================================
-- 230 — Un ordine con lo stato vuoto conta come ordine (codice di benvenuto)
-- =============================================================================
-- IL DIFETTO. La 185 contava gli ordini con
--   delivery_status <> 'CANCELED' AND payment_status <> 'FAILED'.
-- In SQL `NULL <> 'CANCELED'` non è vero: un ordine con uno dei due stati
-- vuoti (le colonne lo permettono, migrazione 001) non contava, e il codice
-- «solo primo ordine» passava a chi aveva già comprato.
--
-- LA CORREZIONE. IS DISTINCT FROM al posto di <>, nella funzione check_coupon
-- (carrello) e nella cassa (lib/coupons.ts, filtro .or con is.null): le due
-- copie restano uguali, la prova
-- tests/unit/il-carrello-conta-il-primo-ordine-come-la-cassa.test.ts lo
-- controlla. Tutto il resto della funzione è identico alla 185.
--
-- RITORNO INDIETRO (down): rieseguire il blocco CREATE OR REPLACE FUNCTION
-- della migrazione 185. Nessun dato viene toccato: è solo la funzione.
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
    -- quelli col pagamento fallito non sono un "primo ordine". Uno stato vuoto
    -- (NULL) invece conta: con <> la riga spariva dal conteggio.
    SELECT count(*) INTO ordini FROM public.orders
     WHERE user_id = uid
       AND delivery_status IS DISTINCT FROM 'CANCELED'
       AND payment_status IS DISTINCT FROM 'FAILED';
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

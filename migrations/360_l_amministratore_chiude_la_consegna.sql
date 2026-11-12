-- 360_l_amministratore_chiude_la_consegna.sql
--
-- 12/11/2026 (R12-001) — SE IL FATTORINO SPARISCE, L'AMMINISTRATORE CHIUDE LA
-- CONSEGNA.
--
-- Il caso. Martedi' sera il fattorino consegna pane per 25 euro pagato in
-- contanti, intasca i soldi e smette di lavorare con MyCity senza riaprire
-- l'app. Dalla migrazione 163 un ordine in contanti non diventa DELIVERED senza
-- l'incasso dichiarato, e il codice alla porta lo puo' dettare solo il
-- fattorino (`verify_delivery_code` guarda `rider_id = auth.uid()`). La rotta di
-- soccorso dell'amministratore (`/api/admin/cod-incasso-dichiarato`) accettava
-- solo ordini gia' DELIVERED: un vicolo cieco. L'ordine restava «in consegna»
-- per sempre, la rimessa della sera non lo vedeva e il negozio non veniva
-- pagato. L'unico pulsante era «Annulla», che rimette a scaffale merce gia'
-- consegnata.
--
-- Adesso la strada e' in due passi, tutti e due dell'amministratore e tutti e
-- due nel registro:
--   1. registra i contanti dichiarati a voce dal fattorino (la rotta di
--      soccorso ora accetta anche un ordine in strada — lib/cassa/registra-incasso.ts);
--   2. chiude la consegna con questa funzione, con un motivo scritto.
-- La regola della 163 resta intera: un ordine in contanti si chiude solo dopo
-- l'incasso. Una consegna con la carta si chiude senza incasso.
--
-- Chi puo': solo un amministratore (`is_admin()`), mai il fattorino ne' il
-- negozio. Da dove: solo da PICKED_UP o OUT_FOR_DELIVERY, cioe' merce partita.
-- Non si aggira niente: la stessa chiave che usa `verify_delivery_code`
-- (`mycity.allow_order_write`) si alza solo dopo tutti i controlli, e il
-- guardiano degli ordini resta in piedi per tutti gli altri.
--
-- Non si applica da sola: la applica Nicola.

CREATE OR REPLACE FUNCTION public.admin_chiudi_consegna(p_order_id uuid, p_motivo text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_stato text; v_metodo text; v_incasso timestamptz; v_rider uuid;
  v_seller uuid; v_buyer uuid; v_motivo text := btrim(coalesce(p_motivo, ''));
BEGIN
  IF NOT public.is_admin() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NOT_ADMIN');
  END IF;
  IF length(v_motivo) < 10 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'MOTIVO_MANCANTE');
  END IF;

  SELECT delivery_status, payment_method, cash_confirmed_at, rider_id, seller_id, user_id
    INTO v_stato, v_metodo, v_incasso, v_rider, v_seller, v_buyer
    FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF v_seller IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'ORDER_NOT_FOUND');
  END IF;
  IF v_stato IS DISTINCT FROM 'PICKED_UP' AND v_stato IS DISTINCT FROM 'OUT_FOR_DELIVERY' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'WRONG_STATUS', 'status', v_stato);
  END IF;
  IF v_rider IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'SENZA_FATTORINO');
  END IF;
  -- La regola della 163: contanti, prima l'incasso e poi la consegna.
  IF v_metodo = 'cod' AND v_incasso IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'CASH_NOT_CONFIRMED');
  END IF;

  PERFORM set_config('mycity.allow_order_write', '1', true);
  UPDATE public.orders
     SET delivery_status = 'DELIVERED', delivered_at = now(),
         rider_lat = NULL, rider_lng = NULL, rider_position_updated_at = NULL
   WHERE id = p_order_id;

  INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, metadata)
  VALUES ((SELECT auth.uid()), 'order.delivery_closed_by_admin', 'orders', p_order_id::text,
          jsonb_build_object('motivo', v_motivo, 'stato_prima', v_stato, 'fattorino', v_rider,
                             'metodo', v_metodo));

  BEGIN
    INSERT INTO public.notifications (user_id, title, body, link, category) VALUES
      (v_buyer,  'Ordine consegnato', 'Il tuo ordine risulta consegnato.', '/orders/' || p_order_id, 'order'),
      (v_seller, 'Ordine consegnato', 'L''ordine è stato chiuso come consegnato dall''amministrazione.', '/seller/orders/' || p_order_id, 'order');
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  RETURN jsonb_build_object('ok', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_chiudi_consegna(uuid, text) FROM public;
REVOKE EXECUTE ON FUNCTION public.admin_chiudi_consegna(uuid, text) FROM anon;
-- Il controllo vero e' is_admin() dentro: la sessione dell'amministratore la
-- chiama dalla rotta, cosi' auth.uid() e' lui e il registro lo nomina.
GRANT EXECUTE ON FUNCTION public.admin_chiudi_consegna(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.admin_chiudi_consegna(uuid, text) IS
  'R12-001 (12/11/2026): l amministratore chiude una consegna rimasta in strada (fattorino sparito). Contanti: solo dopo l incasso (163). Motivo obbligatorio, riga in audit_logs.';

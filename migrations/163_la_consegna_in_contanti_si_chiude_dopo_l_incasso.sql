-- 163_la_consegna_in_contanti_si_chiude_dopo_l_incasso.sql
--
-- 15/10/2026 (R33) — UNA CONSEGNA IN CONTANTI NON SI CHIUDE PRIMA DI AVER
-- DICHIARATO I CONTANTI.
--
-- Negli ordini pagati alla consegna le conferme sono due e separate: il codice
-- che il cliente detta alla porta, e l'incasso che il fattorino dichiara
-- (`/api/rider/cash-confirm`, che scrive `cash_confirmed_at`). Il database
-- accettava la prima senza la seconda: `verify_delivery_code` guardava solo
-- «sei il fattorino di questo ordine e l'ordine e' in strada», poi scriveva
-- DELIVERED.
--
-- Cosa succedeva davvero. Martedi' sera, ordine da 25 euro in contanti. Il
-- pulsante verde «Conferma consegna» e' in fondo allo schermo; il riquadro
-- dell'incasso sta piu' in alto, sotto la mappa. Il fattorino detta il codice,
-- legge «Consegna confermata!» e dopo un secondo e' di nuovo in bacheca. La
-- sera la rimessa (`confirm_cod_remittance`) salta proprio quell'ordine,
-- perche' l'incasso non risulta: il negozio non viene pagato. Dopo sette giorni
-- la regola di lettura nasconde l'ordine al fattorino e non resta nessuna
-- strada se non mettere le mani sul database.
--
-- Da qui: per un ordine in contanti, finche' l'incasso non e' dichiarato, il
-- codice giusto risponde CASH_NOT_CONFIRMED e l'ordine resta in strada. Il
-- controllo sta PRIMA della lettura del codice, cosi' non consuma un tentativo:
-- chi ha il codice giusto in mano non deve trovarsi bloccato per quindici
-- minuti per colpa di un passo saltato.
--
-- La pagina del fattorino chiede gia' l'incasso prima del codice; questa e' la
-- rete sotto, per un'altra pagina, un'app vecchia nella cache del telefono, o
-- una chiamata fatta a mano. Il codice del sito non dipende da questa
-- migrazione: se in produzione non c'e' ancora, la pagina fa da sola lo stesso
-- ordine dei passi.
--
-- Il corpo e' quello PIU' RECENTE della funzione (migrazione 127, nessuna
-- migrazione successiva l'ha ridefinita): restano identici il caso «codice mai
-- emesso» separato, il FOR UPDATE sui tentativi, il blocco a cinque, e la
-- chiave che scavalca la guardia alzata solo dopo tutti i rifiuti.
--
-- CREATE OR REPLACE conserva proprietario e permessi di esecuzione gia'
-- concessi o revocati (151): si puo' rieseguire.

CREATE OR REPLACE FUNCTION public.verify_delivery_code(p_order_id uuid, p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE stored_code text; current_status text; can_verify boolean; v_seller_id uuid; v_buyer_id uuid;
        v_attempts int; v_locked timestamptz;
        v_metodo text; v_incasso timestamptz;
BEGIN
  IF p_code IS NULL OR btrim(p_code) = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'WRONG_CODE');
  END IF;

  SELECT (rider_id = (SELECT auth.uid()) AND delivery_status IN ('PICKED_UP', 'OUT_FOR_DELIVERY')),
         seller_id, user_id, delivery_status, payment_method, cash_confirmed_at
  INTO can_verify, v_seller_id, v_buyer_id, current_status, v_metodo, v_incasso
  FROM public.orders WHERE id = p_order_id;
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

  -- Nessuna riga: il codice non è mai stato emesso. Non è un tentativo
  -- sbagliato da contare — non c'è niente da contare, e fingere il contrario
  -- lasciava provare all'infinito.
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

  UPDATE public.order_delivery_codes SET verified_at = now(), attempts = 0, locked_until = NULL
    WHERE order_id = p_order_id;
  UPDATE public.orders
    SET delivery_status = 'DELIVERED', delivered_at = now(),
        rider_lat = NULL, rider_lng = NULL, rider_position_updated_at = NULL
    WHERE id = p_order_id;
  BEGIN
    INSERT INTO public.notifications (user_id, title, body, link, category) VALUES
      (v_buyer_id,  '✅ Ordine consegnato', 'Il tuo ordine è stato consegnato. Buon appetito!', '/orders/' || p_order_id, 'order'),
      (v_seller_id, '✅ Ordine consegnato', 'L''ordine è stato consegnato al cliente.', '/seller/orders/' || p_order_id, 'order');
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  RETURN jsonb_build_object('ok', true);
END;
$function$;

COMMENT ON FUNCTION public.verify_delivery_code(uuid, text) IS
  'Il fattorino chiude la consegna col codice del cliente. Per gli ordini in '
  'contanti serve prima l incasso dichiarato (cash_confirmed_at): senza, '
  'risponde CASH_NOT_CONFIRMED e l ordine resta in strada (163, R33).';

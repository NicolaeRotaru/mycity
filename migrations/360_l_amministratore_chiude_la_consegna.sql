-- 360_l_amministratore_chiude_la_consegna.sql
--
-- 12/11/2026 (R12-001) — SE IL FATTORINO SPARISCE, L'AMMINISTRATORE CHIUDE LA
-- CONSEGNA IN CONTANTI, CON L'INCASSO, IN UN PASSO SOLO.
--
-- Il caso. Martedi' sera il fattorino consegna pane per 25 euro pagato in
-- contanti, intasca i soldi e smette di lavorare con MyCity senza riaprire
-- l'app. Dalla migrazione 163 un ordine in contanti non diventa DELIVERED senza
-- l'incasso dichiarato, e il codice alla porta lo puo' dettare solo il
-- fattorino. La rotta di soccorso dell'amministratore
-- (`/api/admin/cod-incasso-dichiarato`) accetta solo ordini gia' DELIVERED: un
-- vicolo cieco. L'ordine restava «in consegna» per sempre, la rimessa della
-- sera non lo vedeva e il negozio non veniva pagato.
--
-- PERCHE' UN PASSO SOLO (collaudo del 12/11). Aprire all'amministratore la
-- registrazione dell'incasso su un ordine in strada, separata dalla chiusura,
-- lasciava un ordine PAGATO e ancora in strada: non si chiude (serve il codice)
-- e non si annulla (CONTANTI_INCASSATI, lib/ordini/annulla.ts). E in PICKED_UP
-- i contanti non si dichiarano per scelta (5/11, lib/rider/incasso-alla-consegna.ts):
-- «Cliente assente» si regge su quella regola. Qui incasso e consegna si
-- scrivono insieme, nella stessa UPDATE: o tutti e due, o niente.
--
-- Le regole:
--   · solo un amministratore (`is_admin()`), con un motivo scritto;
--   · solo un ordine IN CONTANTI, consegnato a casa (non ritiro in negozio),
--     con un fattorino, in OUT_FOR_DELIVERY (in PICKED_UP la merce non e'
--     arrivata alla porta: si annulla, e l'annullo funziona);
--   · se il fattorino aveva gia' dichiarato i contanti si chiude e basta;
--     altrimenti si scrive l'incasso dichiarato a voce, con le stesse regole di
--     lib/cassa/registra-incasso.ts (`campiDellIncasso`, `importoFuoriMisura`):
--     compenso del fattorino trattenuto dal contante, il resto dovuto per
--     bonifico, PAID solo su un ordine ancora da pagare.
-- La giornata di cassa (cod_reconciliations) la riallinea chi chiama, con
-- aggiornaQuadratura sulla data di delivered_at, come la rotta del fattorino.
-- Non si applica da sola: la applica Nicola.

CREATE OR REPLACE FUNCTION public.admin_chiudi_consegna(
  p_order_id uuid,
  p_incassato_cents integer,
  p_motivo text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  o record;
  v_motivo text := btrim(coalesce(p_motivo, ''));
  v_dovuto int; v_contante int; v_trattenuto int; v_residuo int; v_da_rimettere int;
  v_incassava boolean;
BEGIN
  IF NOT public.is_admin() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NOT_ADMIN');
  END IF;
  IF length(v_motivo) < 10 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'MOTIVO_MANCANTE');
  END IF;

  SELECT id, delivery_status, payment_method, payment_status, cash_confirmed_at, rider_id,
         seller_id, user_id, total_price, rider_fee_cents, shipping_cost, pickup_in_store
    INTO o
    FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF o.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'ORDER_NOT_FOUND');
  END IF;
  IF o.payment_method IS DISTINCT FROM 'cod' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NON_IN_CONTANTI');
  END IF;
  IF coalesce(o.pickup_in_store, false) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'RITIRO_IN_NEGOZIO');
  END IF;
  IF o.delivery_status IS DISTINCT FROM 'OUT_FOR_DELIVERY' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'WRONG_STATUS', 'status', o.delivery_status);
  END IF;
  IF o.rider_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'SENZA_FATTORINO');
  END IF;

  v_incassava := o.cash_confirmed_at IS NULL;
  IF v_incassava THEN
    IF p_incassato_cents IS NULL OR p_incassato_cents < 0 THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'INCASSO_MANCANTE');
    END IF;
    -- compensoTrattenutoCents / compensoDalContante / contanteDaRimettereCents (lib/shipping.ts)
    v_dovuto := CASE WHEN o.rider_fee_cents IS NOT NULL THEN greatest(0, o.rider_fee_cents)
                     ELSE greatest(0, round(coalesce(o.shipping_cost, 0) * 100)::int) END;
    v_contante := greatest(0, round(coalesce(o.total_price, 0) * 100)::int);
    v_trattenuto := least(v_dovuto, v_contante);
    v_residuo := v_dovuto - v_trattenuto;
    v_da_rimettere := v_contante - v_trattenuto;
    -- importoFuoriMisura: sopra il doppio piu' 10 euro e' un errore di battitura.
    IF p_incassato_cents > v_da_rimettere * 2 + 1000 THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'IMPORTO_FUORI_MISURA');
    END IF;
  END IF;

  -- La chiave si alza solo qui, dopo tutti i rifiuti, e si riabbassa subito.
  PERFORM set_config('mycity.allow_order_write', '1', true);
  UPDATE public.orders
     SET delivery_status = 'DELIVERED', delivered_at = now(),
         rider_lat = NULL, rider_lng = NULL, rider_position_updated_at = NULL,
         cash_collected_cents = CASE WHEN v_incassava THEN p_incassato_cents ELSE cash_collected_cents END,
         cash_confirmed_at    = CASE WHEN v_incassava THEN now() ELSE cash_confirmed_at END,
         cash_collected_by    = CASE WHEN v_incassava THEN (SELECT auth.uid()) ELSE cash_collected_by END,
         payment_status       = CASE WHEN v_incassava AND (payment_status IS NULL OR payment_status = 'PENDING')
                                     THEN 'PAID' ELSE payment_status END,
         rider_payout_status  = CASE WHEN NOT v_incassava THEN rider_payout_status
                                     WHEN v_residuo > 0 THEN 'HELD'
                                     WHEN v_trattenuto > 0 THEN 'CASH_WITHHELD'
                                     ELSE NULL END,
         rider_payout_at      = CASE WHEN NOT v_incassava THEN rider_payout_at
                                     WHEN v_residuo = 0 AND v_trattenuto > 0 THEN now()
                                     ELSE NULL END
   WHERE id = p_order_id;
  -- Il codice da dettare alla porta non serve piu': il cliente non lo vede piu' come «da dare».
  UPDATE public.order_delivery_codes SET verified_at = now(), locked_until = NULL
   WHERE order_id = p_order_id AND verified_at IS NULL;
  PERFORM set_config('mycity.allow_order_write', '', true);

  INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, metadata)
  VALUES ((SELECT auth.uid()), 'order.delivery_closed_by_admin', 'orders', p_order_id::text,
          jsonb_build_object('motivo', v_motivo, 'fattorino', o.rider_id,
                             'incasso_registrato_qui', v_incassava,
                             'incassato_cents', CASE WHEN v_incassava THEN p_incassato_cents END,
                             'atteso_cents', CASE WHEN v_incassava THEN v_da_rimettere END));

  BEGIN
    INSERT INTO public.notifications (user_id, title, body, link, category) VALUES
      (o.user_id,   'Ordine consegnato', 'Il tuo ordine risulta consegnato.', '/orders/' || p_order_id, 'order'),
      (o.seller_id, 'Ordine consegnato', 'L''ordine è stato chiuso come consegnato dall''amministrazione.', '/seller/orders/' || p_order_id, 'order');
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  RETURN jsonb_build_object('ok', true, 'incasso_registrato', v_incassava);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_chiudi_consegna(uuid, integer, text) FROM public;
REVOKE EXECUTE ON FUNCTION public.admin_chiudi_consegna(uuid, integer, text) FROM anon;
-- Il controllo vero e' is_admin() dentro: la sessione dell'amministratore la
-- chiama dalla rotta, cosi' auth.uid() e' lui e il registro lo nomina.
GRANT EXECUTE ON FUNCTION public.admin_chiudi_consegna(uuid, integer, text) TO authenticated;

COMMENT ON FUNCTION public.admin_chiudi_consegna(uuid, integer, text) IS
  'R12-001 (12/11/2026): l amministratore chiude una consegna in contanti rimasta in strada (fattorino sparito), registrando nello stesso passo l incasso dichiarato a voce. Solo cod a domicilio, solo OUT_FOR_DELIVERY, motivo obbligatorio, riga in audit_logs.';

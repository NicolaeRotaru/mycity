-- 999r_lo_stesso_carrello_va_a_un_fattorino_solo.sql
--
-- 28/11/2026 (onda 2, R11-006) — GLI ORDINI PRONTI DELLO STESSO CARRELLO VANNO A UN FATTORINO SOLO.
--
-- Il caso. Maria compra pane dal forno e frutta dal fruttivendolo in un solo carrello: due ordini,
-- e la consegna si divide fra i due negozi (il primo paga il viaggio, il secondo 1 euro: lib/ordini/
-- prezzi.ts). Sulla bacheca sono due righe separate: Gino prende il pane, Luca prende la frutta, e
-- Luca fa un viaggio intero fino a casa di Maria per 1 euro, mentre Gino passa dalla stessa porta.
--
-- Ora, quando un fattorino prende un ordine, nella stessa transazione prende anche gli altri ordini
-- PRONTI e liberi dello stesso carrello (carta: stesso stripe_transfer_group o stessa sessione di
-- pagamento; contanti: stessa riga di cod_checkout_attempts.order_ids o stessa cod_cart_key
-- (999p, da applicare prima); sempre lo stesso cliente), con
-- le stesse condizioni della bacheca (ordini_disponibili_rider): READY, senza fattorino, non ritiro
-- in negozio. Le righe del giro si bloccano prima della presa, in ordine di id, così due fattorini
-- che toccano nello stesso istante due ordini dello stesso carrello non si fermano a vicenda: il
-- secondo aspetta e trova le righe già prese (GIA_PRESO, come oggi).
--
-- Gli ordini del carrello ANCORA IN PREPARAZIONE (ACCEPTED) restano liberi sulla bacheca, come oggi.
-- DA DECIDERE (Nicola, R11-006): se vanno tenuti per il primo fattorino. Se sì, si cambia solo il
-- filtro `delivery_status = 'READY'` della seconda UPDATE (e serve una regola su quando liberarli).
--
-- La risposta è quella della 661 più `insieme`: gli id degli altri ordini presi con lui.
-- Idempotente (CREATE OR REPLACE). Non si applica da sola: la applica Nicola.
-- Provata sul Postgres locale ricostruito dalle migrazioni:
-- tests/sql/rls/onda2-e2-lo-stesso-carrello-a-un-fattorino.test.sql.

CREATE OR REPLACE FUNCTION public.prendi_ordine(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid := (SELECT auth.uid());
  v_preso   uuid;
  v_giro    uuid[];
  v_insieme uuid[];
BEGIN
  -- Solo un fattorino approvato. Stessa condizione della vista della bacheca.
  IF v_uid IS NULL OR NOT public.is_rider_approvato() THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'NON_FATTORINO');
  END IF;

  -- 270 — e con patente e polizza in regola per il suo mezzo.
  IF NOT public.is_rider_in_regola() THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'DOCUMENTI_SCADUTI');
  END IF;

  PERFORM set_config('mycity.allow_order_write', '1', true);

  -- Gli ordini dello stesso carrello, sempre dello stesso cliente: con la carta lo stesso
  -- stripe_transfer_group o la stessa sessione di pagamento, in contanti la stessa riga di
  -- cod_checkout_attempts (order_ids). Sempre compreso l'ordine scelto.
  SELECT array_agg(DISTINCT g.id ORDER BY g.id)
    INTO v_giro
    FROM (
      SELECT p_order_id AS id
      UNION
      SELECT o2.id
        FROM public.orders o1
        JOIN public.orders o2
          ON o2.user_id = o1.user_id
         AND (o2.stripe_transfer_group = o1.stripe_transfer_group
              OR o2.stripe_session_id = o1.stripe_session_id)
       WHERE o1.id = p_order_id
         AND (o1.stripe_transfer_group IS NOT NULL OR o1.stripe_session_id IS NOT NULL)
      UNION
      SELECT o2.id
        FROM public.orders o1
        JOIN public.cod_checkout_attempts a
          ON a.user_id = o1.user_id
         AND a.order_ids @> jsonb_build_array(jsonb_build_object('id', o1.id::text))
        CROSS JOIN LATERAL jsonb_array_elements(a.order_ids) AS e(el)
        JOIN public.orders o2
          ON o2.id::text = e.el ->> 'id'
         AND o2.user_id = o1.user_id
       WHERE o1.id = p_order_id
      UNION
      -- Contanti senza la riga del tentativo (scritta dopo gli ordini, in una scrittura a parte):
      -- la chiave del carrello sta su ogni ordine dalla insert (999p, cod_cart_key), unica
      -- per tentativo di cassa e sempre dello stesso cliente.
      SELECT o2.id
        FROM public.orders o1
        JOIN public.orders o2
          ON o2.user_id = o1.user_id
         AND o2.cod_cart_key = o1.cod_cart_key
       WHERE o1.id = p_order_id
         AND o1.cod_cart_key IS NOT NULL
    ) g;

  -- Le righe del giro si bloccano prima della presa, in ordine di id: due fattorini che toccano
  -- nello stesso istante due ordini dello stesso carrello non si fermano a vicenda; il secondo
  -- aspetta e poi trova le righe già prese (GIA_PRESO, come oggi).
  PERFORM 1 FROM public.orders WHERE id = ANY (v_giro) ORDER BY id FOR UPDATE;

  -- Atomico: chi arriva secondo trova rider_id gia' pieno e non aggiorna nulla.
  UPDATE public.orders
     SET rider_id = v_uid,
         delivery_status = 'ASSIGNED'
   WHERE id = p_order_id
     AND rider_id IS NULL
     AND delivery_status = 'READY'
     -- Collaudo dell'onda 2: un ritiro in negozio non va a nessun fattorino, nemmeno a chi ne conosce l'id
     -- (il ritiro è acceso al lancio, R12-009). Prima lo escludevano solo la bacheca e gli «insieme».
     AND COALESCE(pickup_in_store, false) = false
  RETURNING id INTO v_preso;

  IF v_preso IS NULL THEN
    -- 661 — «Già preso» solo se l'ha preso davvero un altro fattorino.
    IF EXISTS (
      SELECT 1 FROM public.orders
       WHERE id = p_order_id
         AND rider_id IS NOT NULL
         AND rider_id <> v_uid
    ) THEN
      RETURN jsonb_build_object('ok', false, 'motivo', 'GIA_PRESO');
    END IF;
    RETURN jsonb_build_object('ok', false, 'motivo', 'NON_PIU_DISPONIBILE');
  END IF;

  -- Con l'ordine scelto, nella stessa transazione, gli altri ordini PRONTI e liberi dello stesso
  -- carrello: un giro solo, un fattorino solo. Quelli ancora in preparazione restano sulla bacheca.
  WITH presi AS (
    UPDATE public.orders
       SET rider_id = v_uid,
           delivery_status = 'ASSIGNED'
     WHERE id = ANY (v_giro)
       AND id <> p_order_id
       AND rider_id IS NULL
       AND delivery_status = 'READY'
       AND COALESCE(pickup_in_store, false) = false
    RETURNING id
  )
  SELECT coalesce(array_agg(id ORDER BY id), ARRAY[]::uuid[]) INTO v_insieme FROM presi;

  RETURN jsonb_build_object('ok', true, 'id', v_preso, 'insieme', to_jsonb(v_insieme));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.prendi_ordine(uuid) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.prendi_ordine(uuid) TO authenticated;

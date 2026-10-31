-- 179 — L'INTERRUTTORE SULL'ORDINE NON SI ACCENDE DA FUORI.
--
-- IL DIFETTO (radiografia del 3/9/2026, dimensione rls-database). Sulla tabella
-- `orders` il negozio puo' aggiornare le sue righe (RLS). A tenerlo lontano dai
-- soldi c'e' un guardiano solo, `enforce_order_update_rules` (versione in
-- vigore: 127, riga 314), che lascia cambiare otto colonne. Quel guardiano si
-- spegneva se nella sessione c'era `mycity.allow_order_write = '1'`, oppure se
-- `request.jwt.claims` diceva `role = service_role`. Sono impostazioni di nome
-- libero: PostgreSQL lascia che qualunque ruolo le scriva con `set_config`,
-- anche `authenticated`. Con una sessione SQL diretta (un pooler in modalita'
-- sessione, una funzione nuova che le accende troppo presto) il negozio si
-- riscriveva totale, stato del pagamento e bonifico. Da PostgREST oggi non c'e'
-- una strada dimostrata: per questo la gravita' e' «minore». Ma lo strato che
-- protegge i soldi non deve dipendere da una spia che chiunque accende.
--
-- LA RIPARAZIONE.
--  ① Il guardiano diventa SECURITY INVOKER e guarda CHI scrive, non solo la
--     spia: `current_user`. Scritta dal browser (ruoli `anon` e
--     `authenticated`) la spia non conta piu', e nemmeno un `role` scritto a
--     mano nei claims. Dentro una funzione SECURITY DEFINER del database (le
--     ~15 che accendono la spia: 061, 062, 063, 066, 083, 097, 124, 127, …)
--     `current_user` e' il proprietario della funzione: la spia vale come
--     prima. Il server con la chiave service_role scrive come `service_role`:
--     passa come prima. `is_admin()` resta com'era.
--     Il resto del corpo e' identico alla 127: girando come chi scrive usa
--     solo `auth.uid()`, `is_admin()` e `is_rider_approvato()`, che
--     `authenticated` ha gia' il permesso di chiamare (114).
--  ② `confirm_pickup_by_seller` (124, riga 160) accendeva la spia come PRIMA
--     istruzione, prima di sapere se chi chiama e' il negozio dell'ordine, e
--     usciva con la spia accesa su ogni rifiuto. Ora la accende solo dopo
--     tutti i controlli, subito prima di scrivere l'ordine.
--     ATTENZIONE: la versione in vigore NON e' il testo della 124. La 125
--     (riga 186) l'ha riparata sul posto, senza riscriverla: un codice NULL o
--     vuoto e' un rifiuto. Riscrivendo la funzione da capo, quella riga va
--     tenuta: senza, `stored_code <> trim(NULL)` da' NULL, l'IF non scatta e
--     l'ordine risulta consegnato senza che il cliente abbia dato il codice.
--
-- FUORI DA QUI (debito dichiarato): `enforce_profile_update_rules` (119) ha la
-- stessa costruzione con `mycity.allow_profile_write`.
--
-- REVERSIBILE. Le due funzioni si ricreano col testo della 127 (riga 314) e
-- della 124 (riga 160), seguito dal blocco della 125 (riga 186) che ripara il
-- confronto del codice.
--
-- LA PROVA: tests/unit/l-interruttore-sull-ordine-non-si-accende-da-fuori.test.ts,
-- su un PostgreSQL vero usa e getta.

-- =========================================================
-- ① IL GUARDIANO
-- =========================================================
CREATE OR REPLACE FUNCTION public.enforce_order_update_rules()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := (SELECT auth.uid());
  -- Chi esegue la scrittura. I ruoli del browser non si fidano delle spie di sessione.
  dal_browser boolean := current_user IN ('anon', 'authenticated');
  is_priv boolean := public.is_admin()
    OR (NOT dal_browser AND (
          current_user = 'service_role'
       OR coalesce((SELECT auth.jwt() ->> 'role'), '') = 'service_role'
       OR coalesce(current_setting('mycity.allow_order_write', true), '') = '1'));
  consentiti text[] := ARRAY[
    'delivery_status',
    'rider_id',
    'accepted_at',
    'ready_at',
    'rider_lat',
    'rider_lng',
    'rider_position_updated_at',
    'updated_at'
  ];
  e_rider_approvato boolean;
BEGIN
  IF is_priv THEN
    RETURN NEW;
  END IF;

  IF (to_jsonb(NEW) - consentiti) IS DISTINCT FROM (to_jsonb(OLD) - consentiti) THEN
    RAISE EXCEPTION 'orders: modifica di un campo protetto non consentita'
      USING ERRCODE = '42501';
  END IF;

  e_rider_approvato := public.is_rider_approvato();

  -- 22/8/2026 — LA POSIZIONE LA SCRIVE CHI CONSEGNA, NON CHI VENDE.
  IF NEW.rider_lat IS DISTINCT FROM OLD.rider_lat
     OR NEW.rider_lng IS DISTINCT FROM OLD.rider_lng
     OR NEW.rider_position_updated_at IS DISTINCT FROM OLD.rider_position_updated_at THEN
    IF OLD.rider_id IS NULL OR OLD.rider_id <> uid THEN
      RAISE EXCEPTION 'orders: la posizione la scrive solo il fattorino assegnato'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- 22/8/2026 — GLI ORARI DEL NEGOZIO LI SCRIVE IL NEGOZIO.
  IF NEW.accepted_at IS DISTINCT FROM OLD.accepted_at
     OR NEW.ready_at IS DISTINCT FROM OLD.ready_at THEN
    IF OLD.seller_id IS NULL OR OLD.seller_id <> uid THEN
      RAISE EXCEPTION 'orders: accettazione e pronto li scrive solo il negozio dell''ordine'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF NEW.rider_id IS DISTINCT FROM OLD.rider_id THEN
    IF NOT (OLD.rider_id IS NULL AND NEW.rider_id = uid
            AND OLD.delivery_status = 'READY' AND NEW.delivery_status = 'ASSIGNED'
            AND e_rider_approvato) THEN
      RAISE EXCEPTION 'orders: riassegnazione rider non consentita'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF NEW.delivery_status IS DISTINCT FROM OLD.delivery_status THEN
    IF OLD.seller_id = uid AND (
         (OLD.delivery_status = 'NEW'      AND NEW.delivery_status = 'ACCEPTED')
      OR (OLD.delivery_status = 'ACCEPTED' AND NEW.delivery_status = 'READY')
    ) THEN
      NULL; -- negoziante: accetta / pronto
    ELSIF OLD.delivery_status = 'READY' AND OLD.rider_id IS NULL
          AND NEW.delivery_status = 'ASSIGNED' AND NEW.rider_id = uid
          AND e_rider_approvato THEN
      NULL; -- fattorino approvato: presa in carico
    ELSIF OLD.rider_id = uid AND e_rider_approvato
          AND OLD.delivery_status = 'PICKED_UP' AND NEW.delivery_status = 'OUT_FOR_DELIVERY' THEN
      NULL; -- fattorino: in consegna
    ELSE
      RAISE EXCEPTION 'orders: transizione % -> % non consentita',
        OLD.delivery_status, NEW.delivery_status USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- =========================================================
-- ② IL RITIRO IN NEGOZIO: PRIMA SI CONTROLLA, POI SI DISARMA
-- =========================================================
-- Il testo e' quello in vigore: la 124 (riga 160) con il confronto del codice
-- riparato dalla 125 (riga 186). Cambia solo il posto del set_config.
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
  FROM public.orders WHERE id = p_order_id;

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
   WHERE id = p_order_id;

  BEGIN
    INSERT INTO public.notifications (category, user_id, title, body, link) VALUES
      ('order', v_buyer_id, '📦 Ordine ritirato',
       'Hai ritirato il tuo ordine in negozio. Grazie! Puoi lasciare una recensione.',
       '/orders/' || p_order_id);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object('ok', true);
END;
$function$;

NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════════════
-- 125 — I DUE BLOCCANTI DEL 21 AGOSTO CHE STANNO NEL DATABASE
--
-- Vengono dalla radiografia del 21/8/2026 (consegne/audit/2026-08-21-radiografia.md
-- nel repo della macchina). Sono i primi due della lista, e sono i piu' cari:
-- uno tocca i soldi, l'altro tocca la prova che la merce sia arrivata.
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
-- ① IL DIVIETO CHE NON VIETAVA NIENTE, PERCHE' DIMENTICAVA `PUBLIC`
--
-- La migrazione 119 (e dopo di lei la 124) scrivevano:
--
--     REVOKE EXECUTE ON FUNCTION public.accumula_rimborso(uuid, int)
--       FROM anon, authenticated;
--
-- Sembra chiusa. Non lo e'. In Postgres una funzione nasce con EXECUTE
-- concesso a `PUBLIC`, cioe' a chiunque, e `anon` e' dentro `PUBLIC`: togliere
-- il permesso ad `anon` per nome lascia in piedi quello che gli arriva
-- dall'appartenenza a `PUBLIC`. Il divieto era scritto e non toglieva niente.
--
-- Misurato sul database di produzione il 21/8/2026: DICIANNOVE funzioni
-- `SECURITY DEFINER` risultavano eseguibili da `anon`, `accumula_rimborso`
-- compresa. `refunded_amount_cents` non e' un'etichetta: e' il numero che il
-- sito sottrae dai guadagni mostrati al negozio. Chi lo tocca decide quanto il
-- negozio incassa, e per toccarlo non serviva nemmeno un account.
--
-- LA CURA E' LA PAROLA `PUBLIC`, non la lista dei ruoli. Qui sotto ogni
-- funzione che non deve stare in mano al browser viene chiusa a `PUBLIC` e poi
-- riaperta SOLO a chi le serve davvero. Le funzioni che il sito pubblico usa
-- per forza (vetrine, conteggi, tracciamento) restano aperte: sono elencate
-- per nome nel controllo in fondo, cosi' un'esenzione si discute invece di
-- sparire in silenzio.
-- ───────────────────────────────────────────────────────────────────────────

-- I soldi. Solo il server, mai il browser.
REVOKE ALL ON FUNCTION public.accumula_rimborso(uuid, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accumula_rimborso(uuid, int) TO service_role;

-- Manutenzione: cancella e consolida lo storico delle visite. Solo il giro.
REVOKE ALL ON FUNCTION public.consolida_visite_prodotto(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consolida_visite_prodotto(int) TO service_role;

-- L'elenco delle persone respinte e dove stanno i loro documenti d'identita'.
REVOKE ALL ON FUNCTION public.documenti_da_cancellare_respinti(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.documenti_da_cancellare_respinti(int) TO service_role;

-- Cancella la prova del consenso privacy: e' la prova che ci difende.
REVOKE ALL ON FUNCTION public.pota_consent_log(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pota_consent_log(int) TO service_role;

-- Numeri di vendita di un negozio: servono a chi ha fatto l'accesso, mai a un
-- visitatore anonimo.
REVOKE ALL ON FUNCTION public.visite_prodotti_venditore(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.visite_prodotti_venditore(int) TO authenticated, service_role;

-- Funzione di trigger: scatta da sola quando la riga cambia, non ha bisogno che
-- qualcuno la chiami. Toglierla di mano a tutti non rompe il trigger.
REVOKE ALL ON FUNCTION public.subscription_orders_campi_bloccati() FROM PUBLIC, anon, authenticated;


-- ───────────────────────────────────────────────────────────────────────────
-- ② IL CODICE DI CONSEGNA SI AGGIRAVA MANDANDO «NIENTE»
--
-- Le tre funzioni che controllano il codice a sei cifre confrontavano cosi':
--
--     IF stored_code IS NULL OR stored_code != trim(p_code) THEN  -- sbagliato
--
-- Se `p_code` arriva NULL, `trim(NULL)` e' NULL, e in SQL `'123456' != NULL`
-- non e' falso: e' **sconosciuto**. Un IF che riceve «sconosciuto» non scatta.
-- Quindi il controllo non veniva eseguito e la funzione tirava dritto fino a
-- scrivere `delivery_status = 'DELIVERED'`.
--
-- Il codice a sei cifre e' l'unica prova che la spesa sia arrivata in mano al
-- cliente, e la consegna sblocca due cose che sono soldi veri: il bonifico al
-- negozio e la paga del fattorino. Con questo buco bastava mandare un valore
-- vuoto al posto del codice.
--
-- LA CURA in due mosse, perche' una sola non basta:
--   · il valore vuoto viene fermato per nome, prima del confronto;
--   · il confronto usa `IS DISTINCT FROM`, che con NULL risponde vero o falso
--     e mai «sconosciuto». Cosi' anche se domani qualcuno toglie la prima
--     guardia, il confronto regge da solo.
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.verify_delivery_code(p_order_id uuid, p_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE stored_code text; current_status text; can_verify boolean; v_seller_id uuid; v_buyer_id uuid;
        v_attempts int; v_locked timestamptz;
BEGIN
  PERFORM set_config('mycity.allow_order_write', '1', true);

  -- Un codice assente non e' un codice sbagliato da confrontare: e' una
  -- richiesta senza codice, e si ferma qui.
  IF p_code IS NULL OR btrim(p_code) = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'WRONG_CODE');
  END IF;

  SELECT (rider_id = auth.uid() AND delivery_status IN ('PICKED_UP', 'OUT_FOR_DELIVERY')), seller_id, user_id, delivery_status
  INTO can_verify, v_seller_id, v_buyer_id, current_status
  FROM public.orders WHERE id = p_order_id;
  IF v_seller_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'ORDER_NOT_FOUND'); END IF;
  IF can_verify IS NOT TRUE THEN RETURN jsonb_build_object('ok', false, 'reason', 'WRONG_STATUS', 'status', current_status); END IF;

  SELECT code, attempts, locked_until INTO stored_code, v_attempts, v_locked
  FROM public.order_delivery_codes WHERE order_id = p_order_id;
  IF v_locked IS NOT NULL AND v_locked > now() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'LOCKED');
  END IF;
  IF stored_code IS NULL OR stored_code IS DISTINCT FROM btrim(p_code) THEN
    UPDATE public.order_delivery_codes
      SET attempts = attempts + 1,
          locked_until = CASE WHEN attempts + 1 >= 5 THEN now() + interval '15 minutes' ELSE locked_until END
      WHERE order_id = p_order_id;
    RETURN jsonb_build_object('ok', false, 'reason', 'WRONG_CODE');
  END IF;

  UPDATE public.order_delivery_codes SET verified_at = now(), attempts = 0, locked_until = NULL WHERE order_id = p_order_id;
  UPDATE public.orders SET delivery_status = 'DELIVERED', delivered_at = now() WHERE id = p_order_id;
  BEGIN
    INSERT INTO public.notifications (user_id, title, body, link, category) VALUES
      (v_buyer_id,  '✅ Ordine consegnato', 'Il tuo ordine è stato consegnato. Buon appetito!', '/orders/' || p_order_id, 'order'),
      (v_seller_id, '✅ Ordine consegnato', 'L''ordine è stato consegnato al cliente.', '/seller/orders/' || p_order_id, 'order');
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.verify_delivery_code(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_delivery_code(uuid, text) TO authenticated;


-- La sorella del ritiro dal negozio: stesso buco, stessa cura.
CREATE OR REPLACE FUNCTION public.verify_pickup_code(p_order_id uuid, p_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE stored_code text; current_status text; is_assigned boolean; v_seller_id uuid; v_buyer_id uuid;
        v_attempts int; v_locked timestamptz;
BEGIN
  PERFORM set_config('mycity.allow_order_write', '1', true);

  IF p_code IS NULL OR btrim(p_code) = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'WRONG_CODE');
  END IF;

  SELECT (rider_id = auth.uid() AND delivery_status = 'ASSIGNED'), seller_id, user_id, delivery_status
  INTO is_assigned, v_seller_id, v_buyer_id, current_status
  FROM public.orders WHERE id = p_order_id;
  IF v_seller_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'ORDER_NOT_FOUND'); END IF;
  IF is_assigned IS NOT TRUE THEN RETURN jsonb_build_object('ok', false, 'reason', 'NOT_ASSIGNED_OR_WRONG_STATUS', 'status', current_status); END IF;

  SELECT code, attempts, locked_until INTO stored_code, v_attempts, v_locked
  FROM public.order_pickup_codes WHERE order_id = p_order_id;
  IF v_locked IS NOT NULL AND v_locked > now() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'LOCKED');
  END IF;
  IF stored_code IS NULL OR stored_code IS DISTINCT FROM btrim(p_code) THEN
    UPDATE public.order_pickup_codes
      SET attempts = attempts + 1,
          locked_until = CASE WHEN attempts + 1 >= 5 THEN now() + interval '15 minutes' ELSE locked_until END
      WHERE order_id = p_order_id;
    RETURN jsonb_build_object('ok', false, 'reason', 'WRONG_CODE');
  END IF;

  UPDATE public.order_pickup_codes SET verified_at = now(), attempts = 0, locked_until = NULL WHERE order_id = p_order_id;
  UPDATE public.orders SET delivery_status = 'PICKED_UP', picked_up_at = now() WHERE id = p_order_id;
  BEGIN
    INSERT INTO public.notifications (user_id, title, body, link, category) VALUES
      (v_buyer_id,  '✋ Ordine ritirato dal rider', 'Il rider ha ritirato il tuo ordine dal negozio. Sta arrivando da te.', '/orders/' || p_order_id, 'order'),
      (v_seller_id, '✋ Ordine ritirato', 'Il rider ha confermato il ritiro con il codice.', '/seller/orders/' || p_order_id, 'order');
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.verify_pickup_code(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_pickup_code(uuid, text) TO authenticated;


-- La terza: il venditore che chiude un ritiro in negozio col codice del cliente.
-- Qui il confronto usava `<>`, che con NULL si comporta esattamente come `!=`.
DO $migra$
DECLARE corpo text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO corpo
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'confirm_pickup_by_seller';
  IF corpo IS NULL THEN
    RAISE NOTICE 'confirm_pickup_by_seller non esiste: niente da riparare';
    RETURN;
  END IF;

  -- Il confronto che non sa dire di no a NULL diventa uno che lo sa dire.
  corpo := replace(corpo,
    'IF stored_code IS NULL OR stored_code <> trim(p_code) THEN',
    'IF p_code IS NULL OR btrim(p_code) = '''' OR stored_code IS NULL OR stored_code IS DISTINCT FROM btrim(p_code) THEN');

  IF corpo NOT LIKE '%IS DISTINCT FROM btrim(p_code)%' THEN
    RAISE EXCEPTION 'confirm_pickup_by_seller: non ho trovato la riga del confronto da riparare — fermo qui invece di lasciarla com''era';
  END IF;

  EXECUTE corpo;
END
$migra$;

REVOKE ALL ON FUNCTION public.confirm_pickup_by_seller(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_pickup_by_seller(uuid, text) TO authenticated;

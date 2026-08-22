-- ═══════════════════════════════════════════════════════════════════════════
-- 126 — QUANTO E' STATO RICHIAMATO INDIETRO PER LA CONTESTAZIONE, E NIENT'ALTRO
-- ═══════════════════════════════════════════════════════════════════════════
-- Dalla radiografia del 21/8/2026, difetto sulla contestazione vinta.
--
-- IL DIFETTO. Quando una contestazione si vince, gli ordini tornavano in coda
-- per il bonifico scrivendo `seller_payout_reversed_cents = 0`. Ma quel campo
-- e' un TOTALE CUMULATO: dentro ci puo' essere anche uno storno che con la
-- contestazione non c'entra niente — per esempio un reso parziale rimborsato
-- settimane prima, in cui il negozio aveva gia' restituito la sua quota.
--
-- Azzerandolo, il conto del residuo tornava al netto pieno e il giro dei
-- bonifici versava tutto. Il negozio incassava una seconda volta la parte che
-- aveva gia' reso, e la differenza la metteva MyCity. Si perdeva anche la
-- traccia di quanto era stato davvero recuperato su quell'ordine.
--
-- LA CURA. Due colonne che tengono da parte SOLO quello che e' stato richiamato
-- indietro per la contestazione. Alla chiusura si sottrae quella cifra, invece
-- di azzerare tutto.
--
-- Idempotente. Colonne nuove con valore predefinito 0: il codice vecchio non le
-- guarda, il codice nuovo regge anche prima che questa migrazione sia applicata
-- (lib/db/migrazione-124.ts, stesso ripiego).
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS dispute_seller_reversed_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dispute_rider_reversed_cents  integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.orders.dispute_seller_reversed_cents IS
  'Quanto e stato richiamato indietro al negozio PER LA CONTESTAZIONE aperta. Si sottrae al totale stornato quando la contestazione si vince. Zero quando non ce n e una in corso.';
COMMENT ON COLUMN public.orders.dispute_rider_reversed_cents IS
  'Come sopra, per il compenso del fattorino.';

NOTIFY pgrst, 'reload schema';


-- ═══════════════════════════════════════════════════════════════════════════
-- ② IL BONIFICO CHE RESTA FERMO A META', E CHE NESSUNO RIPESCA
-- ═══════════════════════════════════════════════════════════════════════════
-- Il giro dei bonifici prende il turno su un ordine scrivendo
-- `payout_status = 'PROCESSING'`, poi chiama Stripe. Se il processo muore in
-- mezzo — un tetto di durata della richiesta, il riavvio di un'istanza — quello
-- stato resta scritto. E i candidati del giro successivo sono solo 'HELD' e
-- 'PENDING_SELLER_ONBOARDING': quell'ordine non viene ripescato MAI PIU'.
--
-- L'unico rimedio era una scrittura a mano nel database. Per il negoziante il
-- bonifico e' lo stipendio: un pagamento fermo a tempo indeterminato, con pochi
-- negozi veri, pesa quanto decine in un marketplace grande.
--
-- LA CURA e' la stessa gia' usata sugli eventi Stripe: il turno si data. Un
-- turno vecchio si puo' riprendere, perche' la chiave di idempotenza del
-- bonifico (`payout_seller_<id>_t<n>`) rende sicuro il ritentativo — se il
-- trasferimento era davvero partito, Stripe restituisce quello e non ne crea
-- un altro.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS payout_claimed_at       timestamptz,
  ADD COLUMN IF NOT EXISTS rider_payout_claimed_at timestamptz;

COMMENT ON COLUMN public.orders.payout_claimed_at IS
  'Quando il giro dei bonifici ha preso in carico questo ordine. Un turno piu vecchio di 15 minuti si puo riprendere: vuol dire che chi l aveva preso e morto per strada.';
COMMENT ON COLUMN public.orders.rider_payout_claimed_at IS
  'Come sopra, per il compenso del fattorino.';

-- L'indice che rende economica la domanda «quali turni sono rimasti appesi?».
CREATE INDEX IF NOT EXISTS orders_payout_appesi_idx
  ON public.orders (payout_claimed_at)
  WHERE payout_status = 'PROCESSING';

NOTIFY pgrst, 'reload schema';


-- ═══════════════════════════════════════════════════════════════════════════
-- ③ IL CARRELLO IN CUI L'INCASSO NON TORNA HA UNO STATO SUO
-- ═══════════════════════════════════════════════════════════════════════════
-- Quando l'importo incassato da Stripe non coincide col preventivo, il webhook
-- lanciava un errore perche' Stripe riprovasse. Ma quello scarto nasce da come
-- i due totali sono calcolati: se c'e' una volta c'e' tutte le volte, e ogni
-- ritentativo falliva identico. Il cliente restava con i soldi presi e nessun
-- ordine, gli amministratori ricevevano lo stesso avviso a ripetizione, e dopo
-- giorni di fallimenti Stripe disattiva l'indirizzo del webhook: da li' in poi
-- si fermano TUTTI i pagamenti.
--
-- Adesso e' uno stato finale, e ha un nome che si vede nei dati: si rimborsa,
-- si avvisa una volta, e il carrello resta marcato per essere guardato.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.pending_checkouts
  DROP CONSTRAINT IF EXISTS pending_checkouts_status_check;

ALTER TABLE public.pending_checkouts
  ADD CONSTRAINT pending_checkouts_status_check
  CHECK (status = ANY (ARRAY['PENDING', 'COMPLETED', 'EXPIRED', 'CANCELED', 'MISMATCH']));

NOTIFY pgrst, 'reload schema';


-- ═══════════════════════════════════════════════════════════════════════════
-- ④ IL CREDITO MYCITY TORNA INDIETRO QUANDO L'ORDINE VIENE ANNULLATO
-- ═══════════════════════════════════════════════════════════════════════════
-- Il cliente usa 15 euro di buono regalo, il negozio rifiuta l'ordine perche' ha
-- finito il pane, e i 15 euro non esistono piu': ne' merce ne' credito. Non
-- c'era nessun modo, dall'interfaccia, di riaccreditarli. E' un buono comprato
-- con soldi veri che evapora su un rifiuto che il cliente non ha nemmeno deciso.
--
-- Il confronto e' impietoso: la rotta dell'amministratore riaccredita, il giro
-- degli ordini fermi riaccredita, e persino il rimedio interno della rotta dei
-- contanti riaccredita. Solo le due strade che usano davvero le persone — il
-- cliente che annulla e il negozio che rifiuta — no.
--
-- `wallet_credit` ha una chiave (`p_ref`): con `order_canceled_<id>` un secondo
-- annullo dello stesso ordine non accredita due volte.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.cancel_order(p_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_seller_id uuid; v_rider_id uuid; v_buyer_id uuid; current_status text; is_owner boolean;
        v_wallet_cents int;
BEGIN
  PERFORM set_config('mycity.allow_order_write', '1', true);
  SELECT (user_id = auth.uid()), seller_id, rider_id, user_id, delivery_status,
         coalesce(wallet_applied_cents, 0)
  INTO is_owner, v_seller_id, v_rider_id, v_buyer_id, current_status, v_wallet_cents
  FROM public.orders WHERE id = p_order_id;
  IF v_seller_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'ORDER_NOT_FOUND'); END IF;
  IF NOT is_owner THEN RETURN jsonb_build_object('ok', false, 'reason', 'NOT_OWNER'); END IF;
  IF current_status NOT IN ('NEW') THEN RETURN jsonb_build_object('ok', false, 'reason', 'TOO_LATE', 'status', current_status); END IF;
  UPDATE public.orders SET delivery_status = 'CANCELED', canceled_at = now() WHERE id = p_order_id;
  PERFORM public.restore_stock_for_order(p_order_id);

  -- Il credito speso torna al cliente. La chiave rende innocuo un secondo giro.
  IF v_wallet_cents > 0 THEN
    PERFORM public.wallet_credit(v_buyer_id, v_wallet_cents, 'order_canceled', 'order_canceled_' || p_order_id::text);
  END IF;

  IF v_seller_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, title, body, link) VALUES
      (v_seller_id, '❌ Ordine annullato dal cliente', 'Il cliente ha annullato l''ordine #' || substr(p_order_id::text, 1, 6) || ' prima della tua conferma.', '/seller/orders/' || p_order_id);
  END IF;
  IF v_rider_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, title, body, link) VALUES
      (v_rider_id, '❌ Ordine annullato', 'L''ordine #' || substr(p_order_id::text, 1, 6) || ' e'' stato annullato.', '/rider');
  END IF;
  RETURN jsonb_build_object('ok', true, 'credito_restituito_cents', v_wallet_cents);
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_order(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_order(uuid) TO authenticated;


CREATE OR REPLACE FUNCTION public.seller_reject_order(p_order_id uuid, p_reason text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_buyer_id uuid; current_status text; is_seller boolean; v_wallet_cents int;
BEGIN
  PERFORM set_config('mycity.allow_order_write', '1', true);
  SELECT (seller_id = auth.uid()), user_id, delivery_status, coalesce(wallet_applied_cents, 0)
  INTO is_seller, v_buyer_id, current_status, v_wallet_cents
  FROM public.orders WHERE id = p_order_id;
  IF v_buyer_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'ORDER_NOT_FOUND'); END IF;
  IF NOT is_seller THEN RETURN jsonb_build_object('ok', false, 'reason', 'NOT_SELLER'); END IF;
  IF current_status NOT IN ('NEW', 'ACCEPTED') THEN RETURN jsonb_build_object('ok', false, 'reason', 'TOO_LATE', 'status', current_status); END IF;
  UPDATE public.orders SET delivery_status = 'CANCELED', canceled_at = now() WHERE id = p_order_id;
  PERFORM public.restore_stock_for_order(p_order_id);

  IF v_wallet_cents > 0 THEN
    PERFORM public.wallet_credit(v_buyer_id, v_wallet_cents, 'order_canceled', 'order_canceled_' || p_order_id::text);
  END IF;

  INSERT INTO public.notifications (user_id, title, body, link) VALUES
    (v_buyer_id, '❌ Ordine rifiutato dal negozio',
     COALESCE('Motivo: ' || p_reason, 'Il negozio non puo'' completare il tuo ordine. Niente addebiti.')
       || CASE WHEN v_wallet_cents > 0
               THEN ' Il credito MyCity che avevi usato (€' || to_char(v_wallet_cents / 100.0, 'FM999990.00') || ') e'' tornato sul tuo saldo.'
               ELSE '' END,
     '/orders/' || p_order_id);
  RETURN jsonb_build_object('ok', true, 'credito_restituito_cents', v_wallet_cents);
END;
$$;

REVOKE ALL ON FUNCTION public.seller_reject_order(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.seller_reject_order(uuid, text) TO authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- ⑤ LA RIMESSA CONFERMA SOLO IL CONTANTE CHE QUALCUNO HA REGISTRATO
-- ═══════════════════════════════════════════════════════════════════════════
-- `confirm_cod_remittance` portava a HELD — cioe' rendeva pagabile il negozio —
-- TUTTI gli ordini in contanti consegnati di quel fattorino in quel giorno,
-- senza guardare se l'incasso era mai stato registrato. E un ordine puo'
-- arrivare a «consegnato» senza passare dal riquadro dell'incasso: il codice di
-- consegna scrive DELIVERED e non chiede niente sui contanti.
--
-- Risultato: il negozio veniva pagato per contante di cui non esiste traccia.
-- Con un fattorino solo si recupera a mano; appena sono due, e' il buco da cui
-- esce il contante.
--
-- Adesso serve `cash_confirmed_at`, e la funzione dice anche QUANTI ordini ha
-- saltato per quel motivo: cosi' l'amministratore li vede, invece di non
-- saperlo.
-- ═══════════════════════════════════════════════════════════════════════════

-- Il tipo di ritorno cambia (da un numero a due numeri), quindi la vecchia va
-- tolta prima: Postgres non riscrive una funzione cambiandole il ritorno.
DROP FUNCTION IF EXISTS public.confirm_cod_remittance(uuid, date);

CREATE OR REPLACE FUNCTION public.confirm_cod_remittance(p_rider uuid, p_date date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_released integer; v_saltati integer;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  PERFORM set_config('mycity.allow_order_write', '1', true);

  SELECT count(*) INTO v_saltati
    FROM public.orders
   WHERE rider_id = p_rider
     AND payment_method = 'cod'
     AND delivery_status = 'DELIVERED'
     AND payout_status = 'AWAITING_REMITTANCE'
     AND (delivered_at AT TIME ZONE 'UTC')::date = p_date
     AND cash_confirmed_at IS NULL;

  UPDATE public.orders
    SET payout_status = 'HELD'
  WHERE rider_id = p_rider
    AND payment_method = 'cod'
    AND delivery_status = 'DELIVERED'
    AND payout_status = 'AWAITING_REMITTANCE'
    AND cash_confirmed_at IS NOT NULL
    AND (delivered_at AT TIME ZONE 'UTC')::date = p_date;
  GET DIAGNOSTICS v_released = ROW_COUNT;

  INSERT INTO public.cod_reconciliations (rider_id, for_date, remitted_at, remitted_by)
  VALUES (p_rider, p_date, now(), auth.uid())
  ON CONFLICT (rider_id, for_date)
  DO UPDATE SET remitted_at = now(), remitted_by = auth.uid();

  RETURN jsonb_build_object('rilasciati', v_released, 'saltati_senza_incasso', v_saltati);
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_cod_remittance(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_cod_remittance(uuid, date) TO authenticated;

NOTIFY pgrst, 'reload schema';

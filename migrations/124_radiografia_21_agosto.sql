-- =============================================================================
-- 124 — Radiografia del 18 agosto, difetti rimasti aperti (lotto del 21 agosto)
-- =============================================================================
-- Cinque riparazioni che vivono nel database:
--
--   ① #55  gross_total_cents sull'ordine: il rimborso deve dividere per il
--          lordo di vendita, non per quello che resta dopo il credito MyCity.
--   ② #154 il ritiro in negozio arriva a «consegnato»: RPC per il venditore
--          + stato terminale del contante incassato in cassa.
--   ③ #154 la bacheca del fattorino non mostra i ritiri in negozio.
--   ④ #66  payment_attempts: l'esito di ogni tentativo di pagamento, col
--          motivo del rifiuto, invece di una riga di log buttata via.
--   ⑤ #167 indici per gli avvisi sui pagamenti fermi.
--
-- Idempotente: si puo' riapplicare.
-- =============================================================================

-- =========================================================
-- ① IL LORDO DI VENDITA RESTA SCRITTO SULL'ORDINE  (#55)
-- =========================================================
-- `total_price` e' la cassa attesa dal fattorino: il totale DOPO lo scomputo
-- del credito MyCity. `seller_payout_cents` invece nasce sul lordo, prima del
-- credito. Il rimborso usava il primo come denominatore e il secondo come
-- numeratore: su un ordine da 50 euro pagato con 20 euro di credito, un
-- rimborso da 10 euro recuperava dal negozio 10×netto/30 invece di 10×netto/50,
-- cioe' il 67% in piu' del dovuto. E un ordine coperto per intero dal credito
-- aveva total_price = 0, quindi non era rimborsabile affatto.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS gross_total_cents integer;

COMMENT ON COLUMN public.orders.gross_total_cents IS
  'Lordo di vendita in centesimi PRIMA dello scomputo del credito MyCity. total_price e'' invece la cassa attesa (netto, dopo il credito). Il rimborso divide per questo, perche'' e'' la base su cui e'' calcolato seller_payout_cents.';

-- Ordini gia' esistenti: il lordo e' il totale piu' il credito applicato.
UPDATE public.orders
   SET gross_total_cents = round(total_price * 100)::int + coalesce(wallet_applied_cents, 0)
 WHERE gross_total_cents IS NULL;

-- Campo protetto per costruzione: `enforce_order_update_rules` (migrazione 114)
-- confronta la riga intera meno una lista di campi consentiti, quindi ogni
-- colonna nuova nasce gia' chiusa al browser. Nessun elenco da aggiornare.

-- Il tetto del rimborso sale al lordo. `accumula_rimborso` lo teneva a
-- `total_price`, cioe' al netto: un ordine coperto per intero dal credito
-- MyCity aveva total_price = 0, quindi non era rimborsabile in nessun modo —
-- ne' dal reso ne' dal reclamo. Il cliente aveva pagato davvero, con una gift
-- card: il rimborso deve poter tornare sul suo credito.
CREATE OR REPLACE FUNCTION public.accumula_rimborso(p_order_id uuid, p_delta int)
RETURNS TABLE (totale_rimborsato int, totale_ordine int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  tot int;
  nuovo int;
BEGIN
  IF p_delta <= 0 THEN
    RAISE EXCEPTION 'accumula_rimborso: importo non valido' USING ERRCODE = '22023';
  END IF;

  SELECT coalesce(o.gross_total_cents, round(coalesce(o.total_price, 0) * 100)::int) INTO tot
    FROM public.orders o WHERE o.id = p_order_id FOR UPDATE;

  IF tot IS NULL THEN
    RAISE EXCEPTION 'accumula_rimborso: ordine inesistente' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.orders o
     SET refunded_amount_cents = coalesce(o.refunded_amount_cents, 0) + p_delta
   WHERE o.id = p_order_id
     AND coalesce(o.refunded_amount_cents, 0) + p_delta <= tot
  RETURNING o.refunded_amount_cents INTO nuovo;

  IF nuovo IS NULL THEN
    -- Nessuna riga rivendicata: si sfonderebbe il lordo dell'ordine.
    RETURN;
  END IF;

  RETURN QUERY SELECT nuovo, tot;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.accumula_rimborso(uuid, int) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accumula_rimborso(uuid, int) TO service_role;

-- Un contatore di tentativi per i bonifici, perche' la chiave di idempotenza
-- non blocchi il secondo pagamento (#158).
--
-- Le chiavi erano `payout_seller_<id>` e `payout_rider_<id>`: sempre le
-- stesse. Va benissimo per il caso che dovevano coprire — un ritentativo dopo
-- un errore non deve creare un secondo bonifico. Ma quando una contestazione
-- si apre e poi si VINCE, il bonifico e' stato stornato e va rifatto: con la
-- stessa chiave Stripe restituisce il vecchio bonifico, quello gia' stornato,
-- e nessuno riceve niente. Il contatore sale a ogni rimessa in coda: il
-- ritentativo dopo un errore trova la stessa chiave, il pagamento dopo una
-- vittoria ne trova una nuova.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS payout_tentativo integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rider_payout_tentativo integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.orders.payout_tentativo IS
  'Quante volte il pagamento al venditore e'' stato rimesso in coda dopo uno storno. Entra nella chiave di idempotenza Stripe: senza, un bonifico gia'' stornato verrebbe restituito al posto di uno nuovo.';
COMMENT ON COLUMN public.orders.rider_payout_tentativo IS
  'Come payout_tentativo, per il compenso del fattorino.';

-- =========================================================
-- ② IL RITIRO IN NEGOZIO ARRIVA A «CONSEGNATO»  (#154)
-- =========================================================
-- Il ritiro in negozio si poteva scegliere in cassa, ma nel codice non c'era
-- nessuna strada per chiuderlo: l'unico modo di portare un ordine a DELIVERED
-- e' il bottone del fattorino, e su un ritiro il fattorino non c'e'. L'ordine
-- restava in READY per sempre, il negoziante consegnava la merce a mano e non
-- veniva pagato, il cliente vedeva «in corso» all'infinito e non poteva
-- recensire.
--
-- Serviva un nuovo stato del pagamento: sul ritiro in CONTANTI il negozio
-- incassa in cassa il 100%, quindi non c'e' nessun bonifico da fargli — semmai
-- e' lui a dovere a MyCity la commissione. Pagargli il 90% sarebbe pagarlo due
-- volte. 'CASH_IN_STORE' e' lo stato terminale che lo dice.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_payout_status_check') THEN
    ALTER TABLE public.orders DROP CONSTRAINT orders_payout_status_check;
  END IF;
END$$;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_payout_status_check
  CHECK (payout_status IN (
    'PENDING',
    'HELD',
    'PROCESSING',
    'TRANSFERRED',
    'REFUNDED',
    'FAILED',
    'PENDING_SELLER_ONBOARDING',
    'REVERSED',
    'AWAITING_REMITTANCE',
    'CASH_IN_STORE'
  ));

COMMENT ON COLUMN public.orders.payout_status IS
  'Stato del pagamento al venditore. CASH_IN_STORE = ritiro in negozio pagato in contanti: il negozio ha gia'' incassato tutto alla cassa, non gli spetta nessun bonifico e resta da regolare la commissione MyCity.';

CREATE OR REPLACE FUNCTION public.confirm_pickup_by_seller(p_order_id uuid, p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
  PERFORM set_config('mycity.allow_order_write', '1', true);

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

  -- Stesso codice che il cliente mostrerebbe al fattorino: sul ritiro lo mostra
  -- al negoziante. Stesso conto dei tentativi e stesso blocco a cinque errori.
  SELECT code, attempts, locked_until INTO stored_code, v_attempts, v_locked
  FROM public.order_delivery_codes WHERE order_id = p_order_id;

  IF v_locked IS NOT NULL AND v_locked > now() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'LOCKED');
  END IF;
  IF stored_code IS NULL OR stored_code <> trim(p_code) THEN
    UPDATE public.order_delivery_codes
       SET attempts = attempts + 1,
           locked_until = CASE WHEN attempts + 1 >= 5 THEN now() + interval '15 minutes' ELSE locked_until END
     WHERE order_id = p_order_id;
    RETURN jsonb_build_object('ok', false, 'reason', 'WRONG_CODE');
  END IF;

  UPDATE public.order_delivery_codes
     SET verified_at = now(), attempts = 0, locked_until = NULL
   WHERE order_id = p_order_id;

  UPDATE public.orders
     SET delivery_status = 'DELIVERED',
         delivered_at = now(),
         payment_status = CASE WHEN v_method = 'cod' THEN 'PAID' ELSE payment_status END,
         -- Contanti alla cassa del negozio: nessun bonifico da fare, e l'ordine
         -- esce dal giro delle rimesse del fattorino, dove non e' mai stato.
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
$$;

COMMENT ON FUNCTION public.confirm_pickup_by_seller(uuid, text) IS
  'Il venditore chiude un ordine con ritiro in negozio: verifica il codice del cliente e porta l''ordine a DELIVERED. Senza questa strada un ritiro restava in READY per sempre e il negoziante non veniva mai pagato.';

REVOKE ALL ON FUNCTION public.confirm_pickup_by_seller(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_pickup_by_seller(uuid, text) TO authenticated;

-- =========================================================
-- ②bis GLI STATI DEL COMPENSO DEL FATTORINO CHE IL CODICE USA GIA'  (#155, #156)
-- =========================================================
-- Il vincolo non prevedeva 'HELD', ma il codice ce lo scrive: e' lo stato in
-- cui `releaseRiderPayout` riporta un bonifico fallito, ed e' il primo della
-- lista dei ritentabili. L'UPDATE veniva rifiutato dal database e l'errore
-- finiva in un log: il compenso restava in 'PROCESSING', che nessun giro del
-- cron ripesca. Un bonifico fallito una volta non ripartiva mai piu'.
--
-- 'CASH_WITHHELD' e' lo stato dei contanti: sul contrassegno il fattorino
-- trattiene il suo compenso dall'incasso e rimette il resto. Non c'e' nessun
-- bonifico da fare, ed e' diverso da «non ancora pagato».
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_rider_payout_status_check;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_rider_payout_status_check
  CHECK (rider_payout_status IS NULL OR rider_payout_status IN (
    'HELD', 'PENDING_RIDER_ONBOARDING', 'PROCESSING', 'TRANSFERRED', 'FAILED',
    'REVERSED', 'AWAITING_REMITTANCE', 'CASH_WITHHELD'
  ));

COMMENT ON COLUMN public.orders.rider_payout_status IS
  'Stato del compenso al fattorino. CASH_WITHHELD = consegna in contanti: il compenso se l''e'' tenuto dall''incasso e ha rimesso il resto, nessun bonifico da fare.';

-- =========================================================
-- ③ LA BACHECA DEL FATTORINO NON MOSTRA I RITIRI  (#154)
-- =========================================================
-- Un ordine che il cliente sta andando a ritirare compariva fra quelli liberi:
-- un fattorino poteva prenderlo in carico e portarsi via la merce.
DROP VIEW IF EXISTS public.ordini_disponibili_rider;

CREATE VIEW public.ordini_disponibili_rider AS
  SELECT o.id,
         o.seller_id,
         s.store_name,
         s.store_address,
         s.store_lat,
         s.store_lng,
         o.delivery_city,
         o.delivery_zip,
         o.delivery_status,
         o.payment_method,
         o.total_price,
         o.shipping_cost,
         o.rider_fee_cents,
         o.delivery_slot,
         o.created_at,
         (SELECT count(*) FROM public.order_items oi WHERE oi.order_id = o.id) AS articoli
    FROM public.orders o
    LEFT JOIN public.profiles s ON s.id = o.seller_id
   WHERE o.rider_id IS NULL
     AND o.delivery_status IN ('ACCEPTED', 'READY')
     AND coalesce(o.pickup_in_store, false) = false
     AND public.is_rider_approvato();

COMMENT ON VIEW public.ordini_disponibili_rider IS
  'Ordini liberi visibili ai fattorini approvati: negozio, zona, importo, fascia oraria. Nessun recapito del cliente. I ritiri in negozio non compaiono: quella merce la ritira il cliente.';

REVOKE ALL    ON public.ordini_disponibili_rider FROM anon, authenticated;
GRANT  SELECT ON public.ordini_disponibili_rider TO authenticated;

-- =========================================================
-- ④ L'ESITO DI OGNI TENTATIVO DI PAGAMENTO  (#66)
-- =========================================================
-- Del rifiuto di una carta restava un `logger.warn` e nient'altro: la domanda
-- base del prodotto pagamenti — quanti tentativi vanno a buon fine e perche'
-- falliscono gli altri — non aveva risposta.
CREATE TABLE IF NOT EXISTS public.payment_attempts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_intent_id   text NOT NULL,
  pending_checkout_id uuid REFERENCES public.pending_checkouts(id) ON DELETE SET NULL,
  user_id             uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  amount_cents        integer,
  status              text NOT NULL CHECK (status IN ('succeeded', 'failed')),
  decline_code        text,
  error_code          text,
  network_status      text,
  three_d_secure      text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- Un evento Stripe puo' arrivare piu' volte: la stessa coppia intent+esito
-- non deve gonfiare il tasso di autorizzazione.
CREATE UNIQUE INDEX IF NOT EXISTS payment_attempts_intent_status_uidx
  ON public.payment_attempts (payment_intent_id, status);

CREATE INDEX IF NOT EXISTS payment_attempts_created_idx
  ON public.payment_attempts (created_at DESC);

COMMENT ON TABLE public.payment_attempts IS
  'Esito di ogni tentativo di pagamento con carta, col motivo del rifiuto. Sopra ci si costruisce il tasso di autorizzazione (riusciti / riusciti+falliti) e la distribuzione dei motivi.';

ALTER TABLE public.payment_attempts ENABLE ROW LEVEL SECURITY;

-- Nessuno legge da PostgREST: la scrive il webhook col service role, la
-- leggono gli admin dalle query dirette. Una tabella di misura non ha motivo
-- di essere esposta al browser.
DROP POLICY IF EXISTS "Admin reads payment attempts" ON public.payment_attempts;
CREATE POLICY "Admin reads payment attempts"
  ON public.payment_attempts FOR SELECT
  TO authenticated
  USING (public.is_admin());

REVOKE ALL ON public.payment_attempts FROM anon;

-- =========================================================
-- ⑤ GLI AVVISI SUI PAGAMENTI FERMI TROVANO LE RIGHE  (#167)
-- =========================================================
CREATE INDEX IF NOT EXISTS orders_payout_status_created_idx
  ON public.orders (payout_status, created_at DESC);

CREATE INDEX IF NOT EXISTS orders_delivery_status_created_idx
  ON public.orders (delivery_status, created_at DESC);

NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- 215 — I DIFETTI MINORI DEL DATABASE (sessione S04, 5/11/2026)
-- =============================================================================
-- Una sola migrazione che raccoglie le correzioni piccole al database trovate
-- dall'audit. Ogni pezzo è scritto per poter girare due volte senza danni
-- (CREATE OR REPLACE, IF EXISTS, controlli sul catalogo prima di ogni vincolo).
-- Va applicata DOPO tutte le precedenti (191 e 195 comprese). La applica Nicola.
--
-- Cosa cambia, in parole:
--   ①  Le notifiche: la persona può solo segnarle come lette, non riscriverne il
--       testo, la data o l'id (scheda 2063).
--   ②  Gli avvisi ai fattorini: solo a chi è in servizio («Online») e mai per un
--       ordine da ritirare in negozio; chi ha appena lasciato un ordine non se lo
--       vede riproporre (169, 473, 145).
--   ③  Un indice doppio su order_items (678).
--   ④  Chi ha approvato un negozio o scelto il negozio del mese si può cancellare
--       (95). Un reclamo resta anche se chi l'ha aperto cancella l'account (1704).
--   ⑤  Il negozio risponde alle domande sui prodotti, ma non ne riscrive il
--       testo, l'autore o il prodotto (454).
--   ⑥  La notifica di benvenuto che prometteva «€5 di sconto» (2580).
--   ⑦  I carrelli da recuperare escono in ordine, dal più vecchio (2412).
--   ⑧  Il «Ci manchi» dei 60 giorni non parte a chi ha ordinato (544).
--   ⑨  Il giro notturno non cancella chi ha ancora ordini aperti o soldi in
--       sospeso (756).
--   ⑩  Un reclamo nasce solo «aperto», senza esito né rimborso scritti dal
--       cliente (1660).
--   ⑪  Il rilascio di una consegna avvisa il negozio e non rimanda «ordine
--       pronto» al cliente (145).
--   ⑫  La scorta totale di un prodotto con le taglie non si perde con due acquisti
--       nello stesso istante (203).
--   ⑬  Paletti sui numeri di soldi rimasti scoperti (696).
--   ⑭  Il premio invito: solo al primo ordine consegnato dell'invitato, e un
--       guasto lascia traccia nel registro (2573, 2574).
--   ⑮  vuole_notifica la chiama solo il server (686).
--   ⑯  «Ricavi totali» dell'admin toglie i rimborsi e conta il credito usato (654).
--   ⑰  Gli abbonamenti non si scrivono dal browser (697).
--   ⑱  Il riassunto notturno delle visite somma invece di sovrascrivere, e conta
--       il giorno di Piacenza (258).
--   ⑲  «Ordine pronto» nella campanella dice «un rider passa a prenderlo» come
--       l'email, e chi ritira in negozio legge di passare in negozio (2090).
--   ⑳  «Prezzo abbassato» solo per prodotti in vendita di negozi approvati, una
--       volta al giorno, col prezzo scritto all'italiana (181).
--   ㉑  L'anteprima della chat non tiene l'ultimo messaggio di chi l'ha cancellato
--       (94).
--   ㉒  Il fattorino non legge per sempre gli ordini annullati (103).
--   ㉓  «Venduti» del negozio non conta gli ordini rimborsati (786).
--   ㉔  Le scritture rimaste aperte al ruolo anonimo (699).
--   ㉕  La coda delle email «pronto/consegnato» lascia traccia di un guasto (758).
--   ㉖  Il magazzino dei documenti d'identità ha un tetto di peso e di tipi (1622).
--   ㉗  Il nome scritto alla registrazione arriva nel profilo (183).
--   ㉘  Il fattorino non chiude come consegnato un ordine annullato nello stesso
--       istante (201).
--   ㉙  La serie dei giorni dei punti conta il giorno di Piacenza (260).
--   ㉚  Benvenuto e guida del secondo giorno partono solo dopo la conferma
--       dell'email (542).
--   ㉛  Gli avvisi della campanella scritti dal database senza faccine (982).
--
-- RITORNO INDIETRO DELLE 157, 158 E 159 (scheda 1623) — scritto qui perché le
-- migrazioni esistenti non si toccano:
--   157  prima della 157 il secchio `cod-proof` aveva file_size_limit = NULL e
--        allowed_mime_types = NULL. Per tornare indietro:
--          UPDATE storage.buckets SET file_size_limit = NULL, allowed_mime_types = NULL
--           WHERE id = 'cod-proof';
--   158, 159  sono solo aggiunte: si torna indietro togliendo quello che hanno
--        creato (DROP delle regole/funzioni nominate nel loro file).
--
-- RITORNO INDIETRO DI QUESTA: ogni sezione dice cosa c'era prima; le funzioni
-- tornano alla versione della migrazione citata rilanciandone il CREATE.
-- =============================================================================

-- ① NOTIFICHE: SI SEGNANO COME LETTE, NON SI RISCRIVONO (2063) -----------------
-- Prima: UPDATE su tutte le colonne per chi possiede la riga (regola della 008,
-- permesso ridato dalla 145). L'unico aggiornamento legittimo dal browser è
-- is_read (app/notifications/page.tsx). Il server usa la chiave di servizio.
REVOKE UPDATE ON public.notifications FROM anon, authenticated;
GRANT UPDATE (is_read) ON public.notifications TO authenticated;

-- ② AVVISI AI FATTORINI (169, 473, 145) ----------------------------------------
-- Prima (019): a tutti i fattorini approvati, online o no, anche per gli ordini
-- da ritirare in negozio che la bacheca nasconde. Le zone preferite restano
-- fuori: un ordine non porta una zona con cui confrontarle.
CREATE OR REPLACE FUNCTION public.notify_riders_on_accepted()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.delivery_status = 'ACCEPTED'
     AND (OLD.delivery_status IS DISTINCT FROM 'ACCEPTED')
     AND NOT coalesce(NEW.pickup_in_store, false) THEN
    INSERT INTO public.notifications (user_id, title, body, link)
    SELECT p.id,
           'Ordine in preparazione',
           'Il negozio sta preparando un ordine. A breve sara'' disponibile per il ritiro.',
           '/rider'
    FROM public.profiles p
    WHERE p.role = 'rider' AND p.is_approved = true AND p.rider_is_online = true;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_riders_on_ready()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.delivery_status = 'READY'
     AND (OLD.delivery_status IS DISTINCT FROM 'READY')
     AND NOT coalesce(NEW.pickup_in_store, false) THEN
    INSERT INTO public.notifications (user_id, title, body, link)
    SELECT p.id,
           'Ordine pronto per il ritiro',
           'Un ordine e'' disponibile. Prendilo prima degli altri rider.',
           '/rider'
    FROM public.profiles p
    WHERE p.role = 'rider' AND p.is_approved = true AND p.rider_is_online = true
      -- Chi l'ha appena lasciato (rider_release_order) non se lo vede riproporre.
      AND p.id IS DISTINCT FROM OLD.rider_id;
  END IF;
  RETURN NEW;
END;
$function$;

-- ③ INDICE DOPPIO SU order_items (678) --------------------------------------------
-- idx_order_items_order_id e order_items_order_idx sono lo stesso indice su
-- order_id. Si toglie il secondo solo se il primo c'è davvero.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_order_items_order_id')
     AND EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'order_items_order_idx') THEN
    EXECUTE 'DROP INDEX public.order_items_order_idx';
  END IF;
END $$;

-- ④ CHI HA APPROVATO SI PUÒ CANCELLARE; IL RECLAMO RESTA (95, 1704) ------------
-- Prima: approved_by, selected_by, referred_by senza ON DELETE (blocca la
-- cancellazione dell'amministratore); disputes.opener_id ON DELETE CASCADE (il
-- reclamo spariva con chi l'aveva aperto, contro i 10 anni dell'informativa).
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('profiles',      'approved_by', 'profiles_approved_by_fkey'),
      ('profiles',      'referred_by', 'profiles_referred_by_fkey'),
      ('shop_of_month', 'selected_by', 'shop_of_month_selected_by_fkey'),
      ('disputes',      'opener_id',   'disputes_opener_id_fkey')
    ) AS v(tabella, colonna, vincolo)
  LOOP
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = r.tabella AND column_name = r.colonna) THEN
      IF r.tabella = 'disputes' THEN
        EXECUTE 'ALTER TABLE public.disputes ALTER COLUMN opener_id DROP NOT NULL';
      END IF;
      EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I', r.tabella, r.vincolo);
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES public.profiles(id) ON DELETE SET NULL',
        r.tabella, r.vincolo, r.colonna);
    END IF;
  END LOOP;
END $$;

-- ⑤ LA DOMANDA DEL CLIENTE NON SI RISCRIVE (454) --------------------------------
-- Prima (027): la regola qa_seller_answer apre l'UPDATE di tutte le colonne al
-- negozio del prodotto. Il guardiano lascia cambiare solo la risposta.
CREATE OR REPLACE FUNCTION public.domanda_non_si_riscrive()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF public.is_admin()
     OR coalesce((SELECT auth.jwt() ->> 'role'), '') = 'service_role'
     OR (SELECT auth.uid()) IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.question   IS DISTINCT FROM OLD.question
     OR NEW.author_id  IS DISTINCT FROM OLD.author_id
     OR NEW.product_id IS DISTINCT FROM OLD.product_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.id         IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'La domanda di un cliente non si riscrive: si può solo rispondere.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$function$;

-- Funzione di guardiano: la fa scattare il trigger, nessuno la chiama a mano.
REVOKE EXECUTE ON FUNCTION public.domanda_non_si_riscrive() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_domanda_non_si_riscrive ON public.product_questions;
CREATE TRIGGER trg_domanda_non_si_riscrive
  BEFORE UPDATE ON public.product_questions
  FOR EACH ROW EXECUTE FUNCTION public.domanda_non_si_riscrive();

-- ⑥ LA NOTIFICA DI BENVENUTO CHE PROMETTEVA €5 (2580) --------------------------
-- La 029 scriveva «Hai €5 di sconto … si applicano automaticamente al checkout».
-- La 168 ha spento il regalo per i nuovi, ma le notifiche già scritte restano.
-- Prima: titolo e testo della 029. Le si riscrive senza promessa (non si
-- cancellano: la persona le ha già viste).
UPDATE public.notifications
   SET title = 'Benvenuto su MyCity!',
       body  = 'Grazie per esserti iscritto: qui ordini dai negozi veri di Piacenza.',
       link  = '/'
 WHERE title = 'Benvenuto su MyCity! Hai €5 di sconto';

-- ⑦ I CARRELLI DA RECUPERARE, DAL PIÙ VECCHIO (2412) -----------------------------
-- Prima (029): LIMIT 100 senza ORDER BY.
CREATE OR REPLACE FUNCTION public.list_abandoned_carts_to_recover(min_hours integer DEFAULT 4)
 RETURNS TABLE(user_id uuid, email text, full_name text, cart_data jsonb, cart_total numeric, last_activity timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT
        ac.user_id,
        u.email::text,
        p.full_name,
        ac.cart_data,
        ac.cart_total,
        ac.last_activity
    FROM public.abandoned_carts ac
    JOIN auth.users u ON u.id = ac.user_id
    JOIN public.profiles p ON p.id = ac.user_id
    WHERE ac.recovery_email_sent_at IS NULL
      AND ac.recovered = false
      AND ac.last_activity < now() - (min_hours || ' hours')::interval
      AND ac.cart_total > 0
    ORDER BY ac.last_activity ASC, ac.user_id
    LIMIT 100;
$function$;

-- ⑧ IL «CI MANCHI» NON PARTE A CHI HA ORDINATO (544) ----------------------------
-- Prima (033): al primo ordine si cancellavano solo first_order_promo e
-- reengagement_14d; winback_60d partiva al sessantesimo giorno a chiunque.
-- Ora ogni ordine cancella il win-back in attesa: lo riceve solo chi in 60
-- giorni dall'iscrizione non ha mai ordinato.
CREATE OR REPLACE FUNCTION public.cancel_lifecycle_on_first_order()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_count int;
BEGIN
    SELECT COUNT(*) INTO v_count FROM public.orders WHERE user_id = NEW.user_id;
    IF v_count = 1 THEN
        -- È il primo ordine: cancella reminder
        UPDATE public.email_queue
            SET cancelled_at = now()
        WHERE user_id = NEW.user_id
          AND template IN ('first_order_promo', 'reengagement_14d')
          AND sent_at IS NULL
          AND cancelled_at IS NULL;
    END IF;
    -- Chi ordina non va «riconquistato»: il win-back si cancella a ogni ordine.
    UPDATE public.email_queue
        SET cancelled_at = now()
    WHERE user_id = NEW.user_id
      AND template = 'winback_60d'
      AND sent_at IS NULL
      AND cancelled_at IS NULL;
    RETURN NEW;
END;
$function$;

-- ⑨ IL GIRO NOTTURNO NON CANCELLA CHI HA CONTI APERTI (756) ---------------------
-- Prima (040): restituiva chiunque avesse chiesto la cancellazione da 7 giorni.
-- Ora resta fuori chi ha un ordine non chiuso (come cliente, negozio o
-- fattorino) o un ordine consegnato col bonifico al negozio non ancora partito.
-- Resta in attesa: lo si vede nel pannello e lo si chiude a mano.
CREATE OR REPLACE FUNCTION public.process_expired_deletions()
 RETURNS TABLE(user_id uuid, deleted_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    cutoff timestamptz := now() - interval '7 days';
BEGIN
    RETURN QUERY
        SELECT p.id, p.deletion_requested_at
        FROM public.profiles p
        WHERE p.deletion_requested_at IS NOT NULL
          AND p.deletion_requested_at < cutoff
          AND NOT EXISTS (
                SELECT 1 FROM public.orders o
                 WHERE (o.user_id = p.id OR o.seller_id = p.id OR o.rider_id = p.id)
                   AND o.delivery_status NOT IN ('DELIVERED', 'CANCELED'))
          AND NOT EXISTS (
                SELECT 1 FROM public.orders o
                 WHERE o.seller_id = p.id
                   AND o.delivery_status = 'DELIVERED'
                   AND o.payout_status IN ('PENDING', 'HELD', 'PROCESSING', 'AWAITING_REMITTANCE',
                                           'PENDING_SELLER_ONBOARDING', 'FAILED'));
END;
$function$;

-- ⑩ UN RECLAMO NASCE SOLO APERTO (1660) -------------------------------------------
-- Prima (063): il cliente poteva inserire un reclamo già «resolved_buyer» con un
-- rimborso a piacere. Esito, rimborso e chiusura li scrive solo l'amministrazione.
DROP POLICY IF EXISTS disputes_open_insert ON public.disputes;
CREATE POLICY disputes_open_insert ON public.disputes
  FOR INSERT
  WITH CHECK (
    (SELECT auth.uid()) = opener_id
    AND status = 'open'
    AND refund_cents IS NULL
    AND resolution_notes IS NULL
    AND resolved_at IS NULL
    AND resolved_by IS NULL
    AND EXISTS (
      SELECT 1 FROM public.orders o
       WHERE o.id = disputes.order_id
         AND ((SELECT auth.uid()) = o.user_id OR (SELECT auth.uid()) = o.seller_id))
  );

-- ⑪ IL RILASCIO DI UNA CONSEGNA (145) ------------------------------------------------
-- Prima (066): la chiave di scrittura si alzava prima di guardare chi chiama, il
-- negozio non sapeva niente e il cliente riceveva di nuovo «ordine pronto».
CREATE OR REPLACE FUNCTION public.rider_release_order(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_status text; is_mine boolean; v_seller uuid;
BEGIN
  SELECT (rider_id = auth.uid()), delivery_status, seller_id INTO is_mine, v_status, v_seller
  FROM public.orders WHERE id = p_order_id
  FOR UPDATE;
  IF is_mine IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'ORDER_NOT_FOUND'); END IF;
  IF NOT is_mine THEN RETURN jsonb_build_object('ok', false, 'reason', 'NOT_YOURS'); END IF;
  -- Solo prima del ritiro: dopo PICKED_UP il rider ha la merce, serve intervento admin.
  IF v_status NOT IN ('ASSIGNED') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'TOO_LATE', 'status', v_status);
  END IF;
  -- Da qui in poi si scrive: la chiave si alza adesso, non prima.
  PERFORM set_config('mycity.allow_order_write', '1', true);
  UPDATE public.orders
    SET delivery_status = 'READY', rider_id = NULL,
        rider_lat = NULL, rider_lng = NULL, rider_position_updated_at = NULL
  WHERE id = p_order_id;
  IF v_seller IS NOT NULL THEN
    BEGIN
      INSERT INTO public.notifications (user_id, title, body, link, category) VALUES
        (v_seller, 'Il rider ha lasciato l''ordine',
         'Il rider non ritira piu'' l''ordine #' || upper(substr(p_order_id::text, 1, 6))
           || ': e'' tornato in bacheca per un altro rider.',
         '/seller/orders/' || p_order_id, 'order');
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'rider_release_order: avviso al negozio non scritto per %: %', p_order_id, SQLERRM;
    END;
  END IF;
  RETURN jsonb_build_object('ok', true);
END;
$function$;

-- ⑪ ⑲ ⑳ ㉕ ㉛ GLI AVVISI AL CLIENTE SUGLI STATI DELL'ORDINE (145, 2090, 758, 982)
-- Prima (086/122): faccine nei titoli; «un rider lo ritirerà» anche a chi
-- ritira in negozio; «ordine pronto» ripetuto quando un rider lascia l'ordine;
-- un guasto spariva senza traccia.
CREATE OR REPLACE FUNCTION public.notify_buyer_on_order_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE short_id text;
BEGIN
  IF NEW.delivery_status IS DISTINCT FROM OLD.delivery_status THEN
    short_id := upper(substr(NEW.id::text, 1, 6));
    BEGIN
      IF NEW.delivery_status = 'ACCEPTED' THEN
        INSERT INTO public.notifications (user_id, title, body, link, category) VALUES
          (NEW.user_id, 'Ordine accettato',
           'Il negozio ha accettato il tuo ordine #' || short_id || ' e lo sta preparando.',
           '/orders/' || NEW.id, 'order');
      ELSIF NEW.delivery_status = 'READY' AND OLD.delivery_status IS DISTINCT FROM 'ASSIGNED' THEN
        -- Un ordine che torna in READY perché il rider l'ha lasciato non è una
        -- notizia nuova per il cliente: l'ha già saputo.
        IF coalesce(NEW.pickup_in_store, false) THEN
          INSERT INTO public.notifications (user_id, title, body, link, category) VALUES
            (NEW.user_id, 'Ordine pronto',
             'Il tuo ordine #' || short_id || ' è pronto: puoi passare a ritirarlo in negozio.',
             '/orders/' || NEW.id, 'order');
        ELSE
          INSERT INTO public.notifications (user_id, title, body, link, category) VALUES
            (NEW.user_id, 'Ordine pronto',
             'Il tuo ordine #' || short_id || ' è pronto: un rider passa a prenderlo a breve e te lo porta a casa.',
             '/orders/' || NEW.id, 'order');
        END IF;
      ELSIF NEW.delivery_status = 'ASSIGNED' THEN
        INSERT INTO public.notifications (user_id, title, body, link, category) VALUES
          (NEW.user_id, 'Un rider ha preso il tuo ordine',
           'Il rider passa a prendere l''ordine #' || short_id || ' e te lo porta.',
           '/orders/' || NEW.id, 'order');
        IF NEW.seller_id IS NOT NULL THEN
          INSERT INTO public.notifications (user_id, title, body, link, category) VALUES
            (NEW.seller_id, 'Rider assegnato',
             'Un rider passa a prendere l''ordine #' || short_id || '.',
             '/seller/orders/' || NEW.id, 'order');
        END IF;
      ELSIF NEW.delivery_status = 'OUT_FOR_DELIVERY' THEN
        INSERT INTO public.notifications (user_id, title, body, link, category) VALUES
          (NEW.user_id, 'Ordine in consegna',
           'Il tuo ordine #' || short_id || ' è in arrivo!',
           '/orders/' || NEW.id, 'order');
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- best-effort: la notifica non blocca la transizione di stato, ma lascia traccia.
      RAISE WARNING 'notify_buyer_on_order_status: avviso non scritto per % (%): %',
        NEW.id, NEW.delivery_status, SQLERRM;
    END;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enqueue_order_status_email()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_template   text;
  v_ritiro     boolean := coalesce(NEW.pickup_in_store, false);
  v_negozio    text;
  v_indirizzo  text;
  v_codice     text;
BEGIN
  IF NEW.delivery_status IS NOT DISTINCT FROM OLD.delivery_status THEN
    RETURN NEW;
  END IF;
  IF NEW.user_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.delivery_status = 'READY' AND OLD.delivery_status IS DISTINCT FROM 'ASSIGNED' THEN
    -- Un ordine rimesso in READY perché il rider l'ha lasciato: il cliente ha
    -- già ricevuto «ordine pronto», non gliene si manda un'altra.
    v_template := 'order_ready';
  ELSIF NEW.delivery_status = 'DELIVERED' THEN
    v_template := 'order_delivered';
  ELSE
    RETURN NEW;
  END IF;

  BEGIN
    SELECT p.store_name, p.store_address
      INTO v_negozio, v_indirizzo
      FROM public.profiles p
     WHERE p.id = NEW.seller_id;

    IF v_template = 'order_ready' AND v_ritiro THEN
      SELECT c.code INTO v_codice
        FROM public.order_delivery_codes c
       WHERE c.order_id = NEW.id;
    END IF;

    INSERT INTO public.email_queue (user_id, template, send_at, metadata)
    VALUES (
      NEW.user_id,
      v_template,
      now(),
      jsonb_strip_nulls(jsonb_build_object(
        'orderId',       NEW.id::text,
        'pickupInStore', v_ritiro,
        'storeName',     v_negozio,
        'storeAddress',  CASE WHEN v_ritiro THEN v_indirizzo ELSE NULL END,
        'pickupCode',    v_codice,
        'totalEuro',     round(coalesce(NEW.total_price, 0)::numeric, 2)
      ))
    );
  EXCEPTION WHEN OTHERS THEN
    -- best-effort: la posta non blocca l'avanzamento di un ordine, ma un guasto
    -- resta nel registro del database invece di sparire.
    RAISE WARNING 'enqueue_order_status_email: % per l''ordine % non messa in coda: %',
      v_template, NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$function$;

-- ⑫ LA SCORTA DEL PRODOTTO CON LE TAGLIE (203) -------------------------------------
-- Prima (080): somma letta senza lucchetto, poi scritta: due acquisti insieme
-- lasciavano sulla riga del prodotto la somma vecchia. Ora si prende prima il
-- lucchetto sulla riga del prodotto: la seconda transazione aspetta, e la sua
-- somma vede la taglia scalata dalla prima.
CREATE OR REPLACE FUNCTION public.sync_product_variant_rollup()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_pid uuid; v_count int; v_sum int;
BEGIN
  v_pid := COALESCE(NEW.product_id, OLD.product_id);
  PERFORM 1 FROM public.products WHERE id = v_pid FOR UPDATE;
  SELECT count(*), COALESCE(sum(stock), 0) INTO v_count, v_sum
    FROM public.product_variants WHERE product_id = v_pid;
  UPDATE public.products
    SET has_variants = (v_count > 0),
        -- Con varianti: stock = somma. Senza (ultima variante rimossa): invariato.
        stock = CASE WHEN v_count > 0 THEN v_sum ELSE stock END
    WHERE id = v_pid;
  RETURN NULL;
END; $function$;

-- ⑬ PALETTI SUI NUMERI DI SOLDI (696) ------------------------------------------------
-- NOT VALID: valgono subito per ogni riga nuova o cambiata; quelle vecchie si
-- controllano qui sotto, e se una non regge il vincolo resta NOT VALID con un
-- avviso, invece di fermare la migrazione.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('orders',             'orders_wallet_applied_non_negativo',     'wallet_applied_cents IS NULL OR wallet_applied_cents >= 0'),
      ('orders',             'orders_delivery_fee_non_negativo',       'delivery_fee_cents IS NULL OR delivery_fee_cents >= 0'),
      ('returns',            'returns_refund_amount_non_negativo',     'refund_amount_cents IS NULL OR refund_amount_cents >= 0'),
      ('wallet_ledger',      'wallet_ledger_delta_non_zero',           'delta_cents <> 0'),
      ('sponsored_listings', 'sponsored_listings_budget_non_negativo', 'daily_budget_cents IS NULL OR daily_budget_cents >= 0'),
      ('sponsored_listings', 'sponsored_listings_speso_non_negativo',  'spent_cents IS NULL OR spent_cents >= 0')
    ) AS v(tabella, vincolo, regola)
  LOOP
    IF to_regclass('public.' || r.tabella) IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = r.vincolo
                        AND conrelid = ('public.' || r.tabella)::regclass) THEN
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (%s) NOT VALID', r.tabella, r.vincolo, r.regola);
      BEGIN
        EXECUTE format('ALTER TABLE public.%I VALIDATE CONSTRAINT %I', r.tabella, r.vincolo);
      EXCEPTION WHEN check_violation THEN
        RAISE WARNING '215: % su % resta NOT VALID: ci sono righe vecchie da guardare', r.vincolo, r.tabella;
      END;
    END IF;
  END LOOP;
END $$;

-- ⑭ IL PREMIO INVITO (2573, 2574) ---------------------------------------------------
-- Prima (089, ricopiata nella 168): pagava alla prima consegna DOPO la riga
-- referrals, anche a un cliente vecchio invitato a mano, e un guasto spariva in
-- EXCEPTION WHEN OTHERS THEN NULL.
CREATE OR REPLACE FUNCTION public.reward_referrer_on_delivery()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ref public.referrals%ROWTYPE; v_cents int;
BEGIN
  IF NEW.delivery_status = 'DELIVERED' AND OLD.delivery_status IS DISTINCT FROM 'DELIVERED' THEN
    BEGIN
      IF NOT public.punti_fedelta_accesi() THEN
        RETURN NEW;
      END IF;
      -- Il premio è per il PRIMO ordine consegnato dell'invitato: chi aveva già
      -- ricevuto un ordine prima non è un cliente nuovo portato dall'invito.
      IF EXISTS (SELECT 1 FROM public.orders o
                  WHERE o.user_id = NEW.user_id AND o.id <> NEW.id
                    AND o.delivery_status = 'DELIVERED') THEN
        RETURN NEW;
      END IF;
      SELECT * INTO v_ref FROM public.referrals
        WHERE referred_id = NEW.user_id AND rewarded = false
        FOR UPDATE;
      IF FOUND THEN
        v_cents := GREATEST(0, COALESCE(round(v_ref.reward_amount * 100)::int, 500));
        UPDATE public.referrals
          SET rewarded = true, rewarded_at = now(), status = 'rewarded', converted_at = now()
          WHERE id = v_ref.id;
        IF v_cents > 0 THEN
          PERFORM public.wallet_credit(v_ref.referrer_id, v_cents, 'referral_reward', NEW.id::text);
          INSERT INTO public.notifications (user_id, title, body, link)
          VALUES (
            v_ref.referrer_id,
            'Premio invito ricevuto',
            'Un amico che hai invitato ha completato il primo ordine: hai ricevuto €'
              || replace(to_char(v_cents / 100.0, 'FM999990.00'), '.', ',') || ' di credito.',
            '/profile/referral'
          );
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- La consegna non deve mai fallire per il premio invito, ma il guasto si scrive.
      RAISE WARNING 'reward_referrer_on_delivery: premio invito non dato per l''ordine %: %', NEW.id, SQLERRM;
    END;
  END IF;
  RETURN NEW;
END; $function$;

-- ⑮ vuole_notifica LA CHIAMA SOLO IL SERVER (686) -------------------------------------
-- Prima (115): eseguibile da ogni utente autenticato con l'id di chiunque. La
-- chiama solo il giro delle notifiche push, con la chiave di servizio.
REVOKE EXECUTE ON FUNCTION public.vuole_notifica(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vuole_notifica(uuid, text) TO service_role;

-- ⑯ «RICAVI TOTALI» DELL'ADMIN (654) ------------------------------------------------
-- Prima (117): somma di total_price, senza togliere i rimborsi e senza il
-- credito MyCity usato (che nei contanti è già tolto da total_price). Ora la
-- stessa regola del negozio (lib/metriche-venditore.ts, incassatoDellOrdineCents).
CREATE OR REPLACE FUNCTION public.admin_kpi()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  risultato jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'riservato allo staff' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'utenti', (SELECT jsonb_object_agg(role, n) FROM (
                 SELECT role, count(*) AS n FROM public.profiles GROUP BY role) x),
    'utenti_totali', (SELECT count(*) FROM public.profiles),
    'ordini_totali', (SELECT count(*) FROM public.orders),
    'ordini_per_stato', (SELECT jsonb_object_agg(delivery_status, n) FROM (
                 SELECT delivery_status, count(*) AS n FROM public.orders GROUP BY delivery_status) y),
    -- Incassato sugli ordini consegnati, in centesimi: quello che il cliente ha
    -- pagato (credito MyCity compreso) meno quello che gli è tornato indietro.
    'incassato_cents', (SELECT coalesce(sum(greatest(0,
                            round(coalesce(total_price, 0) * 100)
                            + greatest(0, coalesce(wallet_applied_cents, 0))
                            - coalesce(refunded_amount_cents, 0))), 0)::bigint
                          FROM public.orders WHERE delivery_status = 'DELIVERED'),
    'incassato_7g_cents', (SELECT coalesce(sum(greatest(0,
                            round(coalesce(total_price, 0) * 100)
                            + greatest(0, coalesce(wallet_applied_cents, 0))
                            - coalesce(refunded_amount_cents, 0))), 0)::bigint
                          FROM public.orders
                         WHERE delivery_status = 'DELIVERED'
                           AND created_at >= now() - interval '7 days'),
    'ordini_7g', (SELECT count(*) FROM public.orders WHERE created_at >= now() - interval '7 days'),
    'prodotti_totali', (SELECT count(*) FROM public.products),
    'prodotti_disponibili', (SELECT count(*) FROM public.products WHERE status = 'available'),
    -- La commissione VERA trattenuta, non una stima su un'aliquota scritta a
    -- mano: si somma quella registrata su ogni ordine.
    'commissioni_cents', (SELECT coalesce(sum(application_fee_cents), 0)::bigint
                          FROM public.orders
                         WHERE delivery_status = 'DELIVERED')
  ) INTO risultato;

  RETURN risultato;
END;
$function$;

-- ⑰ GLI ABBONAMENTI NON SI SCRIVONO DAL BROWSER (697) -----------------------------
-- Prima (119): un cliente poteva inserire un abbonamento col prezzo che voleva.
-- Nessuna pagina li crea: quando la funzione esisterà, li scriverà il server.
DROP POLICY IF EXISTS subscription_orders_insert_own ON public.subscription_orders;
REVOKE INSERT ON public.subscription_orders FROM anon, authenticated;

-- ⑱ IL RIASSUNTO NOTTURNO DELLE VISITE (258) ---------------------------------------
-- Prima (119): DO UPDATE SET visite = EXCLUDED.visite sovrascriveva il conto già
-- scritto la notte prima per lo stesso giorno, e il giorno era quello di
-- Greenwich. Ora si somma, e il giorno è quello di Piacenza.
CREATE OR REPLACE FUNCTION public.consolida_visite_prodotto(p_giorni integer DEFAULT 90)
 RETURNS TABLE(aggregate_scritte integer, righe_cancellate integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  limite timestamptz := now() - make_interval(days => greatest(p_giorni, 1));
  scritte int := 0;
  cancellate int := 0;
BEGIN
  -- Prima il conto: se questa fallisce, non si cancella niente.
  WITH agg AS (
    SELECT product_id, (viewed_at AT TIME ZONE 'Europe/Rome')::date AS giorno, count(*)::int AS visite
      FROM public.product_views
     WHERE viewed_at < limite
     GROUP BY product_id, (viewed_at AT TIME ZONE 'Europe/Rome')::date
  )
  INSERT INTO public.product_views_daily AS d (product_id, giorno, visite)
  SELECT product_id, giorno, visite FROM agg
  ON CONFLICT (product_id, giorno) DO UPDATE SET visite = d.visite + EXCLUDED.visite;
  GET DIAGNOSTICS scritte = ROW_COUNT;

  DELETE FROM public.product_views WHERE viewed_at < limite;
  GET DIAGNOSTICS cancellate = ROW_COUNT;

  RETURN QUERY SELECT scritte, cancellate;
END;
$function$;

-- ⑳ «PREZZO ABBASSATO» (181) ---------------------------------------------------------
-- Prima (122): partiva anche per prodotti in bozza o esauriti e per negozi non
-- approvati, a ogni ritocco, col prezzo scritto «€1.20».
CREATE OR REPLACE FUNCTION public.notify_favorite_price_drop()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_drop_percent numeric;
BEGIN
    IF NEW.price >= OLD.price THEN
        RETURN NEW;
    END IF;

    -- Solo un prodotto che il cliente può aprire e comprare.
    IF NEW.status IS DISTINCT FROM 'available' THEN
        RETURN NEW;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.profiles s
                    WHERE s.id = NEW.seller_id AND s.is_approved = true) THEN
        RETURN NEW;
    END IF;

    v_drop_percent := ROUND(((OLD.price - NEW.price) / OLD.price * 100)::numeric, 0);

    -- Salta se il calo è sotto il 5% (rumore)
    IF v_drop_percent < 5 THEN
        RETURN NEW;
    END IF;

    INSERT INTO public.notifications (user_id, title, body, link, category)
    SELECT
        f.user_id,
        'Prezzo abbassato: ' || NEW.name,
        'Il prodotto che hai salvato è sceso di ' || v_drop_percent || '% — da € ' ||
            replace(to_char(OLD.price, 'FM999990.00'), '.', ',') || ' a € ' ||
            replace(to_char(NEW.price, 'FM999990.00'), '.', ','),
        '/product/' || NEW.id,
        'promo'
    FROM public.favorites f
    WHERE f.product_id = NEW.id
      -- Un avviso al giorno per prodotto: abbassa-rialza-riabbassa non è una notizia nuova.
      AND NOT EXISTS (
        SELECT 1 FROM public.notifications n
         WHERE n.user_id = f.user_id
           AND n.link = '/product/' || NEW.id
           AND n.category = 'promo'
           AND n.title LIKE '%Prezzo abbassato%'
           AND n.created_at > now() - interval '24 hours');

    RETURN NEW;
END;
$function$;

-- ㉑ L'ANTEPRIMA DELLA CHAT (94) ------------------------------------------------------
-- Prima: last_message_preview restava col testo di un messaggio cancellato (per
-- esempio quando il cliente cancella l'account e i suoi messaggi cadono a
-- cascata). Ora, a ogni messaggio cancellato, l'anteprima torna all'ultimo
-- messaggio che resta, o si svuota.
CREATE OR REPLACE FUNCTION public.anteprima_chat_dopo_cancellazione()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ultimo record;
BEGIN
  SELECT m.body, m.created_at INTO v_ultimo
    FROM public.messages m
   WHERE m.conversation_id = OLD.conversation_id
   ORDER BY m.created_at DESC
   LIMIT 1;
  UPDATE public.conversations
     SET last_message_preview = CASE WHEN v_ultimo IS NULL THEN NULL ELSE substring(v_ultimo.body, 1, 200) END
   WHERE id = OLD.conversation_id;
  RETURN NULL;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.anteprima_chat_dopo_cancellazione() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_anteprima_chat_dopo_cancellazione ON public.messages;
CREATE TRIGGER trg_anteprima_chat_dopo_cancellazione
  AFTER DELETE ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.anteprima_chat_dopo_cancellazione();

-- ㉒ IL FATTORINO NON LEGGE PER SEMPRE GLI ORDINI ANNULLATI (103) -------------------
-- Prima (127): chiuso = solo DELIVERED; un ordine CANCELED col suo rider_id
-- restava leggibile senza limite, recapiti compresi. Ora anche l'annullato
-- resta visibile sette giorni, come il consegnato.
DROP POLICY IF EXISTS "Riders can view available and own orders" ON public.orders;
CREATE POLICY "Riders can view available and own orders" ON public.orders
  FOR SELECT
  USING (
    rider_id = (SELECT auth.uid())
    AND (
      delivery_status NOT IN ('DELIVERED', 'CANCELED')
      OR (delivery_status = 'DELIVERED' AND (delivered_at IS NULL OR delivered_at > now() - interval '7 days'))
      OR (delivery_status = 'CANCELED' AND canceled_at > now() - interval '7 days')
    )
  );

-- ㉓ «VENDUTI» NON CONTA I RIMBORSATI (786) --------------------------------------------
-- Prima (141): ogni riga consegnata, pagamento ignorato. La regola del sito
-- (lib/metriche-venditore.ts): contano solo gli ordini pagati e non annullati.
CREATE OR REPLACE FUNCTION public.venduti_per_prodotto(p_products uuid[])
 RETURNS TABLE(product_id uuid, venduti bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT oi.product_id, sum(oi.quantity)::bigint AS venduti
    FROM public.order_items oi
    JOIN public.orders   o ON o.id = oi.order_id
    JOIN public.products p ON p.id = oi.product_id
   WHERE oi.product_id = ANY(p_products)
     AND p.seller_id = (SELECT auth.uid())
     AND o.delivery_status = 'DELIVERED'
     AND o.payment_status IN ('PAID', 'PARTIALLY_REFUNDED')
   GROUP BY oi.product_id;
$function$;

-- ㉔ LE SCRITTURE RIMASTE APERTE ALL'ANONIMO (699) ------------------------------------
-- La 145 ha ridato INSERT/UPDATE/DELETE ad `anon` su ogni tabella con una regola
-- scritta TO public. Un anonimo scrive davvero solo tre cose: la visita a un
-- prodotto, il modulo contatti e una segnalazione. Tutto il resto si toglie.
-- Prima: i permessi della 145 (riconcessi per comando dove una regola lo copre).
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT DISTINCT table_name, privilege_type
      FROM information_schema.role_table_grants
     WHERE grantee = 'anon' AND table_schema = 'public'
       AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE')
  LOOP
    IF r.privilege_type = 'INSERT' AND r.table_name IN ('product_views', 'contact_messages', 'segnalazioni') THEN
      CONTINUE;
    END IF;
    EXECUTE format('REVOKE %s ON public.%I FROM anon', r.privilege_type, r.table_name);
  END LOOP;
END $$;

-- ㉖ IL MAGAZZINO DEI DOCUMENTI D'IDENTITÀ (1622) -------------------------------------
-- Prima: file_size_limit e allowed_mime_types NULL su `kyc-docs` e `invoices`.
-- I valori sono quelli che la rotta di caricamento già fa rispettare
-- (app/api/kyc/upload-document: 8 MB, JPG/PNG/WEBP/PDF). Le fatture sono PDF.
UPDATE storage.buckets
   SET file_size_limit = 8388608,
       allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
 WHERE id = 'kyc-docs';
UPDATE storage.buckets
   SET file_size_limit = 10485760,
       allowed_mime_types = ARRAY['application/pdf']
 WHERE id = 'invoices';

-- ㉗ IL NOME SCRITTO ALLA REGISTRAZIONE (183) --------------------------------------------
-- Prima (161): il profilo nasceva senza nome, e il nome scritto nel modulo
-- restava solo nei dati dell'account.
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  role_choice text;
  nome text;
BEGIN
  role_choice := COALESCE(new.raw_user_meta_data ->> 'role', 'buyer');
  nome := nullif(left(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), 120), '');
  INSERT INTO public.profiles (id, role, is_approved, approval_status, referral_code, full_name)
  VALUES (
    new.id,
    CASE
      WHEN role_choice = 'seller' THEN 'seller'
      WHEN role_choice = 'rider'  THEN 'rider'
      ELSE 'buyer'
    END,
    false,
    'pending',
    upper(substr(md5(new.id::text), 1, 8)),
    nome
  );
  RETURN new;
END;
$function$;

-- ㉘ LA CONSEGNA NON PASSA SOPRA UN ANNULLO (201) ---------------------------------------
-- Prima (163): stato letto senza lucchetto e UPDATE con il solo id. Ora la riga
-- dell'ordine si blocca alla lettura (un annullo in volo fa aspettare e poi si
-- legge CANCELED), e la scrittura ripete la condizione sullo stato.
CREATE OR REPLACE FUNCTION public.verify_delivery_code(p_order_id uuid, p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE stored_code text; current_status text; can_verify boolean; v_seller_id uuid; v_buyer_id uuid;
        v_attempts int; v_locked timestamptz;
        v_metodo text; v_incasso timestamptz;
        v_scritte int;
BEGIN
  IF p_code IS NULL OR btrim(p_code) = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'WRONG_CODE');
  END IF;

  SELECT (rider_id = (SELECT auth.uid()) AND delivery_status IN ('PICKED_UP', 'OUT_FOR_DELIVERY')),
         seller_id, user_id, delivery_status, payment_method, cash_confirmed_at
  INTO can_verify, v_seller_id, v_buyer_id, current_status, v_metodo, v_incasso
  FROM public.orders WHERE id = p_order_id
  FOR UPDATE;
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

  UPDATE public.orders
    SET delivery_status = 'DELIVERED', delivered_at = now(),
        rider_lat = NULL, rider_lng = NULL, rider_position_updated_at = NULL
    WHERE id = p_order_id
      AND delivery_status IN ('PICKED_UP', 'OUT_FOR_DELIVERY');
  GET DIAGNOSTICS v_scritte = ROW_COUNT;
  IF v_scritte = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'WRONG_STATUS');
  END IF;
  UPDATE public.order_delivery_codes SET verified_at = now(), attempts = 0, locked_until = NULL
    WHERE order_id = p_order_id;
  BEGIN
    INSERT INTO public.notifications (user_id, title, body, link, category) VALUES
      (v_buyer_id,  'Ordine consegnato', 'Il tuo ordine è stato consegnato. Buon appetito!', '/orders/' || p_order_id, 'order'),
      (v_seller_id, 'Ordine consegnato', 'L''ordine è stato consegnato al cliente.', '/seller/orders/' || p_order_id, 'order');
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'verify_delivery_code: avvisi di consegna non scritti per %: %', p_order_id, SQLERRM;
  END;
  RETURN jsonb_build_object('ok', true);
END;
$function$;

-- ㉙ LA SERIE DEI GIORNI CONTA IL GIORNO DI PIACENZA (260) ------------------------------
-- Prima (027): v_today := CURRENT_DATE, cioè il giorno del fuso del database (UTC).
CREATE OR REPLACE FUNCTION public.touch_loyalty_streak()
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_uid uuid;
    v_today date := (now() AT TIME ZONE 'Europe/Rome')::date;
    v_last date;
    v_streak int;
    v_longest int;
    v_bonus int := 0;
BEGIN
    v_uid := auth.uid();
    IF v_uid IS NULL THEN
        RETURN json_build_object('error', 'unauthenticated');
    END IF;

    SELECT last_visit_date, streak_days, longest_streak
    INTO v_last, v_streak, v_longest
    FROM public.loyalty_accounts WHERE user_id = v_uid;

    IF v_last IS NULL THEN
        v_streak := 1;
    ELSIF v_last = v_today THEN
        -- già loggato oggi
        RETURN json_build_object('streak', v_streak, 'bonus', 0, 'already_today', true);
    ELSIF v_last = v_today - INTERVAL '1 day' THEN
        v_streak := v_streak + 1;
    ELSE
        v_streak := 1;
    END IF;

    v_longest := GREATEST(COALESCE(v_longest, 0), v_streak);

    -- Bonus a milestone: 7gg = +20, 30gg = +100, 100gg = +500
    IF v_streak IN (7, 30, 100) THEN
        v_bonus := CASE v_streak WHEN 7 THEN 20 WHEN 30 THEN 100 WHEN 100 THEN 500 END;
        PERFORM public.award_loyalty_points(v_uid, v_bonus, format('streak_%s_days', v_streak));
    END IF;

    INSERT INTO public.loyalty_accounts (user_id, streak_days, last_visit_date, longest_streak)
    VALUES (v_uid, v_streak, v_today, v_longest)
    ON CONFLICT (user_id) DO UPDATE SET
        streak_days = v_streak,
        last_visit_date = v_today,
        longest_streak = v_longest,
        updated_at = now();

    RETURN json_build_object('streak', v_streak, 'longest', v_longest, 'bonus', v_bonus);
END;
$function$;

-- ㉚ LE EMAIL DEL BENVENUTO DOPO LA CONFERMA DELL'EMAIL (542) ---------------------------
-- Prima (033): il profilo nasce al modulo d'iscrizione, prima della conferma, e
-- welcome + tutorial_day2 partivano anche verso indirizzi sbagliati o di
-- estranei. Ora la coda si riempie quando l'email è confermata: subito per chi
-- nasce già confermato (accesso con Google), alla conferma per gli altri.
CREATE OR REPLACE FUNCTION public.accoda_email_del_benvenuto(p_user uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    IF EXISTS (SELECT 1 FROM public.email_queue WHERE user_id = p_user AND template = 'welcome') THEN
        RETURN;
    END IF;
    INSERT INTO public.email_queue (user_id, template, send_at)
    VALUES
        (p_user, 'welcome',          now()),
        (p_user, 'tutorial_day2',    now() + interval '2 days'),
        (p_user, 'first_order_promo',now() + interval '5 days'),
        (p_user, 'reengagement_14d', now() + interval '14 days'),
        (p_user, 'winback_60d',      now() + interval '60 days');
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.accoda_email_del_benvenuto(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.enqueue_lifecycle_emails()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    IF NEW.role <> 'buyer' AND NEW.role IS NOT NULL THEN
        RETURN NEW;
    END IF;
    -- Solo a email confermata: chi non l'ha ancora confermata riceve tutto alla
    -- conferma (trg_email_confermata_accoda_benvenuto su auth.users).
    IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = NEW.id AND u.email_confirmed_at IS NOT NULL) THEN
        RETURN NEW;
    END IF;
    PERFORM public.accoda_email_del_benvenuto(NEW.id);
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.email_confermata_accoda_benvenuto()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    IF EXISTS (SELECT 1 FROM public.profiles p
                WHERE p.id = NEW.id AND (p.role = 'buyer' OR p.role IS NULL)) THEN
        PERFORM public.accoda_email_del_benvenuto(NEW.id);
    END IF;
    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    -- La conferma dell'email non deve mai fallire per la posta di benvenuto.
    RAISE WARNING 'email_confermata_accoda_benvenuto: benvenuto non messo in coda per %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.email_confermata_accoda_benvenuto() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_email_confermata_accoda_benvenuto ON auth.users;
CREATE TRIGGER trg_email_confermata_accoda_benvenuto
  AFTER UPDATE OF email_confirmed_at ON auth.users
  FOR EACH ROW
  WHEN (OLD.email_confirmed_at IS NULL AND NEW.email_confirmed_at IS NOT NULL)
  EXECUTE FUNCTION public.email_confermata_accoda_benvenuto();

-- ㉛ NIENTE FACCINE NEGLI AVVISI SCRITTI DAL DATABASE (982) ----------------------------
-- Le funzioni qui sopra sono già riscritte senza. Le altre che scrivono nella
-- campanella (annullo, rifiuto, ritiro, badge, ritorno in vendita) si ripuliscono
-- qui: a ogni testo fra apici che COMINCIA con una faccina, la faccina e lo
-- spazio dopo si tolgono. Il resto della funzione non cambia. Rilanciata, non
-- trova più niente da togliere.
-- Prima: i titoli con ❌ ✕ 📦 ✋ 🏆 ✨ ✅ (086, 127, 163 e seguenti).
DO $$
DECLARE
  r record;
  definizione text;
  pulita text;
BEGIN
  FOR r IN
    SELECT p.oid
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('auto_republish_on_restock', 'seller_reject_order', 'unlock_achievement',
                         'verify_pickup_code', 'confirm_pickup_by_seller', 'cancel_order')
  LOOP
    definizione := pg_get_functiondef(r.oid);
    pulita := regexp_replace(definizione, '''[\U0001F300-\U0001FAFF☀-➿️]+\s*', '''', 'g');
    IF pulita IS DISTINCT FROM definizione THEN
      EXECUTE pulita;
    END IF;
  END LOOP;
END $$;

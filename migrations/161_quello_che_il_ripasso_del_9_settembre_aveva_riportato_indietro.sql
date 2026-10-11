-- ═══════════════════════════════════════════════════════════════════════════
-- 161 — QUELLO CHE IL RIPASSO DEL 9 SETTEMBRE AVEVA RIPORTATO INDIETRO
-- 11/10/2026 · controllo delle migrazioni contro il database di produzione
-- ═══════════════════════════════════════════════════════════════════════════
--
-- COSA E' SUCCESSO
-- Il 9 settembre, fra le 9:25 e le 10:04 ora di Piacenza, sulla produzione sono
-- state rieseguite le migrazioni dalla 003 alla 079, a pacchetti, con lo
-- strumento di Supabase. Era il «passo 2» di docs/migrazioni-baseline-
-- produzione.md. Il lavoro si e' fermato dopo la 079 e non e' stato annotato da
-- nessuna parte.
--
-- Rieseguire una migrazione vecchia non e' innocuo: `CREATE OR REPLACE` rimette
-- la versione VECCHIA di una funzione sopra quella nuova, e `CREATE POLICY`
-- rimette una porta che una migrazione successiva aveva chiuso. Le versioni
-- nuove stavano nelle migrazioni dalla 080 in poi, che quel giorno non sono
-- state ripassate. Risultato misurato sul database vero, oggetto per oggetto:
-- 12 funzioni e 27 regole di accesso tornate a com'erano a maggio-luglio.
--
-- La procedura del 7 settembre, se la si lancia adesso, ne ripara una parte e
-- ne rompe altre due (provato su una copia fedele della produzione, vedi sotto):
-- riapplica la 119 e la 122, che la produzione ha gia', e con loro rimette le
-- versioni precedenti alla 124 del vincolo sul compenso del fattorino e della
-- bacheca dei fattorini. Questa migrazione viene DOPO tutte le altre e chiude
-- quello che resta.
--
-- COSA SI ROMPE OGGI, IN PRODUZIONE
--   ① Nessuno riesce a iscriversi come negozio o come fattorino. La funzione che
--      crea il profilo e' tornata alla versione della 015: scrive «approvato»
--      a chi sceglie negozio o fattorino, mentre lo stato resta «in attesa». Il
--      vincolo della 119 (chk_approvazione_coerente) rifiuta la riga, e con lei
--      l'iscrizione intera. I clienti invece si iscrivono.
--   ② Dieci regole di accesso tornate aperte: chi ha un account legge tutti i
--      codici sconto attivi e i codici zona, i partecipanti degli acquisti di
--      gruppo, tutte le recensioni dei negozi anche non approvati; il
--      fattorino legge il profilo intero del cliente; il negozio puo' mettere
--      «attiva» da solo la propria sponsorizzazione; chi sta in una chat puo'
--      riscrivere i messaggi dell'altro; chiunque puo' iscrivere qualsiasi
--      email alla newsletter e inventare visite ai prodotti.
--   ③ Due regole scritte male: chiunque abbia un account (non solo un
--      fattorino approvato) puo' prendersi un ordine pronto; una recensione al
--      negozio non controlla che l'ordine fosse proprio di quel negozio.
--   ④ Cinque funzioni alla versione vecchia: la prenotazione e la restituzione
--      della merce ignorano le varianti (080), il registro attivita' non
--      oscura i campi sensibili nuovi (115), il conteggio dei rimborsi perde la
--      correzione della 124, l'acquisto di gruppo perde la protezione della 059.
--
-- COSA FA QUESTA MIGRAZIONE
-- Rimette ogni oggetto nella sua definizione FINALE, quella che il resto del
-- repository si aspetta. Su un database costruito da zero con tutte le
-- migrazioni non cambia niente: ogni istruzione riscrive cio' che c'e' gia'.
-- In produzione, lanciata come ultima dopo la procedura, porta il database a
-- coincidere con il repository: provato sotto.
--
-- PERCHE' NON C'E' BEGIN/COMMIT
-- Lo script scripts/applica-migrazioni-mancanti.sh avvolge gia' ogni file in
-- una transazione sola (--single-transaction). Un COMMIT qui dentro la
-- chiuderebbe a meta' (vedi l'avviso in testa allo script). Senza, la
-- migrazione o passa tutta o non lascia niente.
--
-- COME E' STATA PROVATA (11/10/2026)
-- Su una copia locale della produzione ricostruita dal catalogo vero: 2.198
-- oggetti (funzioni, regole, vincoli, indici, colonne, permessi) identici a
-- quelli di produzione, piu' i dati veri con nomi e recapiti mascherati.
--   1. procedura del 7 settembre: «applicate 47 · gia' presenti 108», uscita 0;
--   2. questa migrazione;
--   3. confronto con il database costruito dal repository: zero differenze
--      sugli oggetti del repository (restano solo le tabelle della macchina
--      AD e due cartelle foto, che col sito non c'entrano);
--   4. le 33 prove di tests/sql/rls/ verdi, che prima della migrazione erano
--      rosse a partire dall'iscrizione.
--
-- RISCHIO / REVERSIBILITA'
-- Nessun dato viene riscritto. L'unica cancellazione e' la tabella
-- business_orders, che la 105 aveva tolto e il ripasso del 9 settembre ha
-- ricreato vuota: si toglie SOLO se e' ancora vuota, altrimenti la migrazione
-- si limita ad avvisare. Il ritorno indietro di ogni pezzo e' la definizione
-- che c'era prima, ma riportarla vorrebbe dire riaprire i difetti: non c'e'
-- un motivo per farlo.
--
-- QUANDO APPLICARLA: subito dopo la procedura, nello stesso giro. Fra la
-- procedura e questa migrazione il compenso del fattorino non puo' passare a
-- 'HELD': con zero ordini in corso non costa niente, ma il giro deve finire.
-- ═══════════════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────────
-- ① L'ISCRIZIONE DI NEGOZI E FATTORINI TORNA A FUNZIONARE
-- Versione della 114: chi sceglie negozio o fattorino nasce NON approvato e
-- «in attesa». L'approvazione la da' lo staff. Coerente con il vincolo della 119.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  role_choice text;
BEGIN
  role_choice := COALESCE(new.raw_user_meta_data ->> 'role', 'buyer');
  INSERT INTO public.profiles (id, role, is_approved, approval_status, referral_code)
  VALUES (
    new.id,
    CASE
      WHEN role_choice = 'seller' THEN 'seller'
      WHEN role_choice = 'rider'  THEN 'rider'
      ELSE 'buyer'
    END,
    false,
    'pending',
    upper(substr(md5(new.id::text), 1, 8))
  );
  RETURN new;
END;
$function$;


-- ─────────────────────────────────────────────────────────────────────────
-- ② LE FUNZIONI TORNATE INDIETRO RIPRENDONO LA LORO VERSIONE
-- Le definizioni sono quelle dell'ultima migrazione che le tocca, copiate dal
-- database costruito dal repository. Se una migrazione futura le cambia, la
-- sua versione viene dopo e vince.
-- ─────────────────────────────────────────────────────────────────────────

-- Acquisto di gruppo: SECURITY DEFINER e search_path fisso (059).
CREATE OR REPLACE FUNCTION public.update_group_quantity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.group_orders
    SET current_quantity = current_quantity + NEW.quantity,
        status = CASE
          WHEN (current_quantity + NEW.quantity) >= target_quantity THEN 'COMPLETED'
          ELSE status
        END
    WHERE id = NEW.group_order_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.group_orders
    SET current_quantity = GREATEST(0, current_quantity - OLD.quantity)
    WHERE id = OLD.group_order_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$function$;

-- Registro attivita': oscura anche le chiavi sensibili nuove (115).
CREATE OR REPLACE FUNCTION public.log_activity_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_category   text;
  v_action     text := lower(TG_OP);              -- insert | update | delete
  v_row        jsonb := to_jsonb(COALESCE(NEW, OLD));
  v_old        jsonb := CASE WHEN OLD IS NULL THEN '{}'::jsonb ELSE to_jsonb(OLD) END;
  v_new        jsonb := CASE WHEN NEW IS NULL THEN '{}'::jsonb ELSE to_jsonb(NEW) END;
  v_target_id  text  := COALESCE(v_row->>'id', '');
  v_diff       jsonb := '{}'::jsonb;
  v_key        text;
  v_meta       jsonb;
  v_summary    text;
  -- colonne sensibili da redarre nel diff (mai loggare valori grezzi)
  v_redact     text[] := ARRAY['password','token','secret','access_token','refresh_token',
                               'card','iban','cvv','tax_code','fiscal_code','document_number'];
BEGIN
  -- categoria per tabella
  v_category := CASE TG_TABLE_NAME
    WHEN 'orders'             THEN 'commerce'
    WHEN 'order_items'        THEN 'commerce'
    WHEN 'disputes'           THEN 'commerce'
    WHEN 'returns'            THEN 'commerce'
    WHEN 'coupons'            THEN 'commerce'
    WHEN 'gift_cards'         THEN 'commerce'
    WHEN 'products'           THEN 'catalog'
    WHEN 'seller_promotions'  THEN 'catalog'
    WHEN 'reviews'            THEN 'content'
    WHEN 'store_reviews'      THEN 'content'
    WHEN 'marketplace_events' THEN 'content'
    WHEN 'profiles'           THEN 'user'
    ELSE 'system'
  END;

  -- diff delle sole colonne cambiate (solo su UPDATE), con redazione
  IF TG_OP = 'UPDATE' THEN
    FOR v_key IN SELECT jsonb_object_keys(v_new) LOOP
      IF (v_new->v_key) IS DISTINCT FROM (v_old->v_key) THEN
        IF v_key = ANY(v_redact) OR public.activity_key_sensibile(v_key) THEN
          v_diff := v_diff || jsonb_build_object(v_key, jsonb_build_object('old','***','new','***'));
        ELSE
          v_diff := v_diff || jsonb_build_object(v_key,
            jsonb_build_object('old', v_old->v_key, 'new', v_new->v_key));
        END IF;
      END IF;
    END LOOP;
    -- niente cambiamenti reali (es. trigger updated_at) → non loggare rumore
    IF v_diff = '{}'::jsonb THEN
      RETURN COALESCE(NEW, OLD);
    END IF;
    v_meta := jsonb_build_object('changed', v_diff);
    v_summary := TG_TABLE_NAME || ' #' || left(v_target_id, 8) || ' aggiornato ('
                 || (SELECT count(*) FROM jsonb_object_keys(v_diff)) || ' campi)';
  ELSIF TG_OP = 'INSERT' THEN
    v_meta := NULL;
    v_summary := TG_TABLE_NAME || ' #' || left(v_target_id, 8) || ' creato';
  ELSE -- DELETE
    v_meta := jsonb_build_object('deleted_row_id', v_target_id);
    v_summary := TG_TABLE_NAME || ' #' || left(v_target_id, 8) || ' eliminato';
  END IF;

  INSERT INTO public.activity_events
    (category, event_type, action, summary, actor_id, target_table, target_id, metadata)
  VALUES
    (v_category, TG_TABLE_NAME || '.' || v_action, v_action, v_summary,
     auth.uid(), TG_TABLE_NAME, NULLIF(v_target_id, ''), v_meta);

  RETURN COALESCE(NEW, OLD);
EXCEPTION WHEN OTHERS THEN
  -- il logging non deve MAI rompere la scrittura applicativa
  RETURN COALESCE(NEW, OLD);
END;
$function$;

-- Prenotazione della merce: tiene conto delle varianti (080).
CREATE OR REPLACE FUNCTION public.reserve_stock(p_items jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE it jsonb; v_pid uuid; v_vid uuid; v_qty int; v_updated int;
BEGIN
  FOR it IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_pid := (it->>'product_id')::uuid;
    v_vid := NULLIF(it->>'variant_id', '')::uuid;
    v_qty := (it->>'qty')::int;
    IF v_qty IS NULL OR v_qty <= 0 THEN CONTINUE; END IF;
    IF v_vid IS NOT NULL THEN
      UPDATE public.product_variants
        SET stock = stock - v_qty
        WHERE id = v_vid AND product_id = v_pid AND stock >= v_qty;
      GET DIAGNOSTICS v_updated = ROW_COUNT;
      IF v_updated = 0 THEN
        RAISE EXCEPTION 'OUT_OF_STOCK:%', v_vid USING ERRCODE = '23514';
      END IF;
    ELSE
      IF v_pid IS NULL THEN CONTINUE; END IF;
      UPDATE public.products
        SET stock = stock - v_qty
        WHERE id = v_pid AND (stock IS NULL OR stock >= v_qty);
      GET DIAGNOSTICS v_updated = ROW_COUNT;
      IF v_updated = 0 THEN
        RAISE EXCEPTION 'OUT_OF_STOCK:%', v_pid USING ERRCODE = '23514';
      END IF;
    END IF;
  END LOOP;
END; $function$;

-- Restituzione della merce: tiene conto delle varianti (080).
CREATE OR REPLACE FUNCTION public.restore_stock(p_items jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE it jsonb; v_vid uuid;
BEGIN
  FOR it IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_vid := NULLIF(it->>'variant_id', '')::uuid;
    IF v_vid IS NOT NULL THEN
      UPDATE public.product_variants
        SET stock = stock + (it->>'qty')::int
        WHERE id = v_vid;
    ELSE
      UPDATE public.products
        SET stock = stock + (it->>'qty')::int
        WHERE id = (it->>'product_id')::uuid AND stock IS NOT NULL;
    END IF;
  END LOOP;
END; $function$;

-- Somma dei rimborsi di un ordine: la versione corretta della 124.
CREATE OR REPLACE FUNCTION public.accumula_rimborso(p_order_id uuid, p_delta integer)
 RETURNS TABLE(totale_rimborsato integer, totale_ordine integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;


-- ─────────────────────────────────────────────────────────────────────────
-- ③ LE PORTE RIAPERTE SI RICHIUDONO
-- Ognuna era stata tolta da una migrazione precedente (fra parentesi), e
-- sostituita da una vista, da una funzione o da una regola piu' stretta che
-- c'e' gia'. Il ripasso le aveva ricreate.
-- ─────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Anyone can read active coupons"          ON public.coupons;              -- (114) codici sconto leggibili da chiunque abbia un account
DROP POLICY IF EXISTS "zone_codes_public_read"                  ON public.zone_codes;           -- (114) codici zona elencabili
DROP POLICY IF EXISTS "Anyone reads participants"               ON public.group_participants;   -- (114) chi partecipa a un acquisto di gruppo
DROP POLICY IF EXISTS "Anyone can read store reviews"           ON public.store_reviews;        -- (114) recensioni anche dei negozi non approvati
DROP POLICY IF EXISTS "sponsored_listings_public_read"          ON public.sponsored_listings;   -- (114) budget e spesa delle sponsorizzazioni altrui
DROP POLICY IF EXISTS "sponsored_listings_owner_rw"             ON public.sponsored_listings;   -- (088) il negozio si attivava da solo la sponsorizzazione
DROP POLICY IF EXISTS "Riders can view buyer of assigned orders" ON public.profiles;            -- (115) il fattorino leggeva il profilo intero del cliente
DROP POLICY IF EXISTS "messages_update_read"                    ON public.messages;             -- (115) in chat si riscrivevano i messaggi dell'altro
DROP POLICY IF EXISTS "Anyone can subscribe"                    ON public.newsletter_subscribers; -- (115) iscrizione di email altrui alla newsletter
DROP POLICY IF EXISTS "pv_insert_any"                           ON public.product_views;        -- (060) visite ai prodotti inventate a nome di altri

-- Queste sette la procedura le toglie gia' (020, 109, 110, 119). Si ripetono
-- qui perche' questa migrazione deve chiudere tutto anche da sola, qualunque
-- strada abbia fatto prima il database.
DROP POLICY IF EXISTS "Anyone can view approved seller profiles" ON public.profiles;            -- (110) profilo intero dei negozi a chiunque abbia un account
DROP POLICY IF EXISTS "Public profile read"                     ON public.profiles;             -- (110) profilo intero di chi ha il profilo pubblico
DROP POLICY IF EXISTS "Anyone reads group orders"               ON public.group_orders;         -- (020)
DROP POLICY IF EXISTS "Anyone can read rider reviews"           ON public.rider_reviews;        -- (109)
DROP POLICY IF EXISTS "event_rsvps_public_count_read"           ON public.event_rsvps;          -- (119) chi partecipa a quale evento
DROP POLICY IF EXISTS "shop_of_month_votes_public_read"         ON public.shop_of_month_votes;  -- (119) chi ha votato chi
DROP POLICY IF EXISTS "subscription_orders_owner_rw"            ON public.subscription_orders;  -- (119) abbonamenti modificabili a piacere
DROP POLICY IF EXISTS "stories insert authenticated"            ON storage.objects;             -- (119) caricare file nella cartella di un altro

-- Le due regole scritte male tornano alla loro versione finale.
DROP POLICY IF EXISTS "Riders can update assigned or claim free orders" ON public.orders;
DROP POLICY IF EXISTS "Buyers can review delivered orders"              ON public.store_reviews;
CREATE POLICY "Riders can update assigned or claim free orders" ON public.orders AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_rider_approvato() AND ((rider_id = ( SELECT auth.uid() AS uid)) OR ((delivery_status = 'READY'::text) AND (rider_id IS NULL)))))
  WITH CHECK (((rider_id = ( SELECT auth.uid() AS uid)) AND (delivery_status <> 'DELIVERED'::text)));
CREATE POLICY "Buyers can review delivered orders" ON public.store_reviews AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND (store_id <> ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM orders o
  WHERE ((o.id = store_reviews.order_id) AND (o.user_id = ( SELECT auth.uid() AS uid)) AND (o.seller_id = store_reviews.store_id) AND (o.delivery_status = 'DELIVERED'::text))))));


-- ─────────────────────────────────────────────────────────────────────────
-- ④ I PERMESSI IN PIU' SI TOLGONO
-- Le regole sopra bastano a chiudere la porta; questi permessi sono la
-- seconda serratura, come nel resto del repository (145).
-- ─────────────────────────────────────────────────────────────────────────
REVOKE UPDATE ON public.messages               FROM anon;
REVOKE INSERT ON public.newsletter_subscribers FROM anon, authenticated;
REVOKE INSERT ON public.store_reviews          FROM anon;


-- ─────────────────────────────────────────────────────────────────────────
-- ⑤ IL COMPENSO DEL FATTORINO PUO' DI NUOVO ANDARE IN ATTESA
-- Versione della 124. Senza 'HELD' il database rifiuta il passaggio che il
-- codice fa quando un bonifico al fattorino fallisce (release-payouts,
-- contestazioni): il compenso resterebbe fermo per sempre in 'PROCESSING'.
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_rider_payout_status_check;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_rider_payout_status_check
  CHECK (rider_payout_status IS NULL OR rider_payout_status IN (
    'HELD', 'PENDING_RIDER_ONBOARDING', 'PROCESSING', 'TRANSFERRED', 'FAILED',
    'REVERSED', 'AWAITING_REMITTANCE', 'CASH_WITHHELD'
  ));


-- ─────────────────────────────────────────────────────────────────────────
-- ⑥ LE DUE VISTE TORNANO ALLA LORO FORMA
-- La bacheca dei fattorini della 124 non mostra gli ordini che il cliente
-- ritira in negozio: con la versione della 122 un fattorino poteva prenderne
-- uno in carico e portarsi via la merce.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.ordini_disponibili_rider
  WITH (security_invoker = off, security_barrier = true) AS
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
    ( SELECT count(*) AS count
           FROM order_items oi
          WHERE (oi.order_id = o.id)) AS articoli
   FROM (orders o
     LEFT JOIN profiles s ON ((s.id = o.seller_id)))
  WHERE ((o.rider_id IS NULL) AND (o.delivery_status = ANY (ARRAY['ACCEPTED'::text, 'READY'::text])) AND (COALESCE(o.pickup_in_store, false) = false) AND is_rider_approvato());

-- Il negozio del mese conta i voti di tutti (121), dietro la barriera (152).
ALTER VIEW public.shop_of_month_leaderboard SET (security_invoker = off, security_barrier = true);


-- ─────────────────────────────────────────────────────────────────────────
-- ⑦ LA TABELLA DELLE FATTURE, RINATA PER SBAGLIO, SE NE VA
-- La 105 l'aveva tolta (fatturazione mai partita). Il ripasso della 030 l'ha
-- ricreata vuota. Si toglie solo se e' ancora vuota: nessun dato si perde.
-- ─────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.business_orders') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.business_orders) THEN
      RAISE NOTICE 'business_orders ha delle righe: la lascio dov''e'' e non tocco niente';
    ELSE
      DROP TABLE public.business_orders;
    END IF;
  END IF;
END $$;


-- ─────────────────────────────────────────────────────────────────────────
-- ⑧ LA MIGRAZIONE CONTROLLA DA SOLA DI AVER FATTO IL SUO LAVORO
-- Se uno di questi controlli fallisce, la migrazione si ferma e non viene
-- registrata come applicata: meglio un rosso subito che un verde finto.
-- ─────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_porte text;
BEGIN
  SELECT string_agg(tablename || '.' || policyname, ', ') INTO v_porte
    FROM pg_policies
   WHERE schemaname = 'public'
     AND (tablename, policyname) IN (
       ('coupons', 'Anyone can read active coupons'),
       ('zone_codes', 'zone_codes_public_read'),
       ('group_participants', 'Anyone reads participants'),
       ('store_reviews', 'Anyone can read store reviews'),
       ('sponsored_listings', 'sponsored_listings_public_read'),
       ('sponsored_listings', 'sponsored_listings_owner_rw'),
       ('profiles', 'Riders can view buyer of assigned orders'),
       ('profiles', 'Anyone can view approved seller profiles'),
       ('profiles', 'Public profile read'),
       ('messages', 'messages_update_read'),
       ('newsletter_subscribers', 'Anyone can subscribe'),
       ('product_views', 'pv_insert_any'),
       ('group_orders', 'Anyone reads group orders'),
       ('rider_reviews', 'Anyone can read rider reviews'),
       ('event_rsvps', 'event_rsvps_public_count_read'),
       ('shop_of_month_votes', 'shop_of_month_votes_public_read'),
       ('subscription_orders', 'subscription_orders_owner_rw')
     );
  IF v_porte IS NOT NULL THEN
    RAISE EXCEPTION '161: restano aperte queste regole: %', v_porte;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname = 'storage' AND tablename = 'objects'
                AND policyname = 'stories insert authenticated') THEN
    RAISE EXCEPTION '161: resta aperta la regola «stories insert authenticated» sulle foto';
  END IF;

  IF pg_get_constraintdef((SELECT oid FROM pg_constraint
                            WHERE conname = 'orders_rider_payout_status_check'
                              AND conrelid = 'public.orders'::regclass)) NOT LIKE '%HELD%' THEN
    RAISE EXCEPTION '161: il vincolo sul compenso del fattorino non ammette ancora HELD';
  END IF;

  IF (SELECT prosrc FROM pg_proc WHERE oid = 'public.handle_new_user()'::regprocedure)
     NOT LIKE '%''pending''%' THEN
    RAISE EXCEPTION '161: la funzione che crea il profilo non mette ancora «in attesa»';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- 127 — I difetti minori della radiografia del 21 agosto, lato database.
--
-- Ogni blocco è idempotente: si può riapplicare senza fare danni.
-- ============================================================================

-- ── ① Due guardiani identici sulla stessa tabella ───────────────────────────
--
-- La migrazione 061 aveva creato `trg_enforce_profile_update` su
-- `public.profiles`. La 119 ha riscritto la funzione e creato un trigger con un
-- nome NUOVO, `trg_enforce_profile_update_rules`, ma ha fatto il DROP solo del
-- nome nuovo. Risultato: due trigger BEFORE UPDATE sulla stessa tabella che
-- chiamano la stessa funzione, quindi la regola gira due volte a ogni
-- salvataggio di un profilo.
--
-- Non è un buco di sicurezza — la regola è la stessa, e applicarla due volte dà
-- lo stesso esito. È lavoro pagato due volte su una tabella che si scrive
-- spesso, ed è soprattutto una trappola: chi domani cambia la regola e cerca
-- «il trigger» ne trova due, e non sa quale sta guardando.
DROP TRIGGER IF EXISTS trg_enforce_profile_update ON public.profiles;

-- ── ② Nove tabelle di servizio lasciavano ad «anon» il permesso di svuotarle ─
--
-- Supabase, su ogni tabella nuova, concede in automatico ad `anon` e a
-- `authenticated` tutti i permessi: SELECT, INSERT, UPDATE, DELETE, TRUNCATE.
-- Su queste nove la revoca non è mai stata fatta. Le regole per riga sono
-- accese e non c'è nessuna regola scritta, quindi oggi non passa niente — ma
-- si regge su una sola difesa: basta che qualcuno domani scriva una regola
-- permissiva «per far funzionare una cosa» e il permesso sottostante è già lì.
--
-- `FORCE ROW LEVEL SECURITY` fa valere le regole anche per il proprietario
-- della tabella: senza, chi si collega come proprietario le scavalca comunque.
DO $$
DECLARE
  t text;
  tabelle text[] := ARRAY[
    'stripe_event_log', 'email_queue', 'merchants_leads', 'kpi_snapshots',
    'cron_heartbeats', 'operational_alert_log', 'outreach_events',
    'telegram_chats', 'uptime_checks'
  ];
BEGIN
  FOREACH t IN ARRAY tabelle LOOP
    -- Non tutte esistono in ogni ambiente: alcune sono nate fuori dalle
    -- migrazioni e vivono solo in produzione. Si salta quello che non c'è
    -- invece di far fallire l'intera migrazione.
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated;', t);
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
      EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY;', t);
    END IF;
  END LOOP;
END $$;

-- ── ③ Le viste: la scelta diventa esplicita, non un'assenza ────────────────
--
-- Sei viste su sette giravano coi poteri del proprietario (`security_invoker`
-- non impostato, che in PostgreSQL vuol dire «off»): leggono le tabelle sotto
-- scavalcando le regole per riga.
--
-- NON le converto tutte, e il motivo è misurabile: `public.profiles` non ha
-- nessuna regola di lettura per gli anonimi. Con l'invoker acceso,
-- `seller_public_profiles` restituirebbe zero righe a chi non ha fatto
-- l'accesso — cioè la vetrina del marketplace diventerebbe vuota per tutti i
-- visitatori. Lo stesso vale per `live_activity_public`, che legge `orders`.
--
-- Quello che si può fare adesso senza rompere niente è togliere l'ambiguità:
-- oggi «definer» è un'ASSENZA (nessuno l'ha scelto), e un'assenza non si
-- distingue da una dimenticanza. Qui diventa una scelta scritta, con accanto
-- il filtro che difende la vista al posto delle regole per riga.
--
-- Il passo successivo — regole di lettura mirate su `profiles` e `orders` per
-- gli anonimi, e poi l'invoker — è un lavoro a sé, che va verificato sulle
-- pagine vere con dati veri. Non si fa alla cieca da qui.
DO $$
DECLARE
  v record;
BEGIN
  FOR v IN
    SELECT unnest(ARRAY[
      'live_activity_public', 'ordini_disponibili_rider', 'rider_reviews_ricevute',
      'seller_public_profiles', 'sponsored_active_public'
    ]) AS nome
  LOOP
    IF to_regclass('public.' || v.nome) IS NOT NULL THEN
      EXECUTE format('ALTER VIEW public.%I SET (security_invoker = off);', v.nome);
    END IF;
  END LOOP;
END $$;

COMMENT ON VIEW public.seller_public_profiles IS
  'DEFINER PER SCELTA (22/8/2026). Legge public.profiles scavalcando le regole per riga. '
  'Si difende col filtro scritto dentro la vista: solo venditori approvati, solo colonne '
  'pubbliche. Non si può convertire a invoker finché `profiles` non ha una regola di '
  'lettura per gli anonimi: senza, la vetrina resterebbe vuota per chi non ha fatto '
  'l accesso.';

COMMENT ON VIEW public.live_activity_public IS
  'DEFINER PER SCELTA (22/8/2026). Legge public.orders scavalcando le regole per riga. '
  'Si difende col filtro dentro la vista: niente identificativi, solo il fatto che un '
  'ordine e successo. Convertirla a invoker richiede prima una regola di lettura mirata '
  'su `orders` per gli anonimi.';

COMMENT ON VIEW public.ordini_disponibili_rider IS
  'DEFINER PER SCELTA (22/8/2026). La bacheca dei fattorini: mostra gli ordini liberi a '
  'chi ha il ruolo rider. Il filtro sta dentro la vista.';

COMMENT ON VIEW public.rider_reviews_ricevute IS
  'DEFINER PER SCELTA (22/8/2026). Le recensioni ricevute da un fattorino, senza il nome '
  'di chi le ha scritte. Il filtro sta dentro la vista.';

COMMENT ON VIEW public.sponsored_active_public IS
  'DEFINER PER SCELTA (22/8/2026). Solo le sponsorizzazioni attive e pagate. Il filtro '
  'sta dentro la vista.';

-- ── ④ auth.uid() chiamato una volta per RIGA invece che una volta sola ─────
--
-- Dentro una regola per riga, `auth.uid()` scritto nudo viene rivalutato per
-- OGNI riga che il database esamina. Avvolto in `(SELECT auth.uid())` diventa
-- un sotto-programma costante: PostgreSQL lo calcola una volta e riusa il
-- risultato.
--
-- Su una tabella con dieci righe non si vede. Su `wallet_ledger` o su `follows`,
-- che crescono con gli ordini e con le persone, è una moltiplicazione: mille
-- righe esaminate sono mille chiamate identiche.
--
-- Questo blocco non riscrive le regole a mano: le rilegge dal database, mette
-- a posto la forma e le ricrea uguali. Così vale anche per quelle che
-- qualcuno scriverà domani senza saperlo, se la migrazione viene rilanciata.
DO $$
DECLARE
  p record;
  nuovo_qual text;
  nuovo_check text;
  ruoli text;
  sql text;
BEGIN
  FOR p IN
    SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
      AND ( replace(coalesce(qual, ''),       '( SELECT auth.uid() AS uid)', '#') LIKE '%auth.uid()%'
         OR replace(coalesce(with_check, ''), '( SELECT auth.uid() AS uid)', '#') LIKE '%auth.uid()%' )
  LOOP
    -- Si sostituisce solo la forma nuda. Quella già avvolta è protetta
    -- mettendola da parte con un segnaposto e rimettendola alla fine: senza,
    -- una seconda passata produrrebbe `(SELECT (SELECT auth.uid()))`.
    nuovo_qual := replace(
      replace(
        replace(coalesce(p.qual, ''), '( SELECT auth.uid() AS uid)', '@@GIA@@'),
        'auth.uid()', '(SELECT auth.uid())'
      ),
      '@@GIA@@', '( SELECT auth.uid() AS uid)'
    );
    nuovo_check := replace(
      replace(
        replace(coalesce(p.with_check, ''), '( SELECT auth.uid() AS uid)', '@@GIA@@'),
        'auth.uid()', '(SELECT auth.uid())'
      ),
      '@@GIA@@', '( SELECT auth.uid() AS uid)'
    );

    ruoli := array_to_string(p.roles, ', ');

    sql := format('DROP POLICY IF EXISTS %I ON public.%I;', p.policyname, p.tablename);
    EXECUTE sql;

    sql := format(
      'CREATE POLICY %I ON public.%I AS %s FOR %s TO %s',
      p.policyname, p.tablename,
      CASE WHEN p.permissive = 'PERMISSIVE' THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END,
      p.cmd, ruoli
    );
    IF nuovo_qual <> '' THEN
      sql := sql || format(' USING (%s)', nuovo_qual);
    END IF;
    IF nuovo_check <> '' THEN
      sql := sql || format(' WITH CHECK (%s)', nuovo_check);
    END IF;
    EXECUTE sql || ';';
  END LOOP;
END $$;

-- ── ⑤ Quattro regole di lettura duplicate sui prodotti ────────────────────
--
-- `products` aveva dieci regole, e due coppie dicevano la stessa identica cosa
-- con nomi diversi: «Admin sees all products» = «Admins can read all products»,
-- «Seller sees own products» = «Sellers can view their own products».
--
-- Le regole permissive si sommano con OR: il database le valuta TUTTE per ogni
-- riga letta, anche quando la prima ha già detto sì. Due doppioni su una
-- tabella letta a ogni pagina del catalogo sono lavoro pagato due volte.
--
-- Si tengono i nomi più recenti (al plurale), che sono quelli allineati alle
-- altre regole della stessa tabella.
DROP POLICY IF EXISTS "Admin sees all products" ON public.products;
DROP POLICY IF EXISTS "Seller sees own products" ON public.products;

-- ── ⑥ Nove chiavi esterne senza indice ────────────────────────────────────
--
-- Una chiave esterna senza indice costa due volte. In lettura: ogni ricerca
-- «dammi tutti i tentativi di pagamento di questa persona» scorre la tabella
-- intera. In scrittura, peggio: quando si cancella una riga dalla tabella
-- puntata, PostgreSQL deve controllare che nessuno la stia ancora puntando —
-- e senza indice quel controllo è una scansione completa, con un lock addosso.
--
-- Le tabelle oggi sono piccole e non si vede. Si vedrà tutto insieme il giorno
-- in cui non lo sono, ed è il giorno peggiore per accorgersene.
--
-- Qui NON si usa CONCURRENTLY: dentro una migrazione che gira in transazione
-- non è ammesso, e su tabelle di queste dimensioni il lock dura millisecondi.
-- Il giorno in cui una di queste tabelle sarà grande, l'indice ci sarà già.
CREATE INDEX IF NOT EXISTS payment_attempts_user_idx           ON public.payment_attempts (user_id);
CREATE INDEX IF NOT EXISTS payment_attempts_pending_idx        ON public.payment_attempts (pending_checkout_id);
CREATE INDEX IF NOT EXISTS order_items_variant_idx             ON public.order_items (variant_id);
CREATE INDEX IF NOT EXISTS review_helpful_user_idx             ON public.review_helpful (user_id);
CREATE INDEX IF NOT EXISTS cod_reconciliations_remitted_by_idx ON public.cod_reconciliations (remitted_by);
CREATE INDEX IF NOT EXISTS segnalazioni_segnalante_idx         ON public.segnalazioni (segnalante_id);
CREATE INDEX IF NOT EXISTS segnalazioni_deciso_da_idx          ON public.segnalazioni (deciso_da);

DO $$
BEGIN
  IF to_regclass('public.cms_pages') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS cms_pages_updated_by_idx ON public.cms_pages (updated_by);
  END IF;
  IF to_regclass('public.site_settings') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS site_settings_updated_by_idx ON public.site_settings (updated_by);
  END IF;
END $$;

-- ── ⑦ Tre vincoli aggiunti e mai validati ─────────────────────────────────
--
-- `ADD CONSTRAINT ... NOT VALID` fa valere la regola sulle righe NUOVE e lascia
-- stare quelle già presenti. È la forma giusta su una tabella grande, dove
-- validare significherebbe leggerla tutta con un lock. Ma poi la validazione va
-- fatta, e qui non era mai stata fatta.
--
-- Il risultato: il vincolo esiste, il cruscotto lo mostra, e nessuno sa se le
-- righe vecchie lo rispettano. Un vincolo che non sai se vale è peggio di un
-- vincolo che non c'è, perché ti fa smettere di controllare.
--
-- Adesso è il momento giusto proprio perché le tabelle sono quasi vuote: la
-- validazione prende un lock leggero e non riscrive niente.
DO $$
DECLARE
  v record;
BEGIN
  FOR v IN
    SELECT c.conname, c.conrelid::regclass AS tabella
    FROM pg_constraint c
    WHERE c.conname IN (
            'orders_rider_fee_cents_ragionevole',
            'chk_approvazione_coerente',
            'chk_reward_amount_ragionevole'
          )
      AND NOT c.convalidated
  LOOP
    EXECUTE format('ALTER TABLE %s VALIDATE CONSTRAINT %I;', v.tabella, v.conname);
  END LOOP;
END $$;

-- ── ⑧ Un rimborso più grande dell'incasso ─────────────────────────────────
--
-- Sul totale dell'ordine non c'era niente che impedisse a `refunded_amount_cents`
-- di superare quello che il cliente ha davvero pagato. Nessun percorso del
-- codice lo fa oggi — ma «nessun percorso lo fa» vale finché qualcuno non
-- scrive il percorso, e sui soldi la difesa deve stare nel database, dove
-- nessuna strada la può aggirare.
--
-- Validabili subito: in tabella c'è pochissimo, e i valori rispettano già la
-- regola.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_lordo_non_negativo') THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_lordo_non_negativo
      CHECK (gross_total_cents IS NULL OR gross_total_cents >= 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_rimborso_non_negativo') THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_rimborso_non_negativo
      CHECK (refunded_amount_cents IS NULL OR refunded_amount_cents >= 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_rimborso_entro_lordo') THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_rimborso_entro_lordo
      CHECK (
        gross_total_cents IS NULL
        OR refunded_amount_cents IS NULL
        OR refunded_amount_cents <= gross_total_cents
      );
  END IF;
END $$;

-- ── ⑨ Il venditore poteva scrivere la posizione GPS del fattorino ─────────
--
-- La lista dei campi che un client può toccare comprende `rider_lat`,
-- `rider_lng`, `rider_position_updated_at`, `accepted_at` e `ready_at` — ma i
-- controlli aggiuntivi riguardavano solo `rider_id` e `delivery_status`. Per
-- quegli altri cinque campi non c'era nessun controllo su CHI scrive.
--
-- La regola di lettura del venditore («posso aggiornare gli ordini del mio
-- negozio») non ha un WITH CHECK, quindi il venditore poteva aggiornare
-- qualunque proprio ordine — compresa la posizione del fattorino, che il
-- cliente vede sulla mappa in tempo reale mentre aspetta.
--
-- Non è un furto di soldi: è una mappa che mente. Il cliente vede il fattorino
-- dove non è, e la fiducia in quella mappa è tutto quello che gli chiediamo
-- mentre aspetta.
--
-- Adesso: la posizione la scrive solo il fattorino assegnato; gli orari di
-- accettazione e di pronto solo il negoziante di quell'ordine.
CREATE OR REPLACE FUNCTION public.enforce_order_update_rules()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := (SELECT auth.uid());
  is_priv boolean := public.is_admin()
    OR coalesce((SELECT auth.jwt() ->> 'role'), '') = 'service_role'
    OR coalesce(current_setting('mycity.allow_order_write', true), '') = '1';
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

-- ── ⑩ Il permesso alzato prima di sapere se chi chiede ne ha diritto ──────
--
-- `PERFORM set_config('mycity.allow_order_write', '1', true)` è la chiave che
-- fa scavalcare la guardia sugli ordini. Stava sulla PRIMA riga di queste
-- funzioni, prima di ogni controllo: la chiave veniva alzata anche per chi
-- poi veniva respinto («non sei il fattorino di questo ordine», «l'ordine non
-- esiste»).
--
-- Non c'era una fuga: la chiave dura quanto la transazione e la funzione esce
-- subito dopo. Ma è un ordine di operazioni sbagliato — si apre la porta e poi
-- si guarda chi ha suonato — e il giorno in cui qualcuno aggiunge una riga fra
-- il set_config e il primo RETURN, quella riga gira con la guardia spenta.
--
-- Adesso la chiave si alza subito prima del primo UPDATE, cioè dopo che tutti
-- i motivi di rifiuto sono passati.
--
-- ⑪ E il blocco dopo cinque tentativi non contava niente.
--
-- `IF stored_code IS NULL OR stored_code IS DISTINCT FROM …` mescolava due
-- casi diversi: «il codice non è mai stato emesso» e «il codice è sbagliato».
-- Nel primo caso non esiste nessuna riga da aggiornare, quindi l'UPDATE che
-- incrementa i tentativi non tocca niente: il contatore resta a zero e si può
-- provare all'infinito senza che il blocco a cinque scatti mai.
--
-- E la riga dei codici si leggeva senza `FOR UPDATE`: due tentativi partiti
-- nello stesso istante leggevano tutti e due `attempts = 3` e scrivevano tutti
-- e due `4`. Contando così, cinque tentativi simultanei valgono uno.
CREATE OR REPLACE FUNCTION public.verify_delivery_code(p_order_id uuid, p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE stored_code text; current_status text; can_verify boolean; v_seller_id uuid; v_buyer_id uuid;
        v_attempts int; v_locked timestamptz;
BEGIN
  IF p_code IS NULL OR btrim(p_code) = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'WRONG_CODE');
  END IF;

  SELECT (rider_id = (SELECT auth.uid()) AND delivery_status IN ('PICKED_UP', 'OUT_FOR_DELIVERY')),
         seller_id, user_id, delivery_status
  INTO can_verify, v_seller_id, v_buyer_id, current_status
  FROM public.orders WHERE id = p_order_id;
  IF v_seller_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'ORDER_NOT_FOUND'); END IF;
  IF can_verify IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'WRONG_STATUS', 'status', current_status);
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

CREATE OR REPLACE FUNCTION public.verify_pickup_code(p_order_id uuid, p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE stored_code text; current_status text; is_assigned boolean; v_seller_id uuid; v_buyer_id uuid;
        v_attempts int; v_locked timestamptz;
BEGIN
  IF p_code IS NULL OR btrim(p_code) = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'WRONG_CODE');
  END IF;

  SELECT (rider_id = (SELECT auth.uid()) AND delivery_status = 'ASSIGNED'),
         seller_id, user_id, delivery_status
  INTO is_assigned, v_seller_id, v_buyer_id, current_status
  FROM public.orders WHERE id = p_order_id;
  IF v_seller_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'ORDER_NOT_FOUND'); END IF;
  IF is_assigned IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NOT_ASSIGNED_OR_WRONG_STATUS', 'status', current_status);
  END IF;

  SELECT code, attempts, locked_until INTO stored_code, v_attempts, v_locked
  FROM public.order_pickup_codes WHERE order_id = p_order_id FOR UPDATE;

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
    UPDATE public.order_pickup_codes
      SET attempts = attempts + 1,
          locked_until = CASE WHEN attempts + 1 >= 5 THEN now() + interval '15 minutes' ELSE locked_until END
      WHERE order_id = p_order_id;
    IF v_attempts + 1 >= 5 THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'LOCKED');
    END IF;
    RETURN jsonb_build_object('ok', false, 'reason', 'WRONG_CODE');
  END IF;

  PERFORM set_config('mycity.allow_order_write', '1', true);

  UPDATE public.order_pickup_codes SET verified_at = now(), attempts = 0, locked_until = NULL
    WHERE order_id = p_order_id;
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
$function$;

-- ── ⑫ Due depositi di file pubblici, senza regole e senza limiti ──────────
--
-- I depositi «avatars» e «stores» sono pubblici, non hanno un tetto di
-- dimensione, non hanno una lista di tipi ammessi e non li usa nessuna pagina.
-- Sono vuoti: zero oggetti in tutti e due.
--
-- Cancellarli sarebbe più pulito, ma è distruttivo e la firma è di Nicola.
-- Quello che si può fare adesso, senza chiedere niente e senza rischiare
-- niente, è togliergli la possibilità di fare danno: chiusi al pubblico, tetto
-- di 10 MB, solo immagini — le stesse impostazioni che ha già `products`.
--
-- Un deposito aperto e vuoto è un deposito che qualcuno prima o poi riempie:
-- il caricamento libero di file è la strada più corta per farsi ospitare
-- qualunque cosa a spese nostre.
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NULL THEN
    RAISE NOTICE 'storage.buckets non esiste qui (database locale senza Supabase): salto.';
    RETURN;
  END IF;

  UPDATE storage.buckets
     SET public = false,
         file_size_limit = 10 * 1024 * 1024,
         allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']
   WHERE id IN ('avatars', 'stores');
END $$;

-- ── ⑬ Il tasso di autorizzazione era strutturalmente sbagliato ────────────
--
-- L'idea era giusta: lo stesso evento Stripe può arrivare più volte, e non
-- deve gonfiare il conto. Ma la chiave scelta era `(payment_intent_id, status)`,
-- e quella non identifica un evento: identifica un pagamento.
--
-- Una carta rifiutata tre volte di fila — fondi insufficienti, poi 3D Secure
-- non completato, poi rifiuto dell'emittente — è LO STESSO PaymentIntent con
-- tre rifiuti diversi. Il vincolo ne teneva uno e buttava via gli altri due in
-- silenzio (23505 è trattato come idempotenza, non come guasto).
--
-- Quindi il tasso di autorizzazione era falso per costruzione, e sempre nella
-- stessa direzione: migliore di quello vero. Il numero che serve a capire se
-- stiamo perdendo vendite alla cassa era truccato al rialzo.
--
-- Adesso la chiave è l'evento: `stripe_event_id`, che Stripe garantisce unico
-- per ogni consegna. Le righe già presenti restano; per loro la colonna è
-- vuota e l'indice unico le ignora (in PostgreSQL i NULL non collidono fra
-- loro).
ALTER TABLE public.payment_attempts
  ADD COLUMN IF NOT EXISTS stripe_event_id text;

DROP INDEX IF EXISTS public.payment_attempts_intent_status_uidx;

CREATE UNIQUE INDEX IF NOT EXISTS payment_attempts_event_uidx
  ON public.payment_attempts (stripe_event_id)
  WHERE stripe_event_id IS NOT NULL;

-- L'indice non unico resta utile: «tutti i tentativi di questo pagamento» è
-- la domanda che si fa davvero guardando un ordine che non è andato a buon fine.
CREATE INDEX IF NOT EXISTS payment_attempts_intent_idx
  ON public.payment_attempts (payment_intent_id, created_at DESC);

COMMENT ON COLUMN public.payment_attempts.stripe_event_id IS
  'L identificativo dell EVENTO Stripe, non del pagamento. E la chiave di '
  'deduplicazione giusta: lo stesso pagamento puo avere piu rifiuti diversi, e '
  'contarne uno solo falsava il tasso di autorizzazione verso l alto.';

-- ── ⑭ La cassa contava due giorni diversi ─────────────────────────────────
--
-- Il fattorino quadra la sua giornata sul giorno di PIACENZA: quella riga era
-- già stata sistemata (`giornoLocale`). Ma la conferma dell'amministratore,
-- che è quella che sblocca il pagamento al negozio, lavorava ancora sul giorno
-- di GREENWICH.
--
-- D'estate l'Italia è due ore avanti. Una consegna delle 23:30 del 15 luglio a
-- Piacenza è l'1:30 del 16 a Greenwich: il fattorino la conta nel 15, la
-- conferma la cerca nel 16, e non la trova. Quell'ordine resta appeso — il
-- negozio non viene pagato — e nessuno dei due capisce perché, perché tutti e
-- due stanno guardando il «15 luglio».
--
-- Succede solo nelle sere cariche, che sono quelle che contano.
CREATE OR REPLACE FUNCTION public.confirm_cod_remittance(p_rider uuid, p_date date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
     AND (delivered_at AT TIME ZONE 'Europe/Rome')::date = p_date
     AND cash_confirmed_at IS NULL;

  UPDATE public.orders
    SET payout_status = 'HELD'
  WHERE rider_id = p_rider
    AND payment_method = 'cod'
    AND delivery_status = 'DELIVERED'
    AND payout_status = 'AWAITING_REMITTANCE'
    AND cash_confirmed_at IS NOT NULL
    AND (delivered_at AT TIME ZONE 'Europe/Rome')::date = p_date;
  GET DIAGNOSTICS v_released = ROW_COUNT;

  INSERT INTO public.cod_reconciliations (rider_id, for_date, remitted_at, remitted_by)
  VALUES (p_rider, p_date, now(), (SELECT auth.uid()))
  ON CONFLICT (rider_id, for_date)
  DO UPDATE SET remitted_at = now(), remitted_by = (SELECT auth.uid());

  RETURN jsonb_build_object('rilasciati', v_released, 'saltati_senza_incasso', v_saltati);
END;
$function$;

-- ── ⑮ Le categorie mostrate e quelle registrate non coincidevano ──────────
--
-- Il banner mostra quattro categorie — necessari, funzionali, statistiche,
-- marketing — e ne registra due. Il vincolo sulla tabella non ammetteva
-- nemmeno il valore 'functional', quindi non era una dimenticanza rimediabile
-- a metà: la categoria non aveva proprio dove andare.
--
-- Il giorno in cui qualcuno chiede «dimostrate che vi aveva detto di sì», per
-- i cookie funzionali non c'è niente da mostrare — pur avendoglielo chiesto.
ALTER TABLE public.consent_log
  DROP CONSTRAINT IF EXISTS consent_log_categoria_check;

ALTER TABLE public.consent_log
  ADD CONSTRAINT consent_log_categoria_check
  CHECK (categoria IN ('necessari', 'functional', 'analytics', 'marketing', 'privacy_terms'));

-- ── ⑯ Il fattorino vedeva i recapiti di ogni consegna, per sempre ─────────
--
-- La regola era `rider_id = auth.uid()`: senza limite di tempo e senza limite
-- di stato. Un fattorino che ha lavorato sei mesi si porta dietro nome,
-- telefono e indirizzo di ogni cliente che ha servito, e continua a poterli
-- leggere anche dopo aver smesso di lavorare con noi.
--
-- Non è un buco: è la regola scritta male. Il fattorino quei dati DEVE averli
-- mentre consegna, e per un po' dopo — un cliente che chiama il giorno dopo
-- per una consegna sbagliata va potuto ritrovare. Non gli servono a novembre
-- quelli di maggio.
--
-- Adesso: gli ordini aperti sempre, i consegnati per sette giorni. Lo storico
-- dei compensi — che è quello per cui il fattorino apre davvero quella pagina —
-- lo serve una vista senza recapiti.
DROP POLICY IF EXISTS "Riders can view available and own orders" ON public.orders;

CREATE POLICY "Riders can view available and own orders"
  ON public.orders
  FOR SELECT
  TO authenticated
  USING (
    rider_id = (SELECT auth.uid())
    AND (
      delivery_status <> 'DELIVERED'
      OR delivered_at IS NULL
      OR delivered_at > now() - interval '7 days'
    )
  );

-- Lo storico dei compensi, senza un solo recapito.
--
-- Il fattorino apre quella pagina per una domanda sola: quanto ho guadagnato.
-- Per rispondere non serve sapere dove abita chi ha ordinato. Resta la città,
-- che è un'informazione grossa e serve a riconoscere il giro.
CREATE OR REPLACE VIEW public.rider_consegne_storico AS
SELECT
  o.id,
  o.rider_id,
  o.delivered_at,
  o.delivery_status,
  o.payment_method,
  o.shipping_cost,
  o.rider_fee_cents,
  o.total_price,
  o.delivery_city
FROM public.orders o
WHERE o.rider_id = (SELECT auth.uid())
  AND o.delivery_status = 'DELIVERED';

ALTER VIEW public.rider_consegne_storico SET (security_invoker = off);

COMMENT ON VIEW public.rider_consegne_storico IS
  'DEFINER PER SCELTA (22/8/2026). Lo storico dei compensi del fattorino, senza '
  'nome, telefono e indirizzo dei clienti. Il filtro `rider_id = auth.uid()` sta '
  'dentro la vista: ogni fattorino vede solo le proprie consegne. Serve a far '
  'restringere la regola su `orders` — che dava i recapiti di ogni consegna per '
  'sempre — senza togliere al fattorino il conto di quello che ha guadagnato.';

GRANT SELECT ON public.rider_consegne_storico TO authenticated;

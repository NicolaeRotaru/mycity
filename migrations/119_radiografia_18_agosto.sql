-- =============================================================================
-- 119 — Le riparazioni di database della radiografia del 18 agosto
-- =============================================================================
-- Un file solo perché sono tutte della stessa famiglia: cose che il database
-- lasciava decidere al browser, o che il browser poteva scrivere e non doveva.
--
-- Difetti chiusi qui (numerazione del referto consegne/audit/2026-08-18-radiografia.md):
--   027 il cliente può scriversi il credito MyCity
--   014 il premio invito lo decide il browser
--   016 un fattorino approvato può vendere prodotti
--   010 due colonne per l'approvazione, senza vincolo che le tenga d'accordo
--   028 (parziale) la divergenza fra le due colonne dell'approvazione non può più
--       nascere: il vincolo la impedisce. Rimettere in piedi chi la bonifica della
--       114 ha rimesso in attesa resta un'azione dal pannello admin, non da qui.
--   022/033 il secchio «stories» accetta caricamenti nella cartella di un altro
--   023/039 chi vota e chi partecipa a un evento è un elenco pubblico
--   029 il pannello dei codici sconto non legge più i codici
--   030 chi partecipa a una chat può spostarla nella posta di un altro
--   034 la chiusura dei privilegi di default dimentica `authenticated`
--   036 la vista public_profiles espone i venditori non approvati
--   037 product_views non ha policy di lettura: le statistiche restano a zero
--   038 subscription_orders: il venditore sottoscrive per il cliente
--   (040 spostato nella 120: cambia la FORMA di una vista che la home legge,
--    quindi va applicato solo dopo che il codice nuovo e' in produzione)
--   041 il tetto anti-gonfiaggio si può usare per azzerare le visite di un rivale
--   042 il mittente riscrive un messaggio già letto senza lasciare traccia
--   044 group_participants porta due policy di lettura identiche
--   049/061 lo storno del compenso rider viola il vincolo e non si accumula
--   070 le notifiche promozionali nascono accese
--   077 il registro dei consensi accumula indirizzi IP senza scadenza
--   079 i documenti di chi viene respinto non si cancellano mai
--   182 la coda delle email ritenta all'infinito
--   186 il controllo anti-doppione sui resi non è atomico
--   191 un lavoro AI pagato può sparire senza traccia
--   051 il rimborso si accumula senza atomicità: doppio rimborso reale possibile
--   048 uno storno fallito sparisce dai conti
--   062 due consegne dello stesso evento Stripe vengono processate entrambe
--   059 una rotazione di chiave emette una seconda gift card sullo stesso pagamento
--   050/173 il reclamo interno tocca il flag del chargeback bancario
--   094 mancano gli indici sulle tre interrogazioni piu' frequenti
--   097 due indici identici sulla tabella che riceve piu' scritture
--   098 le visite ai prodotti crescono senza fine
--
-- Idempotente: si può rilanciare senza rompere niente. E non è una promessa
-- scritta a fiducia — l'ho verificata rilanciandola due volte su un Postgres
-- vero. Al primo giro NON lo era: tre policy nascevano senza il loro
-- «cancella se c'è», e la seconda esecuzione moriva lì. Una migrazione che si
-- rompe al secondo colpo è proprio quella che serve quando la prima si è
-- fermata a metà.
-- 🔴 Applicarla al database di produzione resta una firma di Nicola.
-- =============================================================================

BEGIN;

-- =========================================================
-- 027 — I SOLDI DEL CLIENTE NON LI SCRIVE IL CLIENTE
-- =========================================================
-- `profiles` aveva una policy UPDATE su tutta la riga e un trigger che vietava
-- una LISTA DI CAMPI. Ogni colonna nuova nasceva quindi scrivibile dal browser,
-- e `wallet_balance_cents` (migrazione 087) è nata così: con la chiave pubblica
-- si poteva alzare il proprio credito e poi spenderlo in un ordine in contanti.
--
-- Qui si gira il verso, come la 114 ha fatto su `orders`: si dichiara cosa una
-- persona PUÒ cambiare del proprio profilo, e tutto il resto è chiuso — comprese
-- le colonne che nasceranno domani.
CREATE OR REPLACE FUNCTION public.enforce_profile_update_rules()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_priv boolean := public.is_admin()
    OR coalesce((SELECT auth.jwt() ->> 'role'), '') = 'service_role'
    OR coalesce(current_setting('mycity.allow_profile_write', true), '') = '1';
  -- Tutto quello che una persona ha il diritto di cambiare di sé: recapiti,
  -- vetrina del negozio, preferenze, disponibilità del fattorino, dati fiscali
  -- propri. Chi aggiunge una colonna nuova e vuole renderla modificabile la
  -- mette qui, di proposito — è il punto: la scelta diventa visibile.
  consentiti constant text[] := ARRAY[
    'full_name','phone','address','city','zip',
    'public_avatar_url','public_bio','public_handle','public_profile_enabled',
    'email_marketing','notif_promos','notif_groups','notif_newsletter','notif_order_updates',
    'store_name','store_lat','store_lng','store_phone','store_address','store_description',
    'store_logo','store_hours','store_media','store_site','store_customization','offers_express',
    'rider_is_online','rider_zones','rider_schedule',
    'tos_accepted_at','privacy_accepted_at','data_accuracy_confirmed_at',
    'deletion_requested_at','approval_requested_at','approval_status',
    'account_type','business_form','business_legal_name','business_vat_number',
    'business_address','business_city','business_zip',
    'legal_first_name','legal_last_name','legal_birth_date','legal_fiscal_code',
    'legal_residence_addr','legal_residence_city','legal_residence_zip',
    'rider_vehicle_type','rider_vehicle_plate','rider_license_expires_on','rider_insurance_expires_on',
    'billing_card_last','billing_iban',
    'is_approved',   -- lasciato passare qui e governato dalla regola esplicita sotto
    'updated_at'
  ];
BEGIN
  IF is_priv THEN
    RETURN NEW;
  END IF;

  -- Il cuore: se qualcosa è cambiato FUORI dalla lista, si rifiuta.
  IF (to_jsonb(NEW) - consentiti) IS DISTINCT FROM (to_jsonb(OLD) - consentiti) THEN
    RAISE EXCEPTION 'profiles: campo riservato non modificabile' USING ERRCODE = '42501';
  END IF;

  -- `is_approved` resta fuori dalla lista, ma con la stessa apertura di prima:
  -- portarlo a `true` è dello staff, portarlo a `false` (o lasciarlo) no. Senza
  -- questa riga la richiesta di diventare venditore, che scrive is_approved=false,
  -- smetterebbe di funzionare: una riparazione non deve rompere un'altra strada.
  IF NEW.is_approved = true AND OLD.is_approved IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'profiles: approvazione riservata allo staff' USING ERRCODE = '42501';
  END IF;

  -- approval_status è nella lista perché una persona può CHIEDERE l'esame
  -- ('pending'); approvarsi o togliersi la sospensione no.
  IF NEW.approval_status IS DISTINCT FROM OLD.approval_status
     AND coalesce(NEW.approval_status, '') NOT IN ('pending', '') THEN
    RAISE EXCEPTION 'profiles: stato approvazione riservato allo staff' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_profile_update_rules ON public.profiles;
CREATE TRIGGER trg_enforce_profile_update_rules
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_profile_update_rules();

-- =========================================================
-- 010 — LE DUE COLONNE DELL'APPROVAZIONE NON POSSONO DIVERGERE
-- =========================================================
-- `is_approved` (booleano) e `approval_status` (testo) dicono la stessa cosa.
-- Finché sono due, prima o poi una strada ne scrive una sola: il negozio
-- risulta approvato di qua e in attesa di là. Il vincolo lo impedisce nel posto
-- in cui non si può aggirare. Prima si allineano le righe già incoerenti
-- prendendo per buona la colonna testuale, che è quella che scrive il pannello.
-- Misurato sul database vero prima di scrivere: le righe incoerenti sono due, e
-- sono un amministratore e un compratore — nessun negozio, nessun fattorino.
-- Per loro `approval_status` non vuol dire niente: l'approvazione riguarda chi
-- vende e chi consegna. Portarli a `is_approved = false` sarebbe stato il gesto
-- che ha fatto il danno del 14 agosto; qui invece si toglie il valore che non
-- ha senso per quel ruolo, e non si tocca nient'altro.
UPDATE public.profiles
   SET approval_status = NULL
 WHERE approval_status IS NOT NULL
   AND role IS DISTINCT FROM 'seller'
   AND role IS DISTINCT FROM 'rider'
   AND is_approved IS DISTINCT FROM (approval_status = 'approved');

-- Per chi vende o consegna la colonna conta davvero: li' si allinea il booleano
-- allo stato testuale, che e' quello che scrive il pannello. Oggi non ce n'e'
-- nessuno in questa condizione (misurato: zero).
UPDATE public.profiles
   SET is_approved = (approval_status = 'approved')
 WHERE approval_status IS NOT NULL
   AND role IN ('seller', 'rider')
   AND is_approved IS DISTINCT FROM (approval_status = 'approved');

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS chk_approvazione_coerente;
ALTER TABLE public.profiles
  ADD CONSTRAINT chk_approvazione_coerente
  CHECK (approval_status IS NULL OR is_approved = (approval_status = 'approved'))
  NOT VALID;

-- =========================================================
-- 014 — IL PREMIO INVITO LO DECIDE IL SERVER
-- =========================================================
-- `referrals.reward_amount` era scritto dalla pagina di registrazione e poi
-- accreditato tale e quale: chiunque poteva registrarsi con un premio da mille
-- euro e spenderlo. L'importo ora è una costante del database.
DO $$
BEGIN
  IF to_regclass('public.referrals') IS NOT NULL THEN
    EXECUTE 'REVOKE INSERT (reward_amount), UPDATE (reward_amount) ON public.referrals FROM anon, authenticated';
    EXECUTE 'ALTER TABLE public.referrals DROP CONSTRAINT IF EXISTS chk_reward_amount_ragionevole';
    EXECUTE 'ALTER TABLE public.referrals ADD CONSTRAINT chk_reward_amount_ragionevole
             CHECK (reward_amount IS NULL OR (reward_amount >= 0 AND reward_amount <= 20)) NOT VALID';
  END IF;
END $$;

-- Cintura e bretelle: anche se un domani il GRANT tornasse, il valore scritto
-- dal browser viene sovrascritto con quello vero.
CREATE OR REPLACE FUNCTION public.referral_reward_fisso()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  PREMIO_INVITO_EURO constant numeric := 5;
BEGIN
  NEW.reward_amount := PREMIO_INVITO_EURO;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.referrals') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS trg_referral_reward_fisso ON public.referrals';
    EXECUTE 'CREATE TRIGGER trg_referral_reward_fisso
               BEFORE INSERT OR UPDATE ON public.referrals
               FOR EACH ROW EXECUTE FUNCTION public.referral_reward_fisso()';
  END IF;
END $$;

-- =========================================================
-- 016 — UN FATTORINO APPROVATO NON È UN NEGOZIO APPROVATO
-- =========================================================
-- `is_approved` è unico per tre ruoli: approvare un fattorino gli apriva anche
-- la vendita. Le due policy dei prodotti ora chiedono anche il ruolo.
DROP POLICY IF EXISTS "Approved sellers can insert products" ON public.products;
CREATE POLICY "Approved sellers can insert products"
  ON public.products FOR INSERT
  TO authenticated
  WITH CHECK (
    seller_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.profiles p
       WHERE p.id = (SELECT auth.uid())
         AND p.role = 'seller'
         AND p.is_approved = true
    )
  );

DROP POLICY IF EXISTS "Products visible to public if seller approved" ON public.products;
CREATE POLICY "Products visible to public if seller approved"
  ON public.products FOR SELECT
  USING (
    status = 'available'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
       WHERE p.id = products.seller_id
         AND p.role = 'seller'
         AND p.is_approved = true
    )
  );

-- =========================================================
-- 022 + 033 — NEL SECCHIO «STORIES» SI SCRIVE SOLO IN CASA PROPRIA
-- =========================================================
-- La policy chiedeva solo «hai un account». Chiunque poteva caricare un file
-- nella cartella di un altro negozio, e le storie si vedono in home.
-- Stessa forma già usata per `products` nella 114 e per kyc/invoices nella 041.
DROP POLICY IF EXISTS "stories insert authenticated" ON storage.objects;
DROP POLICY IF EXISTS "stories insert owner folder" ON storage.objects;
CREATE POLICY "stories insert owner folder" ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'stories'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  );

DROP POLICY IF EXISTS "stories update owner folder" ON storage.objects;
CREATE POLICY "stories update owner folder" ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'stories'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  );

-- =========================================================
-- 023 + 039 — CHI HA VOTATO NON È UN ELENCO PUBBLICO
-- =========================================================
-- Le due tabelle avevano `FOR SELECT USING (true)`: con la chiave del browser
-- si scaricava nome e nome per nome chi partecipa a un evento e chi ha votato
-- quale negozio. Il numero serve; l'identità no.
DROP POLICY IF EXISTS event_rsvps_public_count_read ON public.event_rsvps;
DROP POLICY IF EXISTS shop_of_month_votes_public_read ON public.shop_of_month_votes;

CREATE OR REPLACE FUNCTION public.event_rsvp_count(p_event_id uuid)
RETURNS int
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)::int FROM public.event_rsvps WHERE event_id = p_event_id;
$$;

CREATE OR REPLACE FUNCTION public.event_rsvp_counts()
RETURNS TABLE (event_id uuid, partecipanti int)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT event_id, count(*)::int FROM public.event_rsvps GROUP BY event_id;
$$;

-- `shop_of_month_votes.month` e' di tipo DATE (migrazione 034), non testo.
-- Dichiararlo `text` faceva fallire il confronto — «operator does not exist:
-- date = text» — e con la migrazione dentro una transazione sola avrebbe fatto
-- annullare TUTTE le trentotto riparazioni. Trovato dalla prova su Postgres
-- prima di toccare la produzione, non dopo.
CREATE OR REPLACE FUNCTION public.shop_of_month_vote_counts(p_month date DEFAULT NULL)
RETURNS TABLE (seller_id uuid, voti int)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT v.seller_id, count(*)::int
    FROM public.shop_of_month_votes v
   WHERE p_month IS NULL OR v.month = p_month
   GROUP BY v.seller_id;
$$;

GRANT EXECUTE ON FUNCTION public.event_rsvp_count(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.event_rsvp_counts() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_of_month_vote_counts(date) TO anon, authenticated;

-- =========================================================
-- 029 — IL PANNELLO DEI CODICI SCONTO TORNA A LEGGERE
-- =========================================================
-- La 114 ha giustamente tolto ad anon e authenticated la lettura di `coupons`
-- (era un elenco scaricabile in blocco). Ma l'ha tolta anche all'admin, che il
-- pannello lo apre dal browser con la sua sessione: da quel giorno
-- /admin/coupons è una pagina vuota che non lo dice.
-- Il permesso torna sulla tabella; a filtrare resta la policy «Admins can
-- manage coupons», che è l'unica rimasta. Per chi non è admin: zero righe.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.coupons TO authenticated;

-- =========================================================
-- 030 — LA CHAT NON SI SPOSTA NELLA POSTA DI UN ALTRO
-- =========================================================
-- La policy di UPDATE su `conversations` valeva per chiunque partecipasse e non
-- aveva WITH CHECK: un venditore poteva riscrivere `buyer_id` e spostare la
-- conversazione — con dentro tutto lo storico — nella casella di un'altra
-- persona. L'unica cosa legittima da aggiornare («l'ho letta») passa già dalla
-- funzione `mark_conversation_read` della 115.
DROP POLICY IF EXISTS "conversations_update_participant" ON public.conversations;
DROP POLICY IF EXISTS "Participants can update conversation" ON public.conversations;
DROP POLICY IF EXISTS "conversations_update" ON public.conversations;
REVOKE UPDATE ON public.conversations FROM anon, authenticated;

-- =========================================================
-- 042 — UN MESSAGGIO GIÀ LETTO NON SI RISCRIVE DI NASCOSTO
-- =========================================================
-- La 115 ha ristretto l'UPDATE al proprio messaggio, che era il buco grosso.
-- Resta che il mittente può cambiare il testo dopo che l'altro l'ha letto, e
-- non se ne accorge nessuno. Non si vieta: si lascia il segno.
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS edited_at timestamptz;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS body_original text;

CREATE OR REPLACE FUNCTION public.messages_traccia_modifica()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.body IS DISTINCT FROM OLD.body THEN
    NEW.edited_at := now();
    NEW.body_original := coalesce(OLD.body_original, OLD.body);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_messages_traccia_modifica ON public.messages;
CREATE TRIGGER trg_messages_traccia_modifica
  BEFORE UPDATE ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.messages_traccia_modifica();

-- =========================================================
-- 034 — I PRIVILEGI DI DEFAULT SI CHIUDONO ANCHE PER `authenticated`
-- =========================================================
-- La 114 li ha chiusi solo per `anon`: ogni tabella o vista nuova continuava a
-- nascere scrivibile da chiunque avesse fatto l'accesso. E la revoca va ripetuta
-- per il ruolo che applica davvero le migrazioni, altrimenti non copre gli
-- oggetti creati da lui.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES ON TABLES FROM anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
             REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES ON TABLES FROM anon, authenticated';
  END IF;
END $$;

-- =========================================================
-- 036 — VIA LA VISTA CHE MOSTRAVA I NEGOZI NON APPROVATI
-- =========================================================
-- `public_profiles` esponeva nome e indirizzo di ogni riga con `role='seller'`,
-- approvata o no: bastava chiederla per leggere l'anagrafica di chi si era
-- appena registrato ed era ancora in esame. Nessuna pagina la legge — il codice
-- usa `seller_public_profiles`, che filtra sull'approvazione.
DROP VIEW IF EXISTS public.public_profiles;

-- =========================================================
-- 037 — LE STATISTICHE DEL NEGOZIANTE TORNANO A CONTARE
-- =========================================================
-- `product_views` ha RLS accesa, policy di INSERT, e nessuna policy di lettura:
-- il negoziante vedeva zero visite su prodotti visitati davvero, e credeva che
-- nessuno guardasse la sua vetrina.
DROP POLICY IF EXISTS pv_select_owner ON public.product_views;
CREATE POLICY pv_select_owner ON public.product_views
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.products p
       WHERE p.id = product_views.product_id
         AND p.seller_id = (SELECT auth.uid())
    )
    OR public.is_admin()
  );

-- Meglio del conteggio riga per riga (che sbatte nel tetto di righe di
-- PostgREST e scarica dati inutili): il conto lo fa il database.
CREATE OR REPLACE FUNCTION public.visite_prodotti_venditore(p_giorni int DEFAULT 30)
RETURNS TABLE (product_id uuid, visite int)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT v.product_id, count(*)::int
    FROM public.product_views v
    JOIN public.products p ON p.id = v.product_id
   WHERE p.seller_id = (SELECT auth.uid())
     AND v.viewed_at > now() - make_interval(days => greatest(p_giorni, 1))
   GROUP BY v.product_id;
$$;

GRANT EXECUTE ON FUNCTION public.visite_prodotti_venditore(int) TO authenticated;

-- =========================================================
-- 041 — IL TETTO ANTI-GONFIAGGIO NON DEVE POTER SPEGNERE IL CONTATORE
-- =========================================================
-- La 117 ha messo un tetto di venti visite anonime al minuto PER PRODOTTO. Letto
-- al contrario è un interruttore: chi vuole azzerare le statistiche di un rivale
-- gli spara venti visite al minuto e da lì in poi quelle vere vengono buttate.
-- Un freno che si può usare per fare il danno che doveva impedire non è un freno.
--
-- Il conto ora si tiene per impronta di sessione (`view_fingerprint`, scritta dal
-- browser): una visita per impronta all'ora. Chi ruota l'impronta può ancora
-- gonfiare — è il male minore già presente prima della 117 — ma nessuno può più
-- SOPPRIMERE le visite di un altro, che è il danno serio.
ALTER TABLE public.product_views ADD COLUMN IF NOT EXISTS view_fingerprint text;
CREATE INDEX IF NOT EXISTS product_views_fingerprint_idx
  ON public.product_views (product_id, view_fingerprint, viewed_at DESC)
  WHERE user_id IS NULL;

CREATE OR REPLACE FUNCTION public.product_views_dedup()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Il tetto vale solo per le visite anonime SENZA impronta: e' la strada che
  -- resta gonfiabile, quindi resta anche protetta. Con l'impronta il conto e'
  -- personale, e nessuno puo' consumare il budget di un altro.
  TETTO_SENZA_IMPRONTA_AL_MINUTO constant int := 20;
  recenti int;
BEGIN
  -- Persona con un account: una visita per prodotto ogni ora (come prima).
  IF NEW.user_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.product_views
       WHERE user_id = NEW.user_id
         AND product_id = NEW.product_id
         AND viewed_at > now() - interval '1 hour'
    ) THEN
      RETURN NULL;
    END IF;
    RETURN NEW;
  END IF;

  -- Visita anonima CON impronta: una per impronta all'ora. Il conto guarda solo
  -- le righe di quella impronta, quindi il traffico di un terzo non puo' far
  -- scartare le visite di nessun altro. E' la riparazione del difetto 041.
  IF coalesce(NEW.view_fingerprint, '') <> '' THEN
    IF EXISTS (
      SELECT 1 FROM public.product_views
       WHERE product_id = NEW.product_id
         AND user_id IS NULL
         AND view_fingerprint = NEW.view_fingerprint
         AND viewed_at > now() - interval '1 hour'
    ) THEN
      RETURN NULL;
    END IF;
    RETURN NEW;
  END IF;

  -- Visita anonima SENZA impronta: qui il tetto della 117 resta, perche' senza
  -- impronta non c'e' altro modo di distinguere mille visite vere da un ciclo.
  -- Toglierlo — come avevo fatto in una prima versione di questa migrazione —
  -- riapriva il gonfiaggio senza limite, e la prova di comportamento
  -- `tests/sql/rls/03-visite-prodotto.test.sql` l'ha visto: 200 su 200 scritte.
  -- Chi manda l'impronta (il browser lo fa) da questo tetto e' comunque immune,
  -- quindi la soppressione che il difetto 041 denunciava non lo tocca piu'.
  SELECT count(*) INTO recenti
    FROM public.product_views
   WHERE product_id = NEW.product_id
     AND user_id IS NULL
     AND coalesce(view_fingerprint, '') = ''
     AND viewed_at > now() - interval '1 minute';

  IF recenti >= TETTO_SENZA_IMPRONTA_AL_MINUTO THEN
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$$;

-- =========================================================
-- 038 — UN ABBONAMENTO LO SOTTOSCRIVE IL CLIENTE, NON IL NEGOZIO
-- =========================================================
-- `FOR ALL USING (user_id = me OR seller_id = me)` senza WITH CHECK: il
-- venditore poteva creare un abbonamento ricorrente a nome di un cliente, e il
-- cliente poteva riscriversi il prezzo. Lo schema oggi non è usato da nessuna
-- pagina: si stringe adesso, prima che qualcuno ci attacchi il codice.
DROP POLICY IF EXISTS subscription_orders_owner_rw ON public.subscription_orders;

DROP POLICY IF EXISTS subscription_orders_read ON public.subscription_orders;
CREATE POLICY subscription_orders_read ON public.subscription_orders
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR seller_id = (SELECT auth.uid()) OR public.is_admin());

DROP POLICY IF EXISTS subscription_orders_insert_own ON public.subscription_orders;
CREATE POLICY subscription_orders_insert_own ON public.subscription_orders
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

-- Il cliente può fermare o riprendere il proprio abbonamento; il prezzo e gli
-- articoli no — quelli li ricalcola il server, come già fa /api/orders/cod.
CREATE OR REPLACE FUNCTION public.subscription_orders_campi_bloccati()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_admin() OR coalesce((SELECT auth.jwt() ->> 'role'), '') = 'service_role' THEN
    RETURN NEW;
  END IF;
  IF NEW.total_cents IS DISTINCT FROM OLD.total_cents
     OR NEW.items IS DISTINCT FROM OLD.items
     OR NEW.seller_id IS DISTINCT FROM OLD.seller_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'subscription_orders: prezzo e articoli li scrive il server'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_subscription_orders_campi_bloccati ON public.subscription_orders;
CREATE TRIGGER trg_subscription_orders_campi_bloccati
  BEFORE UPDATE ON public.subscription_orders
  FOR EACH ROW EXECUTE FUNCTION public.subscription_orders_campi_bloccati();

DROP POLICY IF EXISTS subscription_orders_update_own ON public.subscription_orders;
CREATE POLICY subscription_orders_update_own ON public.subscription_orders
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- =========================================================
-- 044 — UNA SOLA POLICY DI LETTURA SU group_participants
-- =========================================================
-- La 109 e la 114 ne hanno lasciate due identiche. Due policy che dicono la
-- stessa cosa non fanno danno oggi: fanno danno il giorno in cui si corregge
-- quella sbagliata e il buco resta aperto dall'altra.
DROP POLICY IF EXISTS "Group participants readable by self or seller" ON public.group_participants;

-- =========================================================
-- 049 + 061 — LO STORNO DEL COMPENSO AL FATTORINO SI PUÒ SCRIVERE
-- =========================================================
-- Il codice scrive rider_payout_status='REVERSED'; il vincolo della 081 non lo
-- prevede. L'UPDATE viene rifiutato, l'errore ignorato: uno storno che nei conti
-- non esiste. E senza un contatore degli storni non si sa quanto è già rientrato.
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_rider_payout_status_check;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_rider_payout_status_check
  CHECK (rider_payout_status IS NULL OR rider_payout_status IN (
    'PENDING_RIDER_ONBOARDING', 'PROCESSING', 'TRANSFERRED', 'FAILED',
    'REVERSED', 'AWAITING_REMITTANCE'
  ));

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS rider_payout_reversed_cents integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.orders.rider_payout_reversed_cents IS
  'Quanto del compenso rider e gia rientrato. Serve alla chiave di idempotenza dello storno.';

-- =========================================================
-- 070 — LE NOTIFICHE PROMOZIONALI NON NASCONO ACCESE
-- =========================================================
-- `notif_promos boolean NOT NULL DEFAULT true` (migrazione 054): chi si registra
-- si trova iscritto alle promozioni senza averlo chiesto. Il consenso al
-- marketing si dà, non si toglie.
-- Le righe già esistenti NON si toccano: cambiare la scelta di chi c'è già
-- sarebbe l'errore uguale e contrario.
ALTER TABLE public.profiles ALTER COLUMN notif_promos SET DEFAULT false;

-- =========================================================
-- 077 — GLI INDIRIZZI IP DEL REGISTRO CONSENSI HANNO UNA SCADENZA
-- =========================================================
-- `consent_log` è l'unica tabella con dati personali che nessuna pulizia tocca:
-- l'IP resta lì per sempre. La prova del consenso va conservata; l'indirizzo di
-- rete serve solo a dire da dove è arrivato, e dopo un anno non serve più.
CREATE OR REPLACE FUNCTION public.pota_consent_log(p_mesi int DEFAULT 12)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE ripulite int;
BEGIN
  UPDATE public.consent_log
     SET ip = NULL
   WHERE ip IS NOT NULL
     AND created_at < now() - make_interval(months => greatest(p_mesi, 1));
  GET DIAGNOSTICS ripulite = ROW_COUNT;
  RETURN ripulite;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.pota_consent_log(int) FROM anon, authenticated;

-- =========================================================
-- 079 — I DOCUMENTI DI CHI VIENE RESPINTO NON RESTANO PER SEMPRE
-- =========================================================
-- Carta d'identità e selfie di chi non è stato approvato restavano nel database
-- e nello storage senza scadenza. Chi è stato respinto non è un cliente: il
-- documento non ha più una ragione per essere lì.
-- La funzione azzera i riferimenti e restituisce i percorsi dei file, che il
-- cron cancella dallo storage (il database non può parlare con lo storage).
CREATE OR REPLACE FUNCTION public.documenti_da_cancellare_respinti(p_giorni int DEFAULT 90)
RETURNS TABLE (user_id uuid, percorsi text[])
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id,
         array_remove(ARRAY[
           p.kyc_id_doc_front_url, p.kyc_id_doc_back_url, p.kyc_selfie_url,
           p.rider_license_url, p.rider_insurance_url, p.rider_haccp_url
         ], NULL)
    FROM public.profiles p
   WHERE p.approval_status = 'rejected'
     AND p.approved_at IS NOT NULL
     AND p.approved_at < now() - make_interval(days => greatest(p_giorni, 1))
     AND coalesce(p.kyc_id_doc_front_url, p.kyc_id_doc_back_url, p.kyc_selfie_url,
           p.rider_license_url, p.rider_insurance_url, p.rider_haccp_url) IS NOT NULL;
$$;

REVOKE EXECUTE ON FUNCTION public.documenti_da_cancellare_respinti(int) FROM anon, authenticated;

-- =========================================================
-- 182 — LA CODA DELLE EMAIL SMETTE DI RITENTARE ALL'INFINITO
-- =========================================================
-- Su errore l'endpoint rilasciava il claim e basta: nessun contatore, nessuna
-- lettera morta. Un indirizzo che rimbalza per sempre veniva ritentato per
-- sempre, ogni giro, e ogni rimbalzo abbassa la reputazione di chi spedisce —
-- cioè fa finire nello spam anche le conferme d'ordine di tutti gli altri.
ALTER TABLE public.email_queue ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;
ALTER TABLE public.email_queue ADD COLUMN IF NOT EXISTS last_error text;

-- La funzione restituisce anche `attempts`: senza quel numero chi chiama non
-- può sapere a che tentativo è, e il contatore resterebbe sempre a uno.
DROP FUNCTION IF EXISTS public.claim_pending_emails(int);
CREATE OR REPLACE FUNCTION public.claim_pending_emails(p_max int DEFAULT 50)
RETURNS TABLE (id uuid, user_id uuid, template text, attempts int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    WITH picked AS (
        SELECT q.id
        FROM public.email_queue q
        WHERE q.send_at <= now()
          AND q.sent_at IS NULL
          AND q.cancelled_at IS NULL
          AND q.attempts < 5
          AND (q.claimed_at IS NULL OR q.claimed_at < now() - interval '15 minutes')
        ORDER BY q.send_at
        LIMIT p_max
        FOR UPDATE SKIP LOCKED
    ),
    claimed AS (
        UPDATE public.email_queue q
        SET claimed_at = now()
        FROM picked
        WHERE q.id = picked.id
        RETURNING q.id, q.user_id, q.template, q.attempts
    )
    SELECT c.id, c.user_id, c.template, c.attempts FROM claimed c;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_pending_emails(int) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.claim_pending_emails(int) TO service_role;

-- =========================================================
-- 186 — UNA SOLA RICHIESTA DI RESO APERTA PER ORDINE, DAVVERO
-- =========================================================
-- Il controllo anti-doppione stava nel codice, fra una lettura e una scrittura:
-- due invii ravvicinati lo superavano entrambi. Qui lo fa il database.
CREATE UNIQUE INDEX IF NOT EXISTS returns_un_solo_reso_aperto
  ON public.returns (order_id)
  WHERE status IN ('REQUESTED', 'APPROVED', 'SHIPPED_BACK', 'RECEIVED');

-- =========================================================
-- 191 — IL LAVORO AI HA UNO STATO ANCHE PRIMA DI PARTIRE
-- =========================================================
-- La riga si scrive ORA prima di mandare il lavoro al modello, così un lavoro
-- pagato non può più sparire senza traccia. Servono i due stati nuovi.
ALTER TABLE public.catalog_ai_jobs DROP CONSTRAINT IF EXISTS catalog_ai_jobs_status_check;
ALTER TABLE public.catalog_ai_jobs
  ADD CONSTRAINT catalog_ai_jobs_status_check
  CHECK (status IN ('submitting','processing','ready','applied','error','failed','canceled'));

-- =========================================================
-- 051 — IL RIMBORSO SI ACCUMULA IN MODO ATOMICO, O NON SI FA
-- =========================================================
-- `refunded_amount_cents` veniva letto, sommato in JavaScript e riscritto. Due
-- percorsi che partono insieme (la decisione su un reso e la risoluzione di una
-- contestazione sullo stesso ordine) leggevano tutti e due «zero rimborsato»,
-- e rimborsavano tutti e due l'intero. Il denaro esce due volte: quello sì è
-- irreversibile.
-- Qui la somma la fa il database in una riga sola, con il tetto dentro la
-- stessa istruzione: o la riga viene rivendicata, o non si chiama Stripe.
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

  SELECT round(coalesce(o.total_price, 0) * 100)::int INTO tot
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
    -- Nessuna riga rivendicata: si sfonderebbe il totale dell'ordine.
    RETURN;
  END IF;

  RETURN QUERY SELECT nuovo, tot;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.accumula_rimborso(uuid, int) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accumula_rimborso(uuid, int) TO service_role;

-- =========================================================
-- 048 — UNO STORNO FALLITO NON PUÒ SPARIRE DAI CONTI
-- =========================================================
-- Su `charge.refunded` il recupero dal venditore poteva fallire; l'ordine
-- veniva marcato RIMBORSATO lo stesso e la perdita spariva. Serve uno stato che
-- dica «rimborsato al cliente, MA i soldi dal venditore non sono rientrati»,
-- così il cron lo ripesca e qualcuno lo vede.
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS reversal_error text;

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_payout_status_check;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_payout_status_check
  CHECK (payout_status IS NULL OR payout_status IN (
    'PENDING', 'HELD', 'PENDING_SELLER_ONBOARDING', 'PROCESSING', 'TRANSFERRED',
    'FAILED', 'REVERSED', 'REVERSAL_FAILED', 'REFUNDED', 'AWAITING_REMITTANCE'
  ));

-- =========================================================
-- 062 — L'EVENTO DI STRIPE SI RIVENDICA, NON SI GUARDA E BASTA
-- =========================================================
-- Il webhook leggeva `processed`: due consegne dello stesso evento arrivate
-- insieme leggevano tutte e due «non processato» e creavano tutte e due gli
-- ordini. Serve una colonna per la rivendicazione.
ALTER TABLE public.stripe_event_log ADD COLUMN IF NOT EXISTS claimed_at timestamptz;

-- =========================================================
-- 059 — UNA GIFT CARD PER PAGAMENTO, ANCHE DOPO UNA ROTAZIONE DI CHIAVE
-- =========================================================
-- Il codice della carta regalo era derivato dal segreto del webhook: cambiare
-- quel segreto — cosa che si fa apposta, per sicurezza — faceva emettere una
-- SECONDA carta sullo stesso pagamento, perché l'anti-doppione era il codice.
-- L'anti-doppione giusto è la sessione di pagamento, che non cambia mai.
ALTER TABLE public.gift_cards ADD COLUMN IF NOT EXISTS stripe_session_id text;
CREATE UNIQUE INDEX IF NOT EXISTS gift_cards_stripe_session_unico
  ON public.gift_cards (stripe_session_id)
  WHERE stripe_session_id IS NOT NULL;

-- =========================================================
-- 050 + 173 — IL RECLAMO INTERNO E LA CONTESTAZIONE IN BANCA SONO DUE COSE
-- =========================================================
-- `orders.dispute_status` era scritto sia dal webhook di Stripe (chargeback
-- vero) sia dalla risoluzione di un reclamo interno fra cliente e negozio.
-- Risolvere il secondo azzerava il primo: il negozio veniva pagato mentre la
-- banca aveva già ripreso i soldi. O, al contrario, un reclamo interno perso
-- bloccava per sempre il pagamento di un ordine che in banca non aveva nulla.
-- Due fatti diversi, due colonne.
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS internal_dispute_status text;

COMMENT ON COLUMN public.orders.internal_dispute_status IS
  'Reclamo interno fra cliente e negozio. NON e il chargeback bancario: quello vive in dispute_status e lo scrive solo il webhook Stripe.';

-- =========================================================
-- 094 — I TRE INDICI CHE MANCAVANO SULLE DOMANDE PIÙ FREQUENTI
-- =========================================================
-- La griglia del catalogo, l'elenco delle vetrine e «i miei ordini» sono le tre
-- interrogazioni che il sito esegue di continuo, e nessuna delle tre aveva un
-- indice adatto: con poche righe non si vede, con qualche migliaio diventa il
-- primo rallentamento visibile.
CREATE INDEX IF NOT EXISTS products_status_created_idx
  ON public.products (status, created_at DESC)
  WHERE status = 'available';

CREATE INDEX IF NOT EXISTS profiles_vetrina_idx
  ON public.profiles (role, is_approved)
  WHERE role = 'seller' AND is_approved = true;

CREATE INDEX IF NOT EXISTS orders_user_created_idx
  ON public.orders (user_id, created_at DESC);

-- =========================================================
-- 097 — DUE INDICI IDENTICI SULLA TABELLA CHE SCRIVE DI PIÙ
-- =========================================================
-- `product_views` riceve una riga per ogni visita a una scheda prodotto, e
-- portava due indici sulle stesse colonne (la 027 e la 117). Ogni scrittura li
-- aggiornava tutti e due: costo doppio, beneficio zero. Si toglie il più
-- recente, così resta quello che ha già le statistiche del pianificatore.
DROP INDEX IF EXISTS public.product_views_prodotto_tempo_idx;

-- =========================================================
-- 098 — LE VISITE AI PRODOTTI NON CRESCONO PER SEMPRE
-- =========================================================
-- La tabella accanto (`activity_events`) ha la sua potatura da mesi; questa no,
-- e cresce di una riga per visita senza nessun limite. Ma il negoziante non
-- deve perdere lo storico: prima si salva il conto giornaliero, poi si buttano
-- le righe singole. La riga grezza dura 90 giorni, il numero resta per sempre.
CREATE TABLE IF NOT EXISTS public.product_views_daily (
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  giorno     date NOT NULL,
  visite     integer NOT NULL DEFAULT 0,
  PRIMARY KEY (product_id, giorno)
);

ALTER TABLE public.product_views_daily ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pvd_select_owner ON public.product_views_daily;
CREATE POLICY pvd_select_owner ON public.product_views_daily
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.products p
       WHERE p.id = product_views_daily.product_id
         AND p.seller_id = (SELECT auth.uid())
    )
    OR public.is_admin()
  );

REVOKE INSERT, UPDATE, DELETE ON public.product_views_daily FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.consolida_visite_prodotto(p_giorni int DEFAULT 90)
RETURNS TABLE (aggregate_scritte int, righe_cancellate int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  limite timestamptz := now() - make_interval(days => greatest(p_giorni, 1));
  scritte int := 0;
  cancellate int := 0;
BEGIN
  -- Prima il conto: se questa fallisce, non si cancella niente.
  WITH agg AS (
    SELECT product_id, viewed_at::date AS giorno, count(*)::int AS visite
      FROM public.product_views
     WHERE viewed_at < limite
     GROUP BY product_id, viewed_at::date
  )
  INSERT INTO public.product_views_daily (product_id, giorno, visite)
  SELECT product_id, giorno, visite FROM agg
  ON CONFLICT (product_id, giorno) DO UPDATE SET visite = EXCLUDED.visite;
  GET DIAGNOSTICS scritte = ROW_COUNT;

  DELETE FROM public.product_views WHERE viewed_at < limite;
  GET DIAGNOSTICS cancellate = ROW_COUNT;

  RETURN QUERY SELECT scritte, cancellate;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.consolida_visite_prodotto(int) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consolida_visite_prodotto(int) TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- 114 — Chiusura dei buchi trovati dalla radiografia del 29/07/2026
-- =============================================================================
-- Cosa ripara, in parole semplici:
--   1. il negoziante e il fattorino non riuscivano piu' a far avanzare un
--      ordine dal browser: il controllo cercava una colonna cancellata a giugno
--   2. i dati di casa dei clienti (nome, telefono, indirizzo) si leggevano
--      senza avere un account
--   3. un cliente qualunque poteva prendersi la consegna di un altro
--   4. il fattorino poteva scriversi da solo quanto farsi pagare
--   5. chi si registrava come venditore risultava approvato senza che nessuno
--      lo approvasse
--   6. si potevano recensire negozi da cui non si aveva mai comprato
--   7. l'elenco dei codici sconto era scaricabile da un visitatore anonimo
--   8. budget e speso delle campagne dei negozi erano pubblici
--   9. le vetrine pubbliche erano riscrivibili con la chiave del browser
--
-- Scelta di fondo sul controllo degli ordini: prima elencava i campi VIETATI,
-- e ogni colonna aggiunta dopo nasceva scrivibile dal browser (e' cosi' che
-- rider_fee_cents e i tre campi dei rimborsi sono rimasti aperti). Ora elenca i
-- pochi campi PERMESSI: qualunque colonna futura nasce chiusa.
--
-- Prova: tests/sql/rls/01-ordini-permessi-vetrine.test.sql su un database
-- ricostruito con tests/sql/harness/apply.sh — 14 controlli di comportamento.
-- Idempotente.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';

-- =========================================================
-- 0) «chi chiama è un fattorino approvato?» — in una funzione sola
-- =========================================================
-- Serve SECURITY DEFINER, come public.is_admin(): la tabella profiles ha una
-- policy che guarda orders («il fattorino vede il cliente dell'ordine che ha in
-- mano»). Se una policy di orders interrogasse profiles direttamente, le due si
-- morderebbero la coda e Postgres risponderebbe
-- «infinite recursion detected in policy for relation orders» — cioè ordini
-- bloccati per tutti. Dentro la funzione la RLS non si riapplica, e il giro si
-- chiude.
CREATE OR REPLACE FUNCTION public.is_rider_approvato()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
     WHERE id = (SELECT auth.uid()) AND role = 'rider' AND is_approved
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_rider_approvato() FROM public;
GRANT  EXECUTE ON FUNCTION public.is_rider_approvato() TO authenticated, service_role;

-- =========================================================
-- 1) ORDINI — dalla lista dei divieti alla lista dei permessi
-- =========================================================
CREATE OR REPLACE FUNCTION public.enforce_order_update_rules()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := (SELECT auth.uid());
  is_priv boolean := public.is_admin()
    OR coalesce((SELECT auth.jwt() ->> 'role'), '') = 'service_role'
    OR coalesce(current_setting('mycity.allow_order_write', true), '') = '1';
  -- I soli campi che un client (negoziante o fattorino) puo' cambiare.
  -- Tutto il resto — soldi, pagamenti, payout, contanti, prove di consegna,
  -- proprietario, recapiti del cliente — passa solo dalle RPC fidate.
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

  -- rider_id cambia SOLO come presa in carico (NULL -> se stesso), contestuale a
  -- READY -> ASSIGNED, e solo se chi chiama e' un fattorino approvato.
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
$$;

DROP TRIGGER IF EXISTS trg_enforce_order_update ON public.orders;
CREATE TRIGGER trg_enforce_order_update
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.enforce_order_update_rules();

-- Tetto anche nel database sul compenso del fattorino: il valore finisce in un
-- bonifico Stripe. NOT VALID per non bloccare eventuali righe storiche.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_rider_fee_cents_ragionevole'
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_rider_fee_cents_ragionevole
      CHECK (rider_fee_cents IS NULL OR (rider_fee_cents >= 0 AND rider_fee_cents <= 5000))
      NOT VALID;
  END IF;
END $$;

-- =========================================================
-- 2) ORDINI — chi li vede e chi li tocca
-- =========================================================
-- Prima: `delivery_status IN ('ACCEPTED','READY') AND rider_id IS NULL`, per il
-- ruolo public. Nessun controllo su chi chiama: vero per tutti, anche senza
-- login. Ora serve un account E un profilo di fattorino approvato.
DROP POLICY IF EXISTS "Riders can view available and own orders" ON public.orders;
CREATE POLICY "Riders can view available and own orders"
  ON public.orders FOR SELECT
  TO authenticated
  USING (
    rider_id = (SELECT auth.uid())
    OR (
      delivery_status IN ('ACCEPTED', 'READY')
      AND rider_id IS NULL
      AND public.is_rider_approvato()
    )
  );

DROP POLICY IF EXISTS "Riders can update assigned or claim free orders" ON public.orders;
CREATE POLICY "Riders can update assigned or claim free orders"
  ON public.orders FOR UPDATE
  TO authenticated
  USING (
    public.is_rider_approvato()
    AND (
      rider_id = (SELECT auth.uid())
      OR (delivery_status = 'READY' AND rider_id IS NULL)
    )
  )
  WITH CHECK (
    rider_id = (SELECT auth.uid())
    -- niente scritture dopo la consegna: la riga si chiude
    AND delivery_status <> 'DELIVERED'
  );

-- Le altre policy su orders sono legate a auth.uid() o a is_admin(): per un
-- visitatore senza account non tornano mai vere. Il ruolo anon non ha comunque
-- ragione di scrivere ordini dal browser.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.orders FROM anon;

-- =========================================================
-- 3) REGISTRARSI NON VALE APPROVAZIONE
-- =========================================================
-- Il ruolo scelto in fase di registrazione arriva dal browser
-- (raw_user_meta_data->>'role'): resta una candidatura. L'approvazione la da'
-- lo staff da /api/admin/users/[id]/moderate.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

-- Bonifica: chi risulta approvato senza che nessuno lo abbia approvato torna in
-- attesa. Chi ha approval_status='approved' (passato dallo staff) non si tocca.
UPDATE public.profiles
   SET is_approved = false, approval_status = 'pending'
 WHERE role IN ('seller', 'rider')
   AND is_approved = true
   AND coalesce(approval_status, 'pending') <> 'approved';

-- =========================================================
-- 4) RECENSIONI NEGOZIO — via la tautologia
-- =========================================================
-- La condizione scritta era `store_id = store_reviews.store_id`: Postgres
-- risolveva entrambi i lati sulla stessa riga, quindi sempre vera. Bastava un
-- proprio ordine consegnato QUALUNQUE per recensire QUALSIASI negozio.
DROP POLICY IF EXISTS "Buyers can review delivered orders" ON public.store_reviews;
CREATE POLICY "Buyers can review delivered orders"
  ON public.store_reviews FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND store_id <> (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.orders o
       WHERE o.id = store_reviews.order_id
         AND o.user_id = (SELECT auth.uid())
         AND o.seller_id = store_reviews.store_id
         AND o.delivery_status = 'DELIVERED'
    )
  );

-- =========================================================
-- 5) POLICY "SEMPRE VERO" — rimosse coi nomi VERI
-- =========================================================
-- Le migrazioni 020 e 109 provavano a togliere queste due policy, ma con nomi
-- inventati: `DROP POLICY IF EXISTS` non protesta e il buco restava aperto.
-- Nomi letti da pg_policies, non presunti.
DROP POLICY IF EXISTS "Anyone can read store reviews" ON public.store_reviews;
DROP POLICY IF EXISTS "Anyone reads participants" ON public.group_participants;

-- Le recensioni dei negozi restano pubbliche, ma solo per i negozi approvati
-- (la policy "Store reviews readable for approved stores" della 109 c'e' gia';
-- qui la ricreo solo se manca, per non dipendere dall'ordine di applicazione).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'store_reviews' AND policyname = 'Store reviews readable for approved stores'
  ) THEN
    CREATE POLICY "Store reviews readable for approved stores"
      ON public.store_reviews FOR SELECT
      USING (EXISTS (
        SELECT 1 FROM public.profiles p
         WHERE p.id = store_reviews.store_id AND p.is_approved
      ));
  END IF;
END $$;

-- I partecipanti a un acquisto di gruppo li vede chi e' dentro, l'organizzatore
-- e lo staff (la 020 lo voleva; non ci era mai arrivata).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'group_participants' AND policyname = 'Group participants readable by involved parties'
  ) THEN
    CREATE POLICY "Group participants readable by involved parties"
      ON public.group_participants FOR SELECT
      USING (
        user_id = (SELECT auth.uid())
        OR EXISTS (
          SELECT 1 FROM public.group_orders g
           WHERE g.id = group_participants.group_order_id
             AND g.seller_id = (SELECT auth.uid())
        )
        OR public.is_admin()
      );
  END IF;
END $$;

-- =========================================================
-- 6) CODICI SCONTO — non sono un elenco pubblico
-- =========================================================
-- Prima: policy `active = true` per il ruolo public, con GRANT SELECT ad anon.
-- Una sola chiamata con la chiave del browser scaricava tutti i codici attivi.
-- Ora la validazione passa da una funzione che risponde solo "vale / non vale".
DROP POLICY IF EXISTS "Anyone can read active coupons" ON public.coupons;
REVOKE SELECT ON public.coupons FROM anon, authenticated;

DROP POLICY IF EXISTS "zone_codes_public_read" ON public.zone_codes;
REVOKE SELECT ON public.zone_codes FROM anon;

CREATE OR REPLACE FUNCTION public.check_coupon(p_code text, p_subtotal numeric)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c public.coupons;
  uid uuid := (SELECT auth.uid());
  ordini int;
  sconto numeric := 0;
  spedizione_gratis boolean := false;
BEGIN
  IF uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'Devi accedere per usare un codice');
  END IF;

  SELECT * INTO c FROM public.coupons
   WHERE code = upper(trim(p_code)) AND active = true;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'Codice non valido');
  END IF;

  IF c.expires_at IS NOT NULL AND c.expires_at < now() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'Codice scaduto');
  END IF;
  IF c.max_uses IS NOT NULL AND c.uses_count >= c.max_uses THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'Codice esaurito');
  END IF;
  IF p_subtotal < c.min_subtotal THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'Spesa minima richiesta: €' || to_char(c.min_subtotal, 'FM999999990.00'));
  END IF;
  IF c.first_order_only THEN
    SELECT count(*) INTO ordini FROM public.orders WHERE user_id = uid;
    IF ordini > 0 THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'Codice valido solo al primo ordine');
    END IF;
  END IF;

  IF c.type = 'PERCENT' THEN
    sconto := round(p_subtotal * (c.value / 100.0), 2);
  ELSIF c.type = 'FIXED' THEN
    sconto := least(p_subtotal, c.value);
  ELSIF c.type = 'FREE_SHIPPING' THEN
    spedizione_gratis := true;
  END IF;

  -- Solo i campi che servono a mostrare il codice applicato: niente max_uses,
  -- uses_count, min_subtotal degli altri codici, niente elenco.
  RETURN jsonb_build_object(
    'ok', true,
    'discount', sconto,
    'freeShipping', spedizione_gratis,
    'coupon', jsonb_build_object(
      'id', c.id, 'code', c.code, 'type', c.type, 'value', c.value,
      'description', c.description
    )
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.check_coupon(text, numeric) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.check_coupon(text, numeric) TO authenticated, service_role;

-- =========================================================
-- 7) CAMPAGNE SPONSORIZZATE — l'annuncio si', i conti no
-- =========================================================
-- La policy pubblica esponeva daily_budget_cents, spent_cents, impressions,
-- clicks e stripe_session_id di ogni negozio ai concorrenti.
DROP POLICY IF EXISTS "sponsored_listings_public_read" ON public.sponsored_listings;

CREATE OR REPLACE VIEW public.sponsored_active_public AS
  SELECT id, product_id, placement, category_slug, start_date, end_date
    FROM public.sponsored_listings
   WHERE status = 'active';

COMMENT ON VIEW public.sponsored_active_public IS
  'Annunci sponsorizzati attivi, senza i dati economici. @foreignKey (product_id) references public.products (id)';

-- =========================================================
-- 8) VETRINA "ATTIVITA' DAL VIVO" — senza il nome del cliente
-- =========================================================
-- La home mostrava gli ultimi ordini leggendoli dalla tabella orders con la
-- chiave del browser, nome del cliente compreso. Questa vista da' la prova
-- sociale (citta', stato, negozio) senza dire chi ha ordinato.
CREATE OR REPLACE VIEW public.live_activity_public AS
  SELECT o.id,
         o.created_at,
         o.delivery_status,
         o.delivery_city,
         o.seller_id,
         p.store_name
    FROM public.orders o
    JOIN public.profiles p ON p.id = o.seller_id
   WHERE o.delivery_status IN ('NEW', 'ACCEPTED', 'READY', 'OUT_FOR_DELIVERY', 'DELIVERED')
     AND p.is_approved
   ORDER BY o.created_at DESC
   LIMIT 20;

COMMENT ON VIEW public.live_activity_public IS
  'Attivita recente per la home: citta, stato, negozio. Nessun dato personale del cliente.';

-- =========================================================
-- 9) VISTE PUBBLICHE — sola lettura, sempre
-- =========================================================
-- Su Supabase i grant di default dello schema public danno ALL ad anon e
-- authenticated su ogni oggetto NUOVO: ogni vista nasce scrivibile, e una vista
-- semplice e' auto-aggiornabile. Qui si revoca su tutte le viste esistenti in
-- un colpo, senza elenchi da tenere aggiornati a mano.
DO $$
DECLARE v record;
BEGIN
  FOR v IN
    SELECT c.relname FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'v'
  LOOP
    EXECUTE format(
      'REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES ON public.%I FROM anon, authenticated',
      v.relname);
    EXECUTE format('GRANT SELECT ON public.%I TO anon, authenticated', v.relname);
  END LOOP;
END $$;

-- E da qui in avanti: le viste nuove non nascono piu' scrivibili per anon.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES ON TABLES FROM anon;

-- Vista presente in produzione e in nessuna migrazione (deriva): esponeva il
-- codice invito di ogni negozio e nessuna riga di codice la usa.
DROP VIEW IF EXISTS public.seller_storefronts;

-- =========================================================
-- 10) PROVE D'INCASSO IN CONTANTI — in un secchio privato
-- =========================================================
-- La foto dei contanti e quella del pacco consegnato finivano nel secchio
-- `products`, che e' PUBBLICO, in una cartella non legata a nessun utente: chi
-- indovinava l'indirizzo vedeva la foto. E la regola di caricamento chiedeva
-- solo «essere autenticato», senza vincolo di cartella: un utente qualunque
-- poteva scrivere dentro la cartella di un altro.
INSERT INTO storage.buckets (id, name, public)
VALUES ('cod-proof', 'cod-proof', false)
ON CONFLICT (id) DO UPDATE SET public = false;

DROP POLICY IF EXISTS "cod-proof insert owner" ON storage.objects;
CREATE POLICY "cod-proof insert owner" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'cod-proof'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  );

DROP POLICY IF EXISTS "cod-proof read owner or staff" ON storage.objects;
CREATE POLICY "cod-proof read owner or staff" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'cod-proof'
    AND ((storage.foldername(name))[1] = (SELECT auth.uid())::text OR public.is_admin())
  );

-- Caricamento nel secchio pubblico: ognuno solo nella PROPRIA cartella.
-- Eccezione dichiarata: le immagini della home, che carica soltanto lo staff.
DROP POLICY IF EXISTS "Authenticated users can upload product images" ON storage.objects;
CREATE POLICY "Authenticated users can upload product images" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'products'
    AND (
      (storage.foldername(name))[1] = (SELECT auth.uid())::text
      OR ((storage.foldername(name))[1] = 'home' AND public.is_admin())
    )
  );

COMMIT;

NOTIFY pgrst, 'reload schema';

-- 709 — I negozi nuovi entrano in «modalità demo»: non si vedono sul marketplace finché non pagano
-- un abbonamento ai servizi (24/11/2026).
--
-- Nicola: «Tutte le attività che si iscrivono però non hanno effettuato il loro pagamento entrano
-- sulla piattaforma in modalità demo e la loro vetrina non è visibile ancora sul marketplace».
-- Le sue scelte: «solo per i nuovi» (chi è già approvato resta visibile com'è, come Pane Quotidiano,
-- e così i negozi di sistema MyCity e SDG), e il pagamento che fa uscire dalla demo è «un
-- abbonamento ai servizi» (Base, Business o Premium: una riga in abbonamenti_servizi, migrazione 706).
--
-- LA REGOLA, IN UN POSTO SOLO: public.negozio_in_vetrina(id). Un negozio si vede in pubblico se
--   è un venditore approvato dallo staff (l'approvazione resta necessaria)
--   E (profiles.visibile_senza_abbonamento, cioè era già online prima di oggi,
--      O ha un abbonamento ai servizi «active» o «past_due»).
-- «past_due» resta visibile, per non far sparire e ricomparire il negozio a ogni carta rifiutata; con
-- «canceled» si torna in demo.
--
-- DOVE SI APPLICA (tutto quello che il pubblico legge passava da «è approvato»):
--   · la regola di lettura dei prodotti, e quindi carrello, cassa con la carta e in contanti, che
--     leggono il catalogo con la sessione di chi compra;
--   · prodotto_in_vetrina (recensioni, varianti), la regola delle recensioni dei negozi;
--   · le viste pubbliche seller_public_profiles (liste, ricerca, pagina del negozio, sitemap),
--     shop_of_month_leaderboard, live_activity_public, nomi_pubblici;
--   · search_products_smart e active_promo_products;
--   · le storie, le promozioni e product_active_discounts (dal collaudo del 24/11).
-- Non cambia negozio_approvato: la usa il salvataggio dei prodotti (405), e un negozio in demo i suoi
-- prodotti li prepara. Il negozio stesso vede sempre i suoi prodotti (regola «Sellers can view their
-- own products») e la sua riga nella vista seller_public_profiles, per l'anteprima.
--
-- «SOLO PER I NUOVI», SENZA ID SCRITTI A MANO: la colonna profiles.visibile_senza_abbonamento nasce
-- false, e questa migrazione la mette a true per i venditori approvati oggi (Pane Quotidiano, MyCity,
-- SDG). La scrive solo il server: la guardia dei profili (119, ultima in 400) ha l'elenco delle colonne
-- che una persona cambia da sé, e questa non c'è.
--
-- PERMESSI (migrazione 425): funzione nuova con EXECUTE a anon e authenticated come la sua gemella
-- negozio_approvato (le regole di lettura la chiamano coi permessi di chi legge). Le viste ricreate
-- tengono i permessi; le loro opzioni (security_barrier) si riscrivono qui sotto.
--
-- Si può rieseguire. NON si applica a mano: lo decide Nicola, col pulsante «Migrazioni a mano», dopo
-- la 706 (abbonamenti_servizi), la 707 e la 708.
-- REVERSIBILE: ridefinire le regole e le viste con public.negozio_approvato al posto di
-- public.negozio_in_vetrina (migrazione 129 e successive), poi
--   DROP FUNCTION public.negozio_in_vetrina(uuid);
--   ALTER TABLE public.profiles DROP COLUMN visibile_senza_abbonamento;

BEGIN;

-- 1) La colonna e chi era già online ----------------------------------------------------------
-- Conta solo la prima volta, quando la colonna nasce: chi è approvato in quel momento resta online.
-- Rieseguendo la migrazione la colonna c'è già e nessun negozio approvato dopo viene promosso.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'visibile_senza_abbonamento'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN visibile_senza_abbonamento boolean NOT NULL DEFAULT false;
    PERFORM set_config('mycity.allow_profile_write', '1', true);
    UPDATE public.profiles
       SET visibile_senza_abbonamento = true
     WHERE role = 'seller' AND is_approved = true;
  END IF;
END $$;

COMMENT ON COLUMN public.profiles.visibile_senza_abbonamento IS
  'Vero per i negozi già online prima della modalità demo (24/11/2026): restano visibili anche senza abbonamento ai servizi. La scrive solo il server (migrazione 709).';

-- 2) La regola, in un posto solo -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.negozio_in_vetrina(p_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.id = p_id
       AND p.role = 'seller'
       AND p.is_approved = true
       AND (
         p.visibile_senza_abbonamento
         OR EXISTS (
           SELECT 1 FROM public.abbonamenti_servizi a
            WHERE a.seller_id = p.id AND a.stato IN ('active', 'past_due')
         )
       )
  );
$$;

REVOKE ALL ON FUNCTION public.negozio_in_vetrina(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.negozio_in_vetrina(uuid) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.negozio_in_vetrina(uuid) IS
  'Il negozio si vede sul marketplace: venditore approvato E (già online prima del 24/11/2026 O abbonamento ai servizi active/past_due). Modalità demo, migrazione 709.';

CREATE OR REPLACE FUNCTION public.prodotto_in_vetrina(p_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.products pr
     WHERE pr.id = p_id
       AND pr.status = 'available'
       AND public.negozio_in_vetrina(pr.seller_id)
  );
$$;

-- 3) Le regole di lettura pubblica ---------------------------------------------------------------
DROP POLICY IF EXISTS "Products visible to public if seller approved" ON public.products;
CREATE POLICY "Products visible to public if seller approved"
  ON public.products FOR SELECT
  USING (
    status = 'available'
    AND public.negozio_in_vetrina(seller_id)
  );

DROP POLICY IF EXISTS "Store reviews readable for approved stores" ON public.store_reviews;
CREATE POLICY "Store reviews readable for approved stores"
  ON public.store_reviews FOR SELECT
  USING (public.negozio_in_vetrina(store_id));

-- 4) Le viste pubbliche (stesse colonne, stessi permessi) --------------------------------------
CREATE OR REPLACE VIEW public.seller_public_profiles AS
 SELECT id,
    store_name,
    store_address,
    store_lat,
    store_lng,
    store_phone,
    store_logo,
    store_hours,
    store_media,
    store_description,
    store_customization,
    store_site,
    offers_express,
    founded_year,
    is_approved,
    stripe_charges_enabled,
    stripe_payouts_enabled,
    role,
    created_at,
    business_legal_name,
    business_form,
    business_vat_number,
    business_address,
    business_city,
    business_zip
   FROM profiles
  WHERE is_approved = true AND store_name IS NOT NULL AND role = 'seller'::text
    -- Modalità demo: in pubblico solo i negozi in vetrina; il negozio stesso vede la sua riga.
    AND (public.negozio_in_vetrina(id) OR id = (SELECT auth.uid()));

CREATE OR REPLACE VIEW public.shop_of_month_leaderboard AS
 SELECT p.id AS seller_id,
    p.store_name,
    p.store_logo,
    mese_di_piacenza() AS month,
    count(v.id) AS vote_count
   FROM profiles p
     LEFT JOIN shop_of_month_votes v ON v.seller_id = p.id AND v.month = mese_di_piacenza()
  WHERE p.role = 'seller'::text AND p.is_approved = true AND public.negozio_in_vetrina(p.id)
  GROUP BY p.id, p.store_name, p.store_logo
  ORDER BY (count(v.id)) DESC, p.store_name
 LIMIT 50;

CREATE OR REPLACE VIEW public.live_activity_public AS
 SELECT DISTINCT date_trunc('hour'::text, o.created_at) AS created_at,
    o.delivery_status,
    'Piacenza'::text AS delivery_city,
    p.store_name
   FROM orders o
     JOIN profiles p ON p.id = o.seller_id
  WHERE (o.delivery_status = ANY (ARRAY['NEW'::text, 'ACCEPTED'::text, 'READY'::text, 'OUT_FOR_DELIVERY'::text, 'DELIVERED'::text])) AND p.is_approved
    AND public.negozio_in_vetrina(p.id)
  ORDER BY (date_trunc('hour'::text, o.created_at)) DESC
 LIMIT 20;

CREATE OR REPLACE VIEW public.nomi_pubblici AS
 SELECT p.id, NULLIF(split_part(btrim(p.full_name), ' ', 1), '') AS nome
   FROM profiles p
  WHERE (EXISTS ( SELECT 1
           FROM store_reviews r
             JOIN profiles s ON s.id = r.store_id
          WHERE r.user_id = p.id AND s.role = 'seller'::text AND s.is_approved = true AND public.negozio_in_vetrina(s.id))) OR (EXISTS ( SELECT 1
           FROM product_questions q
          WHERE q.author_id = p.id AND q.is_public = true)) OR (EXISTS ( SELECT 1
           FROM orders o
          WHERE o.rider_id = p.id AND ((( SELECT auth.uid() AS uid)) = o.user_id OR (( SELECT auth.uid() AS uid)) = o.seller_id)));

-- CREATE OR REPLACE VIEW azzera le opzioni: si rimettono come erano. security_barrier impedisce che
-- il filtro di chi chiede passi avanti a quello della vista (prova 27).
ALTER VIEW public.seller_public_profiles SET (security_invoker = off, security_barrier = true);
ALTER VIEW public.shop_of_month_leaderboard SET (security_invoker = off, security_barrier = true);
ALTER VIEW public.live_activity_public SET (security_invoker = off, security_barrier = true);
ALTER VIEW public.nomi_pubblici SET (security_invoker = false, security_barrier = true);

-- 5) Ricerca e promozioni: la stessa regola ------------------------------------------------------
CREATE OR REPLACE FUNCTION public.search_products_smart(q text, lim integer DEFAULT 10)
 RETURNS TABLE(id uuid, name text, price numeric, images jsonb, seller_id uuid, store_name text, rank real)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
    q_trim text := trim(q);
BEGIN
    IF q_trim = '' OR char_length(q_trim) < 1 THEN
        RETURN;
    END IF;

    IF char_length(q_trim) < 3 THEN
        -- Prefix + trigram per query molto corte
        RETURN QUERY
            SELECT
                p.id,
                p.name,
                p.price,
                p.images,
                p.seller_id,
                pr.store_name,
                similarity(p.name, q_trim) AS rank
            FROM public.products p
            LEFT JOIN public.seller_public_profiles pr ON pr.id = p.seller_id
            WHERE p.status = 'available'
              AND public.negozio_in_vetrina(p.seller_id)
              AND (p.name ILIKE q_trim || '%' OR p.name % q_trim)
            ORDER BY rank DESC, p.name
            LIMIT lim;
    ELSE
        -- FTS websearch italiano per query 3+ char
        RETURN QUERY
            SELECT
                p.id,
                p.name,
                p.price,
                p.images,
                p.seller_id,
                pr.store_name,
                ts_rank(p.search_tsv, websearch_to_tsquery('italian', q_trim)) AS rank
            FROM public.products p
            LEFT JOIN public.seller_public_profiles pr ON pr.id = p.seller_id
            WHERE p.status = 'available'
              AND public.negozio_in_vetrina(p.seller_id)
              AND (
                p.search_tsv @@ websearch_to_tsquery('italian', q_trim)
                OR p.name % q_trim  -- fallback trigram fuzzy
              )
            ORDER BY rank DESC NULLS LAST, p.name
            LIMIT lim;
    END IF;
END;
$function$

;

CREATE OR REPLACE FUNCTION public.active_promo_products(p_limit integer DEFAULT 12, p_seller uuid DEFAULT NULL::uuid)
 RETURNS TABLE(product_id uuid, name text, price numeric, images jsonb, seller_id uuid, store_name text, discount_percent integer, stock integer, has_variants boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
    SELECT
        p.id AS product_id,
        p.name,
        p.price,
        p.images,
        p.seller_id,
        pr.store_name,
        MAX(sp.discount_percent)::int AS discount_percent,
        p.stock,
        p.has_variants
    FROM public.products p
    LEFT JOIN public.seller_public_profiles pr ON pr.id = p.seller_id
    JOIN public.seller_promotions sp
        ON sp.seller_id = p.seller_id
       AND sp.status = 'active'
       AND sp.starts_at <= now()
       AND sp.ends_at >= now()
       AND (
            sp.scope = 'store'
         OR (sp.scope = 'category' AND sp.category_id = p.category_id)
         OR (sp.scope = 'products' AND p.id = ANY(sp.product_ids))
       )
    WHERE p.status = 'available'
      AND public.negozio_in_vetrina(p.seller_id)
      AND (p_seller IS NULL OR p.seller_id = p_seller)
    GROUP BY p.id, p.name, p.price, p.images, p.seller_id, pr.store_name, p.stock, p.has_variants
    ORDER BY discount_percent DESC, p.id
    LIMIT GREATEST(p_limit, 1);
$function$

;



-- 6) Storie e promozioni (dal collaudo del 24/11) ------------------------------------------------
-- Le storie e le promozioni di un negozio in demo si leggevano dall'API con la chiave pubblica, e una
-- promo di un negozio in demo accendeva la striscia «promo attive» su tutto il sito. Il proprietario
-- le vede sempre (le sue regole di scrittura e lettura restano: seller_stories_* e promotions_seller_rw).
DROP POLICY IF EXISTS seller_stories_public_read ON public.seller_stories;
CREATE POLICY seller_stories_public_read ON public.seller_stories
  FOR SELECT
  USING (expires_at > now() AND (public.negozio_in_vetrina(seller_id) OR seller_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS promotions_public_read ON public.seller_promotions;
CREATE POLICY promotions_public_read ON public.seller_promotions
  FOR SELECT
  USING (status = 'active' AND starts_at <= now() AND ends_at >= now() AND public.negozio_in_vetrina(seller_id));

-- Lo sconto di un prodotto: per un negozio in demo vale 0 (la riga resta, chi chiama se l'aspetta).
CREATE OR REPLACE FUNCTION public.product_active_discounts(p_products uuid[])
 RETURNS TABLE(product_id uuid, discount_percent integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT pr.id AS product_id,
         COALESCE((
           SELECT MAX(sp.discount_percent)
             FROM public.seller_promotions sp
            WHERE sp.seller_id = pr.seller_id
              -- il proprietario vede i suoi sconti nell'anteprima, come vede le sue promo
              AND (public.negozio_in_vetrina(pr.seller_id) OR pr.seller_id = (SELECT auth.uid()))
              AND sp.status = 'active'
              AND sp.starts_at <= now()
              AND sp.ends_at   >= now()
              AND (
                sp.scope = 'store'
                OR (sp.scope = 'category' AND sp.category_id = pr.category_id)
                OR (sp.scope = 'products' AND pr.id = ANY(sp.product_ids))
              )
         ), 0)::int AS discount_percent
    FROM public.products pr
   WHERE pr.id = ANY(p_products);
$function$;


-- 7) Lo stato della richiesta lo scrive solo il server (dal ricollaudo del 24/11) ---------------
-- La guardia dei profili (119, ultima in 400) lasciava al negozio approval_status e
-- approval_requested_at: un negozio rifiutato si rimetteva «in attesa» dal browser e, con la
-- modalità demo, arrivava al preventivo e alla cassa. Tutte le scritture vere di quei due campi
-- passano già dal server con la chiave di servizio (/api/seller/apply, il preventivo col codice,
-- la moderazione dell'admin): dal browser non li scrive nessuno. Si tolgono dall'elenco; il resto
-- della guardia è identico.
CREATE OR REPLACE FUNCTION public.enforce_profile_update_rules()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  is_priv boolean := public.is_admin()
    OR coalesce((SELECT auth.jwt() ->> 'role'), '') = 'service_role'
    OR coalesce(current_setting('mycity.allow_profile_write', true), '') = '1';
  consentiti constant text[] := ARRAY[
    'full_name','phone','address','city','zip',
    'public_avatar_url','public_bio','public_handle','public_profile_enabled',
    'email_marketing','notif_promos','notif_groups','notif_newsletter','notif_order_updates',
    'store_name','store_lat','store_lng','store_phone','store_address','store_description',
    'store_logo','store_hours','store_media','store_site','store_customization','offers_express',
    'rider_is_online','rider_zones','rider_schedule',
    'tos_accepted_at','privacy_accepted_at','data_accuracy_confirmed_at',
    'deletion_requested_at',
    'legal_first_name','legal_last_name','legal_birth_date','legal_fiscal_code',
    'legal_residence_addr','legal_residence_city','legal_residence_zip',
    'rider_vehicle_type','rider_vehicle_plate','rider_license_expires_on','rider_insurance_expires_on',
    'billing_card_last',
    'is_approved',
    'updated_at'
  ];
BEGIN
  IF is_priv THEN
    RETURN NEW;
  END IF;

  IF (to_jsonb(NEW) - consentiti) IS DISTINCT FROM (to_jsonb(OLD) - consentiti) THEN
    RAISE EXCEPTION 'profiles: campo riservato non modificabile' USING ERRCODE = '42501';
  END IF;

  IF NEW.is_approved = true AND OLD.is_approved IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'profiles: approvazione riservata allo staff' USING ERRCODE = '42501';
  END IF;

  -- 400 — Un negozio sospeso non cambia il proprio stato: né «in attesa» né vuoto.
  IF OLD.approval_status = 'suspended'
     AND NEW.approval_status IS DISTINCT FROM OLD.approval_status THEN
    RAISE EXCEPTION 'profiles: la sospensione la toglie solo lo staff' USING ERRCODE = '42501';
  END IF;

  IF NEW.approval_status IS DISTINCT FROM OLD.approval_status
     AND coalesce(NEW.approval_status, '') NOT IN ('pending', '') THEN
    RAISE EXCEPTION 'profiles: stato approvazione riservato allo staff' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

COMMIT;

NOTIFY pgrst, 'reload schema';

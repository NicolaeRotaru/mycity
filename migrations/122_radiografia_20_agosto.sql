-- =============================================================================
-- 122 — La radiografia del 18 agosto, parte database (lotto del 20 agosto)
-- =============================================================================
-- Cinque riparazioni, tutte reversibili, tutte idempotenti. In ordine di quanto
-- costavano:
--
--  ① I recapiti dei clienti sulla bacheca dei fattorini (#18, #32). Ogni
--     fattorino approvato poteva scaricare nome, indirizzo e telefono di TUTTI
--     gli ordini liberi della citta', non solo dei suoi. Per decidere se
--     accettare una consegna quei dati non servono: servono il negozio, la
--     zona, l'importo e la fascia oraria. Ora la bacheca e' una vista che
--     espone solo quelli, e la riga intera resta visibile solo a chi ha preso
--     l'ordine.
--
--  ② Gli interruttori delle notifiche che non spegnevano niente (#33). Le
--     preferenze (promozioni si', newsletter no...) si applicano guardando la
--     colonna `category` delle notifiche — e nessuno la scriveva mai. Chi
--     spegneva le promozioni continuava a riceverle.
--
--  ③ I contatori degli sponsorizzati, gonfiabili da chiunque (#36, #219). Le
--     due funzioni di conteggio erano aperte agli ospiti e senza tetto: un
--     ciclo di richieste dal browser poteva far risultare diecimila
--     visualizzazioni a una campagna che nessuno ha visto — e su quei numeri
--     un negozio decide se rinnovare.
--
--  ④ Gli sconti chiesti uno per uno (#86). Al momento di pagare si faceva una
--     chiamata al database per ogni articolo del carrello. Ora una sola.
--
--  ⑤ Le vetrine vuote di /stores e /near (#89). Il taglio globale a 600
--     prodotti faceva risultare «0 prodotti» ai negozi meno recenti, e non era
--     vero. Ora una funzione prende i primi N prodotti DI OGNI negozio.
--
-- Come si torna indietro: ogni blocco e' indipendente. Le viste e le funzioni
-- nuove si possono cancellare (DROP) senza toccare nessun dato; la policy del
-- punto ① si rimette com'era ripetendo la CREATE POLICY della 114.
-- =============================================================================

BEGIN;

-- =========================================================
-- ① BACHECA DEI FATTORINI SENZA RECAPITI  (#18, #32)
-- =========================================================
-- La vista espone solo cio' che serve per decidere se accettare una consegna.
-- `security_invoker = off`: legge coi permessi del proprietario, quindi puo'
-- mostrare gli ordini liberi anche dopo che la policy sotto si e' stretta —
-- ma solo queste colonne, e solo a chi e' un fattorino approvato.
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
     AND public.is_rider_approvato();

COMMENT ON VIEW public.ordini_disponibili_rider IS
  'Ordini liberi visibili ai fattorini approvati: negozio, zona, importo, fascia oraria. Nessun recapito del cliente — nome, indirizzo esatto e telefono compaiono solo sull''ordine gia'' assegnato.';

REVOKE ALL    ON public.ordini_disponibili_rider FROM anon, authenticated;
GRANT  SELECT ON public.ordini_disponibili_rider TO authenticated;

-- La riga intera (con i recapiti) torna visibile SOLO a chi ha preso l'ordine.
DROP POLICY IF EXISTS "Riders can view available and own orders" ON public.orders;
CREATE POLICY "Riders can view available and own orders"
  ON public.orders FOR SELECT
  TO authenticated
  USING (rider_id = (SELECT auth.uid()));

COMMENT ON POLICY "Riders can view available and own orders" ON public.orders IS
  'Il fattorino vede per intero solo gli ordini che ha preso. Gli ordini liberi si guardano dalla vista ordini_disponibili_rider, che non porta i recapiti.';

-- =========================================================
-- ② LE NOTIFICHE PORTANO LA LORO CATEGORIA  (#33)
-- =========================================================
-- Senza `category` le preferenze non si possono applicare: il cron che manda
-- le push legge quella colonna per sapere se la persona ha spento quel tipo di
-- avviso. Le notifiche di ordine sono 'order' — restano sempre accese, perche'
-- riguardano una cosa che la persona ha comprato.
CREATE OR REPLACE FUNCTION public.notify_buyer_on_order_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE short_id text;
BEGIN
  IF NEW.delivery_status IS DISTINCT FROM OLD.delivery_status THEN
    short_id := upper(substr(NEW.id::text, 1, 6));
    BEGIN
      IF NEW.delivery_status = 'ACCEPTED' THEN
        INSERT INTO public.notifications (user_id, title, body, link, category) VALUES
          (NEW.user_id, '✅ Ordine accettato',
           'Il negozio ha accettato il tuo ordine #' || short_id || ' e lo sta preparando.',
           '/orders/' || NEW.id, 'order');
      ELSIF NEW.delivery_status = 'READY' THEN
        INSERT INTO public.notifications (user_id, title, body, link, category) VALUES
          (NEW.user_id, '📦 Ordine pronto',
           'Il tuo ordine #' || short_id || ' è pronto: un rider lo ritirerà a breve.',
           '/orders/' || NEW.id, 'order');
      ELSIF NEW.delivery_status = 'ASSIGNED' THEN
        INSERT INTO public.notifications (user_id, title, body, link, category) VALUES
          (NEW.user_id, '🛵 Un rider ha preso il tuo ordine',
           'Il rider ritirerà l''ordine #' || short_id || ' e te lo porterà.',
           '/orders/' || NEW.id, 'order');
        IF NEW.seller_id IS NOT NULL THEN
          INSERT INTO public.notifications (user_id, title, body, link, category) VALUES
            (NEW.seller_id, '🛵 Rider assegnato',
             'Un rider ritirerà l''ordine #' || short_id || '.',
             '/seller/orders/' || NEW.id, 'order');
        END IF;
      ELSIF NEW.delivery_status = 'OUT_FOR_DELIVERY' THEN
        INSERT INTO public.notifications (user_id, title, body, link, category) VALUES
          (NEW.user_id, '🚚 Ordine in consegna',
           'Il tuo ordine #' || short_id || ' è in arrivo!',
           '/orders/' || NEW.id, 'order');
      END IF;
    EXCEPTION WHEN OTHERS THEN
      NULL; -- best-effort: la notifica non deve bloccare la transizione di stato
    END;
  END IF;
  RETURN NEW;
END;
$$;

-- Il calo di prezzo su un prodotto preferito è una promozione: chi ha spento le
-- promozioni non deve riceverla. Prima non aveva categoria, quindi passava
-- sempre. Corpo identico a quello della 029 (soglia del 5%, stesso testo):
-- cambia solo la colonna in più.
CREATE OR REPLACE FUNCTION public.notify_favorite_price_drop()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_drop_percent numeric;
BEGIN
    IF NEW.price >= OLD.price THEN
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
        '💰 Prezzo abbassato: ' || NEW.name,
        'Il prodotto che hai salvato è sceso di ' || v_drop_percent || '% — da €' ||
            ROUND(OLD.price, 2) || ' a €' || ROUND(NEW.price, 2),
        '/product/' || NEW.id,
        'promo'
    FROM public.favorites f
    WHERE f.product_id = NEW.id;

    RETURN NEW;
END;
$$;

-- =========================================================
-- ③ I CONTATORI DEGLI SPONSORIZZATI CON UN TETTO  (#36, #219)
-- =========================================================
-- Stessa idea della 117 sulle visite ai prodotti: non si vieta il conteggio
-- anonimo (chi vede un banner spesso non ha un account), si mette un tetto per
-- campagna al minuto. Il traffico vero ci sta sotto; un ciclo automatico no.
CREATE TABLE IF NOT EXISTS public.sponsored_tracking_rate (
  campaign_id uuid NOT NULL,
  kind        text NOT NULL,
  minuto      timestamptz NOT NULL,
  conteggio   int NOT NULL DEFAULT 0,
  PRIMARY KEY (campaign_id, kind, minuto)
);

COMMENT ON TABLE public.sponsored_tracking_rate IS
  'Quante volte al minuto una campagna è stata conteggiata: serve solo a mettere un tetto, si può svuotare quando si vuole.';

ALTER TABLE public.sponsored_tracking_rate ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sponsored_tracking_rate FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.sponsored_sotto_tetto(p_id uuid, p_kind text, p_tetto int)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_minuto timestamptz := date_trunc('minute', now());
  v_conteggio int;
BEGIN
  INSERT INTO public.sponsored_tracking_rate (campaign_id, kind, minuto, conteggio)
  VALUES (p_id, p_kind, v_minuto, 1)
  ON CONFLICT (campaign_id, kind, minuto)
  DO UPDATE SET conteggio = public.sponsored_tracking_rate.conteggio + 1
  RETURNING conteggio INTO v_conteggio;

  -- Pulizia occasionale: le righe più vecchie di un giorno non servono più.
  IF random() < 0.01 THEN
    DELETE FROM public.sponsored_tracking_rate WHERE minuto < now() - interval '1 day';
  END IF;

  RETURN v_conteggio <= p_tetto;
END;
$$;

CREATE OR REPLACE FUNCTION public.track_sponsored_impression(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Sessanta visualizzazioni al minuto per campagna: piu' di una al secondo,
  -- larghissimo per il traffico vero di una citta' di centomila abitanti.
  IF NOT public.sponsored_sotto_tetto(p_id, 'impression', 60) THEN
    RETURN;
  END IF;
  UPDATE public.sponsored_listings SET impressions = impressions + 1
   WHERE id = p_id AND status = 'active';
END;
$$;

CREATE OR REPLACE FUNCTION public.track_sponsored_click(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Dieci clic al minuto sulla stessa campagna: nessuna persona vera lo fa.
  IF NOT public.sponsored_sotto_tetto(p_id, 'click', 10) THEN
    RETURN;
  END IF;
  UPDATE public.sponsored_listings SET clicks = clicks + 1
   WHERE id = p_id AND status = 'active';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.sponsored_sotto_tetto(uuid, text, int) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.track_sponsored_impression(uuid) FROM public;
REVOKE EXECUTE ON FUNCTION public.track_sponsored_click(uuid)      FROM public;
GRANT EXECUTE ON FUNCTION public.track_sponsored_impression(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.track_sponsored_click(uuid)      TO anon, authenticated;

-- =========================================================
-- ④ GLI SCONTI IN UNA CHIAMATA SOLA  (#86)
-- =========================================================
-- Stessa logica di product_active_discount (032), per un elenco di prodotti.
CREATE OR REPLACE FUNCTION public.product_active_discounts(p_products uuid[])
RETURNS TABLE (product_id uuid, discount_percent int)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT pr.id AS product_id,
         COALESCE((
           SELECT MAX(sp.discount_percent)
             FROM public.seller_promotions sp
            WHERE sp.seller_id = pr.seller_id
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
$$;

COMMENT ON FUNCTION public.product_active_discounts(uuid[]) IS
  'Sconto promozione attivo per un elenco di prodotti, in una chiamata sola. Gemella di product_active_discount(uuid), stessa logica.';

GRANT EXECUTE ON FUNCTION public.product_active_discounts(uuid[]) TO anon, authenticated;

-- =========================================================
-- ⑤ LE VETRINE DEI NEGOZI, PRIMI N PER OGNI NEGOZIO  (#89, #93)
-- =========================================================
-- Il taglio globale (600 prodotti in tutto, ordinati per data) svuotava le
-- vetrine dei negozi meno recenti: comparivano con «0 prodotti», e non era
-- vero. LATERAL è il costrutto giusto: i primi N DI OGNI negozio.
CREATE OR REPLACE FUNCTION public.store_cards(p_per_store int DEFAULT 4, p_limit int DEFAULT 500)
RETURNS TABLE (
  seller_id uuid,
  prodotti  jsonb,
  totale    int
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.id AS seller_id,
         COALESCE((
           SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC)
             FROM (
               SELECT p.id, p.name, p.price, p.images, p.category_id, p.created_at
                 FROM public.products p
                WHERE p.seller_id = s.id
                  AND p.status = 'available'
                ORDER BY p.created_at DESC
                LIMIT GREATEST(1, LEAST(p_per_store, 20))
             ) x
         ), '[]'::jsonb) AS prodotti,
         (SELECT count(*)::int FROM public.products p2
           WHERE p2.seller_id = s.id AND p2.status = 'available') AS totale
    FROM public.seller_public_profiles s
   ORDER BY s.store_name
   LIMIT GREATEST(1, LEAST(p_limit, 2000));
$$;

COMMENT ON FUNCTION public.store_cards(int, int) IS
  'Per ogni negozio approvato: i primi N prodotti disponibili e il conteggio vero. Sostituisce il taglio globale che lasciava le vetrine vuote ai negozi meno recenti.';

GRANT EXECUTE ON FUNCTION public.store_cards(int, int) TO anon, authenticated;

-- =========================================================
-- ⑥ CANCELLARE UNA PERSONA NON CANCELLA I RESI  (#179)
-- =========================================================
-- L'anonimizzazione scritta nel codice («i resi restano, senza il nome») veniva
-- vanificata dallo schema: `returns.buyer_id` e `returns.seller_id` puntavano
-- agli utenti con ON DELETE CASCADE, quindi alla cancellazione dell'account le
-- righe dei resi sparivano fisicamente — insieme a quelle delle conversazioni.
--
-- Non e' solo un dato perso: un reso e' una pratica con dei soldi dentro, e
-- serve a noi (contestazioni, contabilita', obblighi fiscali) anche quando la
-- persona se n'e' andata. La forma giusta e' quella gia' usata su `orders`:
-- il legame si stacca (SET NULL) e la riga resta, anonima.
DO $$
BEGIN
  -- Le colonne devono poter restare vuote.
  ALTER TABLE public.returns        ALTER COLUMN buyer_id  DROP NOT NULL;
  ALTER TABLE public.returns        ALTER COLUMN seller_id DROP NOT NULL;
  ALTER TABLE public.conversations  ALTER COLUMN buyer_id  DROP NOT NULL;
  ALTER TABLE public.conversations  ALTER COLUMN seller_id DROP NOT NULL;
EXCEPTION WHEN undefined_column OR undefined_table THEN
  NULL; -- schema diverso: si lascia com'e' invece di fermare tutto
END $$;

ALTER TABLE public.returns DROP CONSTRAINT IF EXISTS returns_buyer_id_fkey;
ALTER TABLE public.returns ADD  CONSTRAINT returns_buyer_id_fkey
  FOREIGN KEY (buyer_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.returns DROP CONSTRAINT IF EXISTS returns_seller_id_fkey;
ALTER TABLE public.returns ADD  CONSTRAINT returns_seller_id_fkey
  FOREIGN KEY (seller_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.conversations DROP CONSTRAINT IF EXISTS conversations_buyer_id_fkey;
ALTER TABLE public.conversations ADD  CONSTRAINT conversations_buyer_id_fkey
  FOREIGN KEY (buyer_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.conversations DROP CONSTRAINT IF EXISTS conversations_seller_id_fkey;
ALTER TABLE public.conversations ADD  CONSTRAINT conversations_seller_id_fkey
  FOREIGN KEY (seller_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

COMMENT ON CONSTRAINT returns_buyer_id_fkey ON public.returns IS
  'SET NULL, non CASCADE: cancellare una persona anonimizza il reso, non lo distrugge (#179).';

-- =========================================================
-- ⑦ DOPPIO CLIC, UN ORDINE SOLO  (#172)
-- =========================================================
-- Gli ordini in contanti non avevano nessuna protezione contro il doppio invio.
-- Un doppio clic sul pulsante «Ordina» — o un tocco ripetuto su una rete lenta,
-- che e' la cosa piu' naturale del mondo quando non succede niente — creava due
-- ordini, riservava la merce due volte e addebitava il credito MyCity due volte.
-- Il percorso con la carta era coperto (la sessione Stripe ha la sua riga di
-- intento); quello in contanti no.
--
-- Il browser manda una chiave per tentativo di checkout: se arriva due volte, la
-- seconda si riconosce e si restituiscono gli stessi ordini invece di crearne
-- altri.
CREATE TABLE IF NOT EXISTS public.cod_checkout_attempts (
  chiave      text PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  order_ids   jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.cod_checkout_attempts IS
  'Un tentativo di ordine in contanti per chiave: il doppio invio ritrova gli ordini gia'' creati invece di crearne altri (#172).';

CREATE INDEX IF NOT EXISTS cod_checkout_attempts_utente_idx
  ON public.cod_checkout_attempts (user_id, created_at DESC);

ALTER TABLE public.cod_checkout_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cod_checkout_attempts FROM anon, authenticated;
-- Nessuna policy: ci scrive solo il server, con la chiave di servizio.

COMMIT;

NOTIFY pgrst, 'reload schema';

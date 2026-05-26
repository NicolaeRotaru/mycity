-- 029: completamento punti pendenti — welcome credit, search FTS RPC, wishlist
-- price alert, abandoned cart cron helper.
-- Tutto idempotente.

-- =============================================================================
-- WELCOME CREDIT €5 (= 100 pt) al signup
-- =============================================================================
-- Trigger: dopo INSERT su public.profiles → award 100 punti se l'utente non
-- ha già ricevuto il bonus. Idempotente.

CREATE OR REPLACE FUNCTION public.handle_new_profile_welcome_bonus()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Skip se già esiste una transazione signup_bonus per questo utente
    IF EXISTS (
        SELECT 1 FROM public.loyalty_transactions
        WHERE user_id = NEW.id AND reason = 'signup_bonus'
    ) THEN
        RETURN NEW;
    END IF;

    -- Skip se l'utente è admin/seller/rider (welcome credit solo per buyer)
    IF NEW.role <> 'buyer' AND NEW.role IS NOT NULL THEN
        RETURN NEW;
    END IF;

    -- Award 100 punti = €5 sconto
    PERFORM public.award_loyalty_points(NEW.id, 100, 'signup_bonus', NULL);

    -- Crea notifica visibile al buyer
    INSERT INTO public.notifications (user_id, title, body, link)
    VALUES (
        NEW.id,
        'Benvenuto su MyCity! Hai €5 di sconto',
        'Ti abbiamo regalato 100 punti = €5 di sconto sul tuo primo ordine. Si applicano automaticamente al checkout quando spendi almeno €10.',
        '/profile/loyalty'
    );

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profile_welcome_bonus ON public.profiles;
CREATE TRIGGER trg_profile_welcome_bonus
    AFTER INSERT ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_profile_welcome_bonus();

-- =============================================================================
-- SEARCH PRODUCTS RPC con FTS + trigram fallback
-- =============================================================================
-- Strategia: per query corte (< 3 char) usa prefix match veloce, per query
-- più lunghe usa Postgres FTS italiano con ranking. Restituisce sempre i
-- migliori risultati ordinati per rilevanza.

CREATE OR REPLACE FUNCTION public.search_products_smart(q text, lim int DEFAULT 10)
RETURNS TABLE (
    id uuid,
    name text,
    price numeric,
    images jsonb,
    seller_id uuid,
    store_name text,
    rank real
)
LANGUAGE plpgsql
STABLE
AS $$
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
            JOIN public.profiles pr ON pr.id = p.seller_id
            WHERE p.status = 'available'
              AND pr.is_approved = true
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
            JOIN public.profiles pr ON pr.id = p.seller_id
            WHERE p.status = 'available'
              AND pr.is_approved = true
              AND (
                p.search_tsv @@ websearch_to_tsquery('italian', q_trim)
                OR p.name % q_trim  -- fallback trigram fuzzy
              )
            ORDER BY rank DESC NULLS LAST, p.name
            LIMIT lim;
    END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.search_products_smart(text, int) TO anon, authenticated;

-- =============================================================================
-- WISHLIST PRICE ALERT
-- =============================================================================
-- Quando il prezzo di un prodotto cambia (diminuisce), notifica tutti gli
-- utenti che lo hanno nei preferiti.

CREATE OR REPLACE FUNCTION public.notify_favorite_price_drop()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_drop_percent numeric;
BEGIN
    -- Solo se il prezzo è SCESO
    IF NEW.price >= OLD.price THEN
        RETURN NEW;
    END IF;

    v_drop_percent := ROUND(((OLD.price - NEW.price) / OLD.price * 100)::numeric, 0);

    -- Skip se calo < 5% (rumore)
    IF v_drop_percent < 5 THEN
        RETURN NEW;
    END IF;

    -- Notifica a tutti gli utenti che hanno questo prodotto nei favoriti
    INSERT INTO public.notifications (user_id, title, body, link)
    SELECT
        f.user_id,
        '💰 Prezzo abbassato: ' || NEW.name,
        'Il prodotto che hai salvato è sceso di ' || v_drop_percent || '% — da €' ||
            ROUND(OLD.price, 2) || ' a €' || ROUND(NEW.price, 2),
        '/product/' || NEW.id
    FROM public.favorites f
    WHERE f.product_id = NEW.id;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_product_price_drop ON public.products;
CREATE TRIGGER trg_product_price_drop
    AFTER UPDATE OF price ON public.products
    FOR EACH ROW
    WHEN (NEW.price <> OLD.price)
    EXECUTE FUNCTION public.notify_favorite_price_drop();

-- =============================================================================
-- ABANDONED CART RECOVERY — cron job ready
-- =============================================================================
-- Funzione che ritorna tutti i carrelli abbandonati da più di 4 ore senza
-- email recovery già inviata. Da chiamare da un cron esterno (cron-job.org
-- o GitHub Actions schedule) che poi invia le email via Resend.

CREATE OR REPLACE FUNCTION public.list_abandoned_carts_to_recover(min_hours int DEFAULT 4)
RETURNS TABLE (
    user_id uuid,
    email text,
    full_name text,
    cart_data jsonb,
    cart_total numeric,
    last_activity timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
    LIMIT 100;
$$;

GRANT EXECUTE ON FUNCTION public.list_abandoned_carts_to_recover(int) TO service_role;

CREATE OR REPLACE FUNCTION public.mark_abandoned_cart_email_sent(p_user uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    UPDATE public.abandoned_carts
    SET recovery_email_sent_at = now()
    WHERE user_id = p_user;
$$;

GRANT EXECUTE ON FUNCTION public.mark_abandoned_cart_email_sent(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';

-- 027: foundation per loyalty + push + audit + abandoned cart + FTS + recently viewed + Q&A.
-- Mega-migration "growth+engagement+ops" perché molti pezzi sono indipendenti e
-- pesa di meno applicarli in una volta. Tutto idempotente.

-- =============================================================================
-- LOYALTY POINTS
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.loyalty_accounts (
    user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
    points_balance int NOT NULL DEFAULT 0 CHECK (points_balance >= 0),
    lifetime_earned int NOT NULL DEFAULT 0,
    tier text NOT NULL DEFAULT 'bronze' CHECK (tier IN ('bronze','silver','gold','platinum')),
    streak_days int NOT NULL DEFAULT 0,
    last_visit_date date,
    longest_streak int NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.loyalty_transactions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    delta int NOT NULL,
    reason text NOT NULL,
    order_id uuid,
    metadata jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS loyalty_tx_user_date_idx ON public.loyalty_transactions(user_id, created_at DESC);

ALTER TABLE public.loyalty_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loyalty_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS loyalty_own_read ON public.loyalty_accounts;
CREATE POLICY loyalty_own_read ON public.loyalty_accounts
    FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS loyalty_tx_own_read ON public.loyalty_transactions;
CREATE POLICY loyalty_tx_own_read ON public.loyalty_transactions
    FOR SELECT USING (auth.uid() = user_id);

-- RPC per aggiungere punti (SECURITY DEFINER, bypassa RLS in modo controllato)
CREATE OR REPLACE FUNCTION public.award_loyalty_points(
    p_user uuid,
    p_delta int,
    p_reason text,
    p_order uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.loyalty_accounts (user_id, points_balance, lifetime_earned)
    VALUES (p_user, GREATEST(0, p_delta), GREATEST(0, p_delta))
    ON CONFLICT (user_id) DO UPDATE SET
        points_balance = GREATEST(0, public.loyalty_accounts.points_balance + p_delta),
        lifetime_earned = public.loyalty_accounts.lifetime_earned + GREATEST(0, p_delta),
        tier = CASE
            WHEN public.loyalty_accounts.lifetime_earned + GREATEST(0, p_delta) >= 5000 THEN 'platinum'
            WHEN public.loyalty_accounts.lifetime_earned + GREATEST(0, p_delta) >= 2000 THEN 'gold'
            WHEN public.loyalty_accounts.lifetime_earned + GREATEST(0, p_delta) >= 500  THEN 'silver'
            ELSE 'bronze'
        END,
        updated_at = now();

    INSERT INTO public.loyalty_transactions (user_id, delta, reason, order_id)
    VALUES (p_user, p_delta, p_reason, p_order);
END;
$$;

-- RPC per "check-in" streak giornaliero
CREATE OR REPLACE FUNCTION public.touch_loyalty_streak()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid uuid;
    v_today date := CURRENT_DATE;
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
$$;

-- =============================================================================
-- PUSH NOTIFICATIONS
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    endpoint text UNIQUE NOT NULL,
    p256dh text NOT NULL,
    auth text NOT NULL,
    user_agent text,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS push_subs_user_idx ON public.push_subscriptions(user_id);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS push_own_rw ON public.push_subscriptions;
CREATE POLICY push_own_rw ON public.push_subscriptions
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- =============================================================================
-- AUDIT LOG (admin actions traceability)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.audit_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    action text NOT NULL,
    target_table text,
    target_id text,
    metadata jsonb,
    ip text,
    user_agent text,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_actor_idx ON public.audit_logs(actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_target_idx ON public.audit_logs(target_table, target_id);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Solo admin può leggerli
DROP POLICY IF EXISTS audit_admin_read ON public.audit_logs;
CREATE POLICY audit_admin_read ON public.audit_logs
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid() AND p.role = 'admin'
        )
    );

-- =============================================================================
-- ABANDONED CARTS (per email recovery)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.abandoned_carts (
    user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
    cart_data jsonb NOT NULL,
    cart_total numeric(10,2) NOT NULL DEFAULT 0,
    last_activity timestamptz NOT NULL DEFAULT now(),
    recovery_email_sent_at timestamptz,
    recovered boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS abandoned_pending_idx ON public.abandoned_carts(last_activity)
    WHERE recovery_email_sent_at IS NULL AND recovered = false;

ALTER TABLE public.abandoned_carts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS abandoned_own_rw ON public.abandoned_carts;
CREATE POLICY abandoned_own_rw ON public.abandoned_carts
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- =============================================================================
-- RECENTLY VIEWED
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.recently_viewed (
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    viewed_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, product_id)
);
CREATE INDEX IF NOT EXISTS recently_viewed_user_idx
    ON public.recently_viewed(user_id, viewed_at DESC);

ALTER TABLE public.recently_viewed ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS recently_viewed_own_rw ON public.recently_viewed;
CREATE POLICY recently_viewed_own_rw ON public.recently_viewed
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- =============================================================================
-- PRODUCT Q&A
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.product_questions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    author_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    question text NOT NULL CHECK (char_length(question) BETWEEN 5 AND 500),
    answer text,
    answered_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    answered_at timestamptz,
    is_public boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS product_questions_product_idx
    ON public.product_questions(product_id, created_at DESC);

ALTER TABLE public.product_questions ENABLE ROW LEVEL SECURITY;

-- Tutti possono leggere quelle pubbliche
DROP POLICY IF EXISTS qa_public_read ON public.product_questions;
CREATE POLICY qa_public_read ON public.product_questions
    FOR SELECT USING (is_public = true);

DROP POLICY IF EXISTS qa_insert_auth ON public.product_questions;
CREATE POLICY qa_insert_auth ON public.product_questions
    FOR INSERT WITH CHECK (auth.uid() = author_id);

-- Solo il seller del prodotto può rispondere (update)
DROP POLICY IF EXISTS qa_seller_answer ON public.product_questions;
CREATE POLICY qa_seller_answer ON public.product_questions
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM public.products p
            WHERE p.id = product_questions.product_id AND p.seller_id = auth.uid()
        )
    );

-- =============================================================================
-- PRODUCT VIEWS (per "trending today")
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.product_views (
    id bigserial PRIMARY KEY,
    product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    viewed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS product_views_product_time_idx
    ON public.product_views(product_id, viewed_at DESC);
CREATE INDEX IF NOT EXISTS product_views_time_idx
    ON public.product_views(viewed_at DESC);

ALTER TABLE public.product_views ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated o anche guest può scrivere (no RLS sul write)
DROP POLICY IF EXISTS pv_insert_any ON public.product_views;
CREATE POLICY pv_insert_any ON public.product_views
    FOR INSERT WITH CHECK (true);

-- =============================================================================
-- DROP DEL GIORNO (curated daily deal)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.daily_drops (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    drop_date date NOT NULL UNIQUE,
    discount_percent int NOT NULL CHECK (discount_percent BETWEEN 5 AND 70),
    original_price numeric(10,2) NOT NULL,
    drop_price numeric(10,2) NOT NULL,
    headline text,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS daily_drops_date_idx ON public.daily_drops(drop_date DESC);

ALTER TABLE public.daily_drops ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS daily_drops_public_read ON public.daily_drops;
CREATE POLICY daily_drops_public_read ON public.daily_drops
    FOR SELECT USING (true);

-- =============================================================================
-- STORIA DI OGGI (featured store of the day)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.daily_stories (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    seller_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    feature_date date NOT NULL UNIQUE,
    title text NOT NULL,
    body text NOT NULL,
    image_url text,
    cta_label text,
    cta_url text,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS daily_stories_date_idx ON public.daily_stories(feature_date DESC);

ALTER TABLE public.daily_stories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS daily_stories_public_read ON public.daily_stories;
CREATE POLICY daily_stories_public_read ON public.daily_stories
    FOR SELECT USING (true);

-- =============================================================================
-- DISPUTES / RECLAMI
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.disputes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id uuid NOT NULL,
    opener_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    against_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    reason text NOT NULL,
    description text NOT NULL,
    status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','under_review','resolved_buyer','resolved_seller','rejected')),
    resolution_notes text,
    resolved_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    resolved_at timestamptz,
    refund_cents int,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS disputes_status_idx ON public.disputes(status, created_at DESC);
CREATE INDEX IF NOT EXISTS disputes_opener_idx ON public.disputes(opener_id);
CREATE INDEX IF NOT EXISTS disputes_order_idx ON public.disputes(order_id);

ALTER TABLE public.disputes ENABLE ROW LEVEL SECURITY;

-- Le parti coinvolte vedono il proprio reclamo; admin vede tutto
DROP POLICY IF EXISTS disputes_party_read ON public.disputes;
CREATE POLICY disputes_party_read ON public.disputes
    FOR SELECT USING (
        auth.uid() IN (opener_id, against_id)
        OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
    );

DROP POLICY IF EXISTS disputes_open_insert ON public.disputes;
CREATE POLICY disputes_open_insert ON public.disputes
    FOR INSERT WITH CHECK (auth.uid() = opener_id);

-- =============================================================================
-- FULL TEXT SEARCH su products
-- =============================================================================

ALTER TABLE public.products
    ADD COLUMN IF NOT EXISTS search_tsv tsvector
    GENERATED ALWAYS AS (
        setweight(to_tsvector('italian', coalesce(name, '')), 'A') ||
        setweight(to_tsvector('italian', coalesce(description, '')), 'B')
    ) STORED;

CREATE INDEX IF NOT EXISTS products_search_tsv_idx ON public.products USING GIN (search_tsv);

-- Trigram per autocomplete fuzzy ("salumeira" → "salumeria")
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS products_name_trgm_idx ON public.products USING GIN (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS profiles_store_name_trgm_idx ON public.profiles USING GIN (store_name gin_trgm_ops)
    WHERE store_name IS NOT NULL;

-- =============================================================================

NOTIFY pgrst, 'reload schema';

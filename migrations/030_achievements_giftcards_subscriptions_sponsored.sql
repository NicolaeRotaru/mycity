-- 030: foundation per achievements, gift cards, subscription orders, sponsored
-- listings, referral leaderboard, photo reviews, sponsored ads, B2B.
-- Tutto idempotente.

-- =============================================================================
-- ACHIEVEMENTS / BADGE
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.achievements (
    id text PRIMARY KEY,
    title text NOT NULL,
    description text NOT NULL,
    icon text NOT NULL,
    points_reward int NOT NULL DEFAULT 0,
    tier text NOT NULL DEFAULT 'bronze' CHECK (tier IN ('bronze','silver','gold','platinum')),
    target_role text DEFAULT 'buyer' CHECK (target_role IN ('buyer','seller','rider','all')),
    sort_order int NOT NULL DEFAULT 0
);

INSERT INTO public.achievements (id, title, description, icon, points_reward, tier, target_role, sort_order) VALUES
    ('first_order',       'Primo ordine',          'Hai completato il tuo primo ordine!',         '🎯', 50, 'bronze', 'buyer', 1),
    ('order_5',           'Cliente affezionato',   'Hai completato 5 ordini.',                    '⭐', 100, 'bronze', 'buyer', 2),
    ('order_10',          'Cliente d''oro',        'Hai completato 10 ordini.',                   '🏆', 200, 'silver', 'buyer', 3),
    ('order_25',          'Cliente top',           'Hai completato 25 ordini.',                   '💎', 500, 'gold', 'buyer', 4),
    ('explorer_3',        'Esploratore',           'Hai comprato da 3 negozi diversi.',           '🗺️', 75, 'bronze', 'buyer', 5),
    ('explorer_10',       'Local Hero',            'Hai comprato da 10 negozi diversi.',          '🌟', 250, 'silver', 'buyer', 6),
    ('reviewer_5',        'Recensore',             'Hai scritto 5 recensioni.',                   '✍️', 100, 'bronze', 'buyer', 7),
    ('referrer_3',        'Ambasciatore',          'Hai invitato 3 amici che si sono iscritti.',  '🎁', 200, 'silver', 'buyer', 8),
    ('streak_7',          'Habitué',               '7 giorni consecutivi sulla piattaforma.',     '🔥', 0, 'bronze', 'buyer', 9),
    ('streak_30',         'Devoto',                '30 giorni consecutivi.',                      '⚡', 0, 'gold', 'buyer', 10),
    ('seller_first_sale', 'Prima vendita',         'Hai venduto il tuo primo prodotto!',          '💰', 100, 'bronze', 'seller', 11),
    ('seller_50_sales',   'Negozio attivo',        '50 vendite completate.',                      '📈', 500, 'silver', 'seller', 12),
    ('seller_top_rated',  'Top rated',             'Rating medio 4.5+ su almeno 10 recensioni.',  '👑', 300, 'gold', 'seller', 13)
ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title,
    description = EXCLUDED.description,
    points_reward = EXCLUDED.points_reward;

CREATE TABLE IF NOT EXISTS public.user_achievements (
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    achievement_id text NOT NULL REFERENCES public.achievements(id) ON DELETE CASCADE,
    unlocked_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, achievement_id)
);
CREATE INDEX IF NOT EXISTS user_achievements_user_idx ON public.user_achievements(user_id, unlocked_at DESC);

ALTER TABLE public.achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_achievements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS achievements_public_read ON public.achievements;
CREATE POLICY achievements_public_read ON public.achievements FOR SELECT USING (true);
DROP POLICY IF EXISTS user_achievements_own_read ON public.user_achievements;
CREATE POLICY user_achievements_own_read ON public.user_achievements FOR SELECT USING (auth.uid() = user_id);

-- RPC per sbloccare achievement (SECURITY DEFINER, evita race condition)
CREATE OR REPLACE FUNCTION public.unlock_achievement(p_user uuid, p_achievement text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_reward int;
    v_title text;
BEGIN
    -- Skip se già sbloccato
    IF EXISTS (SELECT 1 FROM public.user_achievements WHERE user_id = p_user AND achievement_id = p_achievement) THEN
        RETURN false;
    END IF;
    SELECT points_reward, title INTO v_reward, v_title FROM public.achievements WHERE id = p_achievement;
    IF NOT FOUND THEN RETURN false; END IF;

    INSERT INTO public.user_achievements (user_id, achievement_id) VALUES (p_user, p_achievement);

    IF v_reward > 0 THEN
        PERFORM public.award_loyalty_points(p_user, v_reward, 'achievement_' || p_achievement, NULL);
    END IF;

    INSERT INTO public.notifications (user_id, title, body, link)
    VALUES (p_user, '🏆 Achievement sbloccato!', 'Hai sbloccato "' || v_title || '" — vedi tutti i tuoi badge.', '/profile/achievements');
    RETURN true;
END;
$$;

-- =============================================================================
-- GIFT CARDS
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.gift_cards (
    code text PRIMARY KEY,
    amount_cents int NOT NULL CHECK (amount_cents > 0),
    balance_cents int NOT NULL,
    buyer_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    recipient_email text,
    recipient_name text,
    message text,
    redeemed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    redeemed_at timestamptz,
    expires_at timestamptz NOT NULL DEFAULT (now() + interval '2 years'),
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT gift_cards_balance_non_negative CHECK (balance_cents >= 0)
);
CREATE INDEX IF NOT EXISTS gift_cards_buyer_idx ON public.gift_cards(buyer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS gift_cards_recipient_idx ON public.gift_cards(redeemed_by);

ALTER TABLE public.gift_cards ENABLE ROW LEVEL SECURITY;
-- Buyer vede solo quelle che ha comprato; recipient vede solo quelle riscattate
DROP POLICY IF EXISTS gift_cards_owner_read ON public.gift_cards;
CREATE POLICY gift_cards_owner_read ON public.gift_cards
    FOR SELECT USING (auth.uid() = buyer_id OR auth.uid() = redeemed_by);

-- =============================================================================
-- SUBSCRIPTION ORDERS (ordine ricorrente)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.subscription_orders (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    seller_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    items jsonb NOT NULL,
    total_cents int NOT NULL,
    frequency text NOT NULL CHECK (frequency IN ('weekly','biweekly','monthly')),
    weekday int CHECK (weekday BETWEEN 0 AND 6),
    delivery_time time,
    delivery_address jsonb,
    payment_method text NOT NULL DEFAULT 'cod',
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','cancelled')),
    next_delivery_at timestamptz,
    last_delivery_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS subscription_orders_user_idx ON public.subscription_orders(user_id, status);
CREATE INDEX IF NOT EXISTS subscription_orders_next_delivery_idx ON public.subscription_orders(next_delivery_at)
    WHERE status = 'active';

ALTER TABLE public.subscription_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS subscription_orders_owner_rw ON public.subscription_orders;
CREATE POLICY subscription_orders_owner_rw ON public.subscription_orders
    FOR ALL USING (auth.uid() = user_id OR auth.uid() = seller_id);

-- =============================================================================
-- SPONSORED LISTINGS
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.sponsored_listings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id uuid REFERENCES public.products(id) ON DELETE CASCADE,
    seller_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    placement text NOT NULL CHECK (placement IN ('home_top','search_top','category_top')),
    category_slug text,
    start_date date NOT NULL,
    end_date date NOT NULL,
    daily_budget_cents int NOT NULL DEFAULT 500,
    spent_cents int NOT NULL DEFAULT 0,
    impressions int NOT NULL DEFAULT 0,
    clicks int NOT NULL DEFAULT 0,
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','ended')),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sponsored_listings_placement_idx ON public.sponsored_listings(placement, status)
    WHERE status = 'active';

ALTER TABLE public.sponsored_listings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sponsored_listings_public_read ON public.sponsored_listings;
CREATE POLICY sponsored_listings_public_read ON public.sponsored_listings FOR SELECT USING (status = 'active');
DROP POLICY IF EXISTS sponsored_listings_owner_rw ON public.sponsored_listings;
CREATE POLICY sponsored_listings_owner_rw ON public.sponsored_listings
    FOR ALL USING (auth.uid() = seller_id);

-- =============================================================================
-- REFERRAL TRACKING + LEADERBOARD
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.referrals (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    referrer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    referred_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    referred_email text,
    code text NOT NULL,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','signed_up','first_order','rewarded')),
    bonus_awarded boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    converted_at timestamptz
);
CREATE INDEX IF NOT EXISTS referrals_referrer_idx ON public.referrals(referrer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS referrals_code_idx ON public.referrals(code);

ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS referrals_referrer_read ON public.referrals;
CREATE POLICY referrals_referrer_read ON public.referrals FOR SELECT USING (auth.uid() = referrer_id);

-- View leaderboard mensile
CREATE OR REPLACE VIEW public.referral_leaderboard AS
SELECT
    p.id AS user_id,
    p.full_name,
    p.store_name,
    COUNT(r.id) AS total_referrals,
    COUNT(r.id) FILTER (WHERE r.status IN ('first_order','rewarded')) AS converted_referrals,
    DATE_TRUNC('month', now()) AS month
FROM public.profiles p
LEFT JOIN public.referrals r ON r.referrer_id = p.id
    AND r.created_at >= DATE_TRUNC('month', now())
GROUP BY p.id, p.full_name, p.store_name
HAVING COUNT(r.id) > 0
ORDER BY converted_referrals DESC, total_referrals DESC
LIMIT 50;

GRANT SELECT ON public.referral_leaderboard TO anon, authenticated;

-- =============================================================================
-- PHOTO REVIEWS (estende reviews)
-- =============================================================================
ALTER TABLE public.reviews
    ADD COLUMN IF NOT EXISTS photo_urls text[],
    ADD COLUMN IF NOT EXISTS verified_purchase boolean DEFAULT false;

-- =============================================================================
-- B2B BUSINESS ACCOUNTS
-- =============================================================================
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS account_type text DEFAULT 'private' CHECK (account_type IN ('private','business'));

CREATE TABLE IF NOT EXISTS public.business_orders (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id uuid NOT NULL,
    company_name text NOT NULL,
    vat_number text NOT NULL,
    sdi_code text,
    pec text,
    invoice_required boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS business_orders_order_idx ON public.business_orders(order_id);

ALTER TABLE public.business_orders ENABLE ROW LEVEL SECURITY;
-- L'owner del business_order è chi ha fatto l'ordine; lo determiniamo via order_id
DROP POLICY IF EXISTS business_orders_admin_read ON public.business_orders;
CREATE POLICY business_orders_admin_read ON public.business_orders FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
);

NOTIFY pgrst, 'reload schema';

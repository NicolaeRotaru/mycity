-- 034: Negozio del mese (admin pick + voto utenti) + Eventi MyCity + admin
-- audit_log triggers. Idempotente.

-- =============================================================================
-- SHOP OF MONTH
-- =============================================================================
-- Curated dall'admin OR vincitore del voto utenti del mese. Visibile in home
-- come hero feature.

CREATE TABLE IF NOT EXISTS public.shop_of_month (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    seller_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    month date NOT NULL UNIQUE, -- primo del mese, es. 2026-06-01
    cover_image_url text,
    headline text,
    story text,
    discount_code text, -- codice sconto sponsored attivo nel mese
    discount_percent int CHECK (discount_percent BETWEEN 0 AND 50),
    selected_by uuid REFERENCES public.profiles(id),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS shop_of_month_month_idx ON public.shop_of_month(month DESC);

ALTER TABLE public.shop_of_month ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS shop_of_month_public_read ON public.shop_of_month;
CREATE POLICY shop_of_month_public_read ON public.shop_of_month FOR SELECT USING (true);
DROP POLICY IF EXISTS shop_of_month_admin_write ON public.shop_of_month;
CREATE POLICY shop_of_month_admin_write ON public.shop_of_month
    FOR ALL USING (
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
    );

-- Sistema voti utenti (1 voto/utente/mese)
CREATE TABLE IF NOT EXISTS public.shop_of_month_votes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    voter_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    seller_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    month date NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (voter_id, month)
);
CREATE INDEX IF NOT EXISTS shop_of_month_votes_seller_idx ON public.shop_of_month_votes(seller_id, month);

ALTER TABLE public.shop_of_month_votes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS shop_of_month_votes_own_rw ON public.shop_of_month_votes;
CREATE POLICY shop_of_month_votes_own_rw ON public.shop_of_month_votes
    FOR ALL USING (auth.uid() = voter_id) WITH CHECK (auth.uid() = voter_id);
DROP POLICY IF EXISTS shop_of_month_votes_public_read ON public.shop_of_month_votes;
CREATE POLICY shop_of_month_votes_public_read ON public.shop_of_month_votes
    FOR SELECT USING (true);

-- View leaderboard mensile
CREATE OR REPLACE VIEW public.shop_of_month_leaderboard AS
SELECT
    p.id AS seller_id,
    p.store_name,
    p.store_logo,
    DATE_TRUNC('month', now())::date AS month,
    COUNT(v.id) AS vote_count
FROM public.profiles p
LEFT JOIN public.shop_of_month_votes v ON v.seller_id = p.id
    AND v.month = DATE_TRUNC('month', now())::date
WHERE p.role = 'seller' AND p.is_approved = true
GROUP BY p.id, p.store_name, p.store_logo
ORDER BY vote_count DESC, p.store_name
LIMIT 50;

GRANT SELECT ON public.shop_of_month_leaderboard TO anon, authenticated;

-- =============================================================================
-- EVENTI MYCITY (mercatino virtuale settimanale, etc)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.marketplace_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title text NOT NULL,
    description text NOT NULL,
    cover_image_url text,
    starts_at timestamptz NOT NULL,
    ends_at timestamptz NOT NULL,
    discount_percent int CHECK (discount_percent BETWEEN 0 AND 80),
    sponsor_seller_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    cta_label text DEFAULT 'Partecipa',
    cta_url text,
    status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','live','ended','cancelled')),
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT events_ends_after_starts CHECK (ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS events_window_idx ON public.marketplace_events(starts_at, ends_at)
    WHERE status IN ('scheduled', 'live');

ALTER TABLE public.marketplace_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS events_public_read ON public.marketplace_events;
CREATE POLICY events_public_read ON public.marketplace_events
    FOR SELECT USING (status IN ('scheduled', 'live', 'ended'));
DROP POLICY IF EXISTS events_admin_write ON public.marketplace_events;
CREATE POLICY events_admin_write ON public.marketplace_events
    FOR ALL USING (
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
    );

-- RSVP utenti agli eventi
CREATE TABLE IF NOT EXISTS public.event_rsvps (
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    event_id uuid NOT NULL REFERENCES public.marketplace_events(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, event_id)
);

ALTER TABLE public.event_rsvps ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS event_rsvps_own_rw ON public.event_rsvps;
CREATE POLICY event_rsvps_own_rw ON public.event_rsvps FOR ALL USING (auth.uid() = user_id);
DROP POLICY IF EXISTS event_rsvps_public_count_read ON public.event_rsvps;
CREATE POLICY event_rsvps_public_count_read ON public.event_rsvps FOR SELECT USING (true);

-- =============================================================================
-- REALTIME ORDERS (rider live tracking columns già in 011)
-- =============================================================================
-- Le colonne rider_lat/rider_lng/rider_position_updated_at esistono già da
-- migration 011. Qui assicuriamo solo che la tabella orders sia in publication
-- realtime, così il buyer può subscribire UPDATE per il tracking live.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'orders'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
    END IF;
END$$;

NOTIFY pgrst, 'reload schema';

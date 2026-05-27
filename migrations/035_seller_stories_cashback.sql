-- 035: Seller Stories (instagram-like) + Cashback condizionato
-- Idempotente. Esperti senior consultati:
-- - Senior PM: "Stories = formato che funziona perché ha urgenza (scade in 24h)
--   e bassa friction di creazione (foto+1 frase)."
-- - Behavioral Scientist: "Cashback condizionato sblocca azione specifica
--   (es. 5% se compri entro 24h) = leva FOMO + reward immediato."
-- - Marketplace PM: "Stories = strumento engagement per seller, no algoritmico
--   = relazione 1:1 con il proprio cliente."
-- - Trust & Safety: "Story scade automaticamente. Niente accumulo permanente
--   di contenuto user-generated da moderare."
-- - SRE: "INDEX su (seller_id, expires_at) per query veloce + autopulizia
--   logica via WHERE expires_at > now()."

-- =============================================================================
-- SELLER STORIES
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.seller_stories (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    seller_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    image_url text NOT NULL,
    caption text,
    link_url text, -- opzionale: link a un prodotto o categoria
    expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
    view_count int NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
);
-- Postgres rifiuta WHERE expires_at > now() in indici parziali perche'
-- now() e' STABLE non IMMUTABLE. Indice full ordinato e' comunque
-- efficiente: query con `expires_at > now()` usa range scan sull'indice.
CREATE INDEX IF NOT EXISTS seller_stories_active_idx ON public.seller_stories(seller_id, expires_at DESC);
CREATE INDEX IF NOT EXISTS seller_stories_global_active_idx ON public.seller_stories(expires_at DESC);

ALTER TABLE public.seller_stories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS seller_stories_public_read ON public.seller_stories;
CREATE POLICY seller_stories_public_read ON public.seller_stories
    FOR SELECT USING (expires_at > now());
DROP POLICY IF EXISTS seller_stories_owner_write ON public.seller_stories;
CREATE POLICY seller_stories_owner_write ON public.seller_stories
    FOR ALL USING (auth.uid() = seller_id) WITH CHECK (auth.uid() = seller_id);

-- Storage bucket per le immagini story (pubblico read)
INSERT INTO storage.buckets (id, name, public)
    VALUES ('stories', 'stories', true)
    ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "stories read public" ON storage.objects;
CREATE POLICY "stories read public" ON storage.objects FOR SELECT USING (bucket_id = 'stories');
DROP POLICY IF EXISTS "stories insert authenticated" ON storage.objects;
CREATE POLICY "stories insert authenticated" ON storage.objects FOR INSERT
    WITH CHECK (bucket_id = 'stories' AND auth.role() = 'authenticated');
DROP POLICY IF EXISTS "stories delete owner" ON storage.objects;
CREATE POLICY "stories delete owner" ON storage.objects FOR DELETE
    USING (bucket_id = 'stories' AND owner = auth.uid());

-- View tracking (1 view per utente per story, idempotente con UNIQUE)
CREATE TABLE IF NOT EXISTS public.seller_story_views (
    story_id uuid NOT NULL REFERENCES public.seller_stories(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    viewed_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (story_id, user_id)
);
ALTER TABLE public.seller_story_views ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS story_views_own_write ON public.seller_story_views;
CREATE POLICY story_views_own_write ON public.seller_story_views FOR ALL USING (auth.uid() = user_id);
DROP POLICY IF EXISTS story_views_owner_read ON public.seller_story_views;
CREATE POLICY story_views_owner_read ON public.seller_story_views FOR SELECT USING (
    auth.uid() = user_id OR
    EXISTS (SELECT 1 FROM public.seller_stories s WHERE s.id = story_id AND s.seller_id = auth.uid())
);

-- RPC per incrementare view counter atomicamente
CREATE OR REPLACE FUNCTION public.track_story_view(p_story uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_user uuid := auth.uid();
BEGIN
    IF v_user IS NULL THEN RETURN; END IF;
    INSERT INTO public.seller_story_views (story_id, user_id) VALUES (p_story, v_user) ON CONFLICT DO NOTHING;
    IF FOUND THEN
        UPDATE public.seller_stories SET view_count = view_count + 1 WHERE id = p_story;
    END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.track_story_view(uuid) TO authenticated;

-- =============================================================================
-- CASHBACK CONDIZIONATO
-- =============================================================================
-- Campagne admin che danno punti loyalty extra al buyer se compra entro X ore
-- da un trigger (es. visita store, abbandono carrello). Non implementiamo qui
-- la logica di trigger automatica, solo la struttura dati.

CREATE TABLE IF NOT EXISTS public.cashback_campaigns (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    description text,
    -- Condizione attivazione: 'first_order', 'return_after_inactive', 'cart_abandoned', 'new_signup'
    trigger_event text NOT NULL CHECK (trigger_event IN ('first_order','return_after_inactive','cart_abandoned','new_signup','category_purchase')),
    target_category_id uuid REFERENCES public.categories(id) ON DELETE CASCADE,
    -- Reward: punti loyalty extra (es. 100 = €1)
    bonus_points int NOT NULL DEFAULT 50,
    -- Validity window
    valid_hours int NOT NULL DEFAULT 24,
    starts_at timestamptz NOT NULL DEFAULT now(),
    ends_at timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
    min_order_cents int NOT NULL DEFAULT 0,
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','ended')),
    created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.cashback_campaigns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cashback_campaigns_public_read ON public.cashback_campaigns;
CREATE POLICY cashback_campaigns_public_read ON public.cashback_campaigns FOR SELECT USING (status = 'active');
DROP POLICY IF EXISTS cashback_campaigns_admin_write ON public.cashback_campaigns;
CREATE POLICY cashback_campaigns_admin_write ON public.cashback_campaigns FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
);

-- Track cashback ricevuti (1 per utente per campagna)
CREATE TABLE IF NOT EXISTS public.cashback_redemptions (
    campaign_id uuid NOT NULL REFERENCES public.cashback_campaigns(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
    points_awarded int NOT NULL,
    awarded_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (campaign_id, user_id)
);
ALTER TABLE public.cashback_redemptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cashback_redemptions_own_read ON public.cashback_redemptions;
CREATE POLICY cashback_redemptions_own_read ON public.cashback_redemptions FOR SELECT USING (auth.uid() = user_id);

-- =============================================================================
-- B2B BUSINESS_ORDERS RLS — abilita scrittura buyer (PRIVATE on order ownership)
-- =============================================================================
-- La table esiste da 030 ma serve solo admin read. Aggiungiamo policy buyer write
-- (può inserire un business_order solo se ha appena creato l'ordine corrispondente).

DROP POLICY IF EXISTS business_orders_buyer_write ON public.business_orders;
CREATE POLICY business_orders_buyer_write ON public.business_orders
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.orders o
            WHERE o.id = business_orders.order_id AND o.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS business_orders_buyer_read ON public.business_orders;
CREATE POLICY business_orders_buyer_read ON public.business_orders
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.orders o
            WHERE o.id = business_orders.order_id AND o.user_id = auth.uid()
        )
        OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
    );

NOTIFY pgrst, 'reload schema';

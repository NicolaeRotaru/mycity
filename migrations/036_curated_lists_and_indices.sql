-- 036: Curated lists (tastemakers) + indici performance critici mancanti
-- Idempotente. Esperti senior consultati:
-- - Senior PM: "Liste curate = user-generated curation. Power users diventano
--   tastemakers → engagement community + product discovery secondaria."
-- - Behavioral Scientist: "Social proof: vedere cosa compra una persona
--   reale è più persuasivo di ranking algoritmico."
-- - SRE: "Indici mancanti su FK e on-frequent-filter columns prima che la
--   tabella cresca → tempo di query stabile a milioni di righe."
-- - Trust & Safety: "Liste pubbliche o private. Default private = privacy first."
-- - Marketplace PM: "Liste integrate in /u/[handle] = nuovo asset social
--   sul profilo pubblico."

-- =============================================================================
-- CURATED LISTS (liste prodotti)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.product_lists (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    title text NOT NULL,
    description text,
    cover_emoji text DEFAULT '⭐',
    is_public boolean NOT NULL DEFAULT false,
    is_featured boolean NOT NULL DEFAULT false, -- selezionata admin per home
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS product_lists_owner_idx ON public.product_lists(owner_id);
CREATE INDEX IF NOT EXISTS product_lists_public_idx ON public.product_lists(is_public, updated_at DESC) WHERE is_public = true;
CREATE INDEX IF NOT EXISTS product_lists_featured_idx ON public.product_lists(is_featured, updated_at DESC) WHERE is_featured = true;

ALTER TABLE public.product_lists ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS product_lists_owner_rw ON public.product_lists;
CREATE POLICY product_lists_owner_rw ON public.product_lists
    FOR ALL USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
DROP POLICY IF EXISTS product_lists_public_read ON public.product_lists;
CREATE POLICY product_lists_public_read ON public.product_lists FOR SELECT USING (is_public = true);

CREATE TABLE IF NOT EXISTS public.product_list_items (
    list_id uuid NOT NULL REFERENCES public.product_lists(id) ON DELETE CASCADE,
    product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    sort_order int NOT NULL DEFAULT 0,
    note text, -- "perché l'ho messo in lista"
    added_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (list_id, product_id)
);
CREATE INDEX IF NOT EXISTS product_list_items_list_idx ON public.product_list_items(list_id, sort_order);

ALTER TABLE public.product_list_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS product_list_items_visible_read ON public.product_list_items;
CREATE POLICY product_list_items_visible_read ON public.product_list_items FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.product_lists l WHERE l.id = list_id AND (l.is_public = true OR l.owner_id = auth.uid()))
);
DROP POLICY IF EXISTS product_list_items_owner_write ON public.product_list_items;
CREATE POLICY product_list_items_owner_write ON public.product_list_items FOR ALL USING (
    EXISTS (SELECT 1 FROM public.product_lists l WHERE l.id = list_id AND l.owner_id = auth.uid())
) WITH CHECK (
    EXISTS (SELECT 1 FROM public.product_lists l WHERE l.id = list_id AND l.owner_id = auth.uid())
);

-- =============================================================================
-- INDICI MANCANTI (perf-critical su tabelle che crescono)
-- =============================================================================
-- SRE check: ogni FK e ogni filtered-WHERE deve avere indice prima che la
-- tabella crei pain.

CREATE INDEX IF NOT EXISTS orders_user_status_idx ON public.orders(user_id, delivery_status);
CREATE INDEX IF NOT EXISTS orders_seller_status_idx ON public.orders(seller_id, delivery_status);
CREATE INDEX IF NOT EXISTS orders_created_at_idx ON public.orders(created_at DESC);
CREATE INDEX IF NOT EXISTS order_items_product_idx ON public.order_items(product_id);
CREATE INDEX IF NOT EXISTS products_status_idx ON public.products(status) WHERE status = 'available';
CREATE INDEX IF NOT EXISTS products_category_status_idx ON public.products(category_id, status) WHERE status = 'available';
CREATE INDEX IF NOT EXISTS notifications_user_unread_idx ON public.notifications(user_id, is_read) WHERE is_read = false;

-- =============================================================================
-- RPC: claim_pending_emails — atomic batch claim per cron sender
-- =============================================================================
-- Reserve N email pendenti in modo atomic (no race between cron concurrent
-- runs). Esperti SRE: lock-free via FOR UPDATE SKIP LOCKED + UPDATE.

CREATE OR REPLACE FUNCTION public.claim_pending_emails(p_max int DEFAULT 50)
RETURNS TABLE (id uuid, user_id uuid, template text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    WITH picked AS (
        SELECT q.id, q.user_id, q.template
        FROM public.email_queue q
        WHERE q.send_at <= now()
          AND q.sent_at IS NULL
          AND q.cancelled_at IS NULL
        ORDER BY q.send_at
        LIMIT p_max
        FOR UPDATE SKIP LOCKED
    ),
    claimed AS (
        UPDATE public.email_queue q
        SET sent_at = NULL -- non ancora inviata, ma claimed via lock
        FROM picked
        WHERE q.id = picked.id
        RETURNING q.id, q.user_id, q.template
    )
    SELECT * FROM picked;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_pending_emails(int) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.claim_pending_emails(int) TO service_role;

NOTIFY pgrst, 'reload schema';

-- 031: promozioni create dal seller (sconti su singoli prodotti o categorie)
-- Idempotente.

CREATE TABLE IF NOT EXISTS public.seller_promotions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    seller_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    title text NOT NULL,
    discount_percent int NOT NULL CHECK (discount_percent BETWEEN 5 AND 70),
    -- Scope: tutto il negozio, una categoria, o singoli prodotti
    scope text NOT NULL CHECK (scope IN ('store','category','products')),
    category_id uuid,
    product_ids uuid[],
    starts_at timestamptz NOT NULL DEFAULT now(),
    ends_at timestamptz NOT NULL,
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','ended','cancelled')),
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ends_after_starts CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS seller_promotions_seller_idx
    ON public.seller_promotions(seller_id, status);
CREATE INDEX IF NOT EXISTS seller_promotions_active_window_idx
    ON public.seller_promotions(starts_at, ends_at) WHERE status = 'active';

ALTER TABLE public.seller_promotions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS promotions_public_read ON public.seller_promotions;
CREATE POLICY promotions_public_read ON public.seller_promotions FOR SELECT USING (
    status = 'active' AND starts_at <= now() AND ends_at >= now()
);

DROP POLICY IF EXISTS promotions_seller_rw ON public.seller_promotions;
CREATE POLICY promotions_seller_rw ON public.seller_promotions FOR ALL USING (auth.uid() = seller_id);

NOTIFY pgrst, 'reload schema';

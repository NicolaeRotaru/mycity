-- RPC: elenca i prodotti con uno sconto promo attivo, per la sezione home
-- "Promozioni" e la pagina pubblica /promozioni.
--
-- Riusa la stessa logica di product_active_discount() (migration 032) ma in
-- forma di set: per ogni prodotto disponibile di un negozio approvato calcola
-- il miglior sconto attivo tra le seller_promotions in corso e ritorna solo
-- quelli con sconto > 0. SECURITY INVOKER: rispetta le RLS del chiamante
-- (anon/authenticated leggono già prodotti pubblici, profili negozio e promo
-- attive), quindi nessun dato privato viene esposto.

CREATE OR REPLACE FUNCTION public.active_promo_products(p_limit int DEFAULT 12, p_seller uuid DEFAULT NULL)
RETURNS TABLE (
    product_id uuid,
    name text,
    price numeric,
    images jsonb,
    seller_id uuid,
    store_name text,
    discount_percent int
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
    SELECT
        p.id AS product_id,
        p.name,
        p.price,
        p.images,
        p.seller_id,
        pr.store_name,
        MAX(sp.discount_percent)::int AS discount_percent
    FROM public.products p
    JOIN public.profiles pr ON pr.id = p.seller_id
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
      AND pr.is_approved = true
      AND (p_seller IS NULL OR p.seller_id = p_seller)
    GROUP BY p.id, p.name, p.price, p.images, p.seller_id, pr.store_name
    ORDER BY discount_percent DESC, p.id
    LIMIT GREATEST(p_limit, 1);
$$;

GRANT EXECUTE ON FUNCTION public.active_promo_products(int, uuid) TO anon, authenticated;

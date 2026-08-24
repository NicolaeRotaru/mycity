-- Le vetrine delle promozioni non sapevano se un prodotto è finito né se ha varianti.
--
-- IL DIFETTO. `active_promo_products` (migration 056) ritorna product_id, name, price, images,
-- seller_id, store_name, discount_percent. Né `stock` né `has_variants`. La sezione «Sconti attivi»
-- in home e la pagina /promozioni — cioè il traffico più caldo, quello attirato dallo sconto —
-- costruiscono le schede prodotto senza quei due campi. Risultato: il badge «Esaurito» non compare
-- mai, il «+» è sempre premibile, e su un prodotto con varianti aggiunge al carrello una riga senza
-- variante. Il muro arriva al checkout, dopo che la persona ha già scelto.
--
-- Tutte le altre griglie del sito quei due campi li passano. Qui mancavano ALLA SORGENTE, quindi
-- nessuna correzione lato pagina poteva bastare.
--
-- PERCHÉ DROP E NON CREATE OR REPLACE. In Postgres il tipo di ritorno di una funzione non si può
-- cambiare con CREATE OR REPLACE: aggiungere due colonne alla RETURNS TABLE richiede di eliminarla
-- e ricrearla. La firma (int, uuid), il linguaggio, la volatilità, il SECURITY INVOKER e i permessi
-- restano identici: cambia solo cosa ritorna, in più.

DROP FUNCTION IF EXISTS public.active_promo_products(int, uuid);

CREATE FUNCTION public.active_promo_products(p_limit int DEFAULT 12, p_seller uuid DEFAULT NULL)
RETURNS TABLE (
    product_id uuid,
    name text,
    price numeric,
    images jsonb,
    seller_id uuid,
    store_name text,
    discount_percent int,
    stock int,
    has_variants boolean
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
        MAX(sp.discount_percent)::int AS discount_percent,
        p.stock,
        p.has_variants
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
    GROUP BY p.id, p.name, p.price, p.images, p.seller_id, pr.store_name, p.stock, p.has_variants
    ORDER BY discount_percent DESC, p.id
    LIMIT GREATEST(p_limit, 1);
$$;

GRANT EXECUTE ON FUNCTION public.active_promo_products(int, uuid) TO anon, authenticated;

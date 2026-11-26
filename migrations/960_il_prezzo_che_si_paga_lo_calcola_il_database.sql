-- 960 — Il prezzo che il cliente paga, come colonna calcolata di `products`.
--
-- IL DIFETTO. La griglia dei prodotti (lib/queries/griglia-prodotti.ts) ordina e taglia sul prezzo
-- PIENO (`price`), mentre la scheda mostra e la cassa addebita il prezzo scontato: un prodotto da
-- 12 € al -25% (9 € alla cassa) finisce dopo uno da 9,99 € in «prezzo crescente» e resta nell'elenco
-- con «prezzo minimo 10 €». Lo sconto non sta su `products`: sta nelle promozioni attive del negozio
-- (`seller_promotions`), quindi un ordine corretto fra una pagina e l'altra lo può dare solo il
-- database.
--
-- LA CURA. Una funzione con un argomento di tipo `products`: PostgREST la espone come colonna
-- calcolata, e la lettura può scrivere `order=prezzo_pagato.asc` e `prezzo_pagato=gte.10` come per
-- una colonna vera, con la finestra (`range`) che resta esatta. La regola dello sconto è quella di
-- `active_promo_products` (stesse date, stesso bersaglio: negozio, categoria o elenco di prodotti;
-- vale la promozione più alta) e quella di `discountedUnitCents` nel sito (tetto 70%, arrotondato al
-- centesimo). Il conto è lo stesso di `discountedUnitCents`, in virgola mobile e con lo stesso
-- Math.round (mezzo verso l'alto): in numeric esatto 19,99 € al -50% dava 10,00 € e la cassa 9,99 €. Non è SECURITY DEFINER: le promozioni le legge chi chiama, con le regole di lettura di
-- `seller_promotions` (un negozio fuori vetrina non ha sconto per i visitatori).
--
-- REVERSIBILE: `DROP FUNCTION public.prezzo_pagato(public.products)`; nessun dato toccato.

CREATE OR REPLACE FUNCTION public.prezzo_pagato(p public.products)
 RETURNS numeric
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT round(
    floor(
      p.price::float8 * (1::float8 - GREATEST(0, LEAST(70, COALESCE((
        SELECT MAX(sp.discount_percent)
          FROM public.seller_promotions sp
         WHERE sp.seller_id = p.seller_id
           AND sp.status = 'active'
           AND sp.starts_at <= now()
           AND sp.ends_at >= now()
           AND (
                sp.scope = 'store'
             OR (sp.scope = 'category' AND sp.category_id = p.category_id)
             OR (sp.scope = 'products' AND p.id = ANY(sp.product_ids))
           )
      ), 0)))::float8 / 100::float8) * 100::float8 + 0.5::float8
    )::numeric / 100,
    2
  )
$function$;

COMMENT ON FUNCTION public.prezzo_pagato(public.products) IS
  'Il prezzo che si paga: price meno la promozione attiva piu alta del negozio. Colonna calcolata per la griglia (ordine e filtro di prezzo).';

-- Permessi scritti accanto alla funzione (regola della migrazione 425): la leggono la vetrina
-- (anon), i clienti e i negozi (authenticated) e il server (service_role).
GRANT EXECUTE ON FUNCTION public.prezzo_pagato(public.products) TO anon, authenticated, service_role;

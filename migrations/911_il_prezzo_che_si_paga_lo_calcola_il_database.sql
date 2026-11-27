-- 911 — Il prezzo che il cliente paga, come colonna calcolata di `products`.
--
-- IL DIFETTO. La griglia dei prodotti (lib/queries/griglia-prodotti.ts) ordina e taglia sul prezzo
-- PIENO (`price`), mentre la scheda mostra e la cassa addebita il prezzo scontato: un prodotto da
-- 12 € al -25% (9 € alla cassa) finisce dopo uno da 9,99 € in «prezzo crescente», resta nell'elenco
-- con «prezzo minimo 10 €» e resta fuori dalla forchetta 5-10 € dello slider. Lo sconto non sta su
-- `products`: sta nelle promozioni attive del negozio (`seller_promotions`), quindi un ordine e un
-- taglio giusti fra una pagina e l'altra li può dare solo il database.
--
-- LA CURA. Una funzione con un argomento di tipo `products`: PostgREST la espone come colonna
-- calcolata, e la lettura può scrivere `order=prezzo_pagato.asc`, `prezzo_pagato=gte.10` e
-- `prezzo_pagato=lte.10` come per una colonna vera, con la finestra (`range`) che resta esatta.
-- La regola dello sconto è quella di `product_active_discounts` com'è dopo la 709 (la fonte della
-- cassa): stesse date, stesso bersaglio (negozio, categoria o elenco di prodotti), vale la
-- promozione più alta, e un negozio fuori vetrina (modalità demo) non sconta niente, tranne che al
-- negozio stesso nella sua anteprima. Il conto è quello di `discountedUnitCents` nel sito (tetto 70%,
-- in virgola mobile e con lo stesso Math.round, mezzo verso l'alto): in numeric esatto 19,99 € al
-- -50% darebbe 10,00 € e la cassa 9,99 €.
-- Non è SECURITY DEFINER (la regola della 10 sulle funzioni potenti aperte agli anonimi): le
-- promozioni le legge chi chiama, con le regole di lettura di `seller_promotions`, e la condizione
-- sulla vetrina scritta qui sotto la rende uguale per tutti a `product_active_discounts`.
--
-- Nessuna migrazione dopo la 709 cambia `product_active_discounts`, `active_promo_products`,
-- `seller_promotions` o `negozio_in_vetrina`; nessuna dopo questa ridefinisce `prezzo_pagato`.
--
-- IL SITO NON LA ASPETTA: finché non è applicata, la griglia se ne accorge (la colonna non c'è) e
-- legge alla vecchia maniera, sul prezzo pieno.
--
-- VELOCE ANCHE CON UN CATALOGO GRANDE. Ordine e filtri di prezzo calcolano `prezzo_pagato` per ogni
-- prodotto. La prima versione era una funzione SQL con SET search_path e una sotto-ricerca dentro:
-- Postgres non la srotola nella query, e la chiamava riga per riga con tutto il suo peso (sul Postgres
-- locale, da anon, 20.000 prodotti: 4,2-4,4 s per «minimo 10 € e prezzo crescente», oltre i 3 s di
-- anon). Ora è divisa in due:
--   · `sconto_che_si_paga(negozio, categoria, prodotto)` cerca la promozione (la sotto-ricerca di
--     prima, uguale; la condizione sulla vetrina si guarda solo se una promozione c'è);
--   · `prezzo_pagato(products)` è una sola espressione, senza SET e senza sotto-ricerche: Postgres
--     la srotola nella query, e resta una chiamata leggera per riga.
-- Stesso Postgres, stessi 20.000 prodotti: 1,5 s per la stessa domanda, 1,0 s per il solo ordine.
-- Le due funzioni sono SECURITY INVOKER: la 10 non cambia.
--
-- Si può rieseguire. NON si applica a mano: lo decide Nicola, come ogni migrazione.
-- REVERSIBILE: `DROP FUNCTION public.prezzo_pagato(public.products); DROP FUNCTION
-- public.sconto_che_si_paga(uuid, uuid, uuid)`; nessun dato toccato.
-- LE PROVE: tests/sql/rls/riparazione-r21-prezzo-pagato.test.sql (il conto) e
-- tests/sql/rls/riparazione-r21-prezzo-pagato-veloce.test.sql (la velocità su 20.000 prodotti).

CREATE OR REPLACE FUNCTION public.sconto_che_si_paga(p_seller uuid, p_category uuid, p_product uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(MAX(sp.discount_percent), 0)
    FROM public.seller_promotions sp
   WHERE sp.seller_id = p_seller
     AND sp.status = 'active'
     AND sp.starts_at <= now()
     AND sp.ends_at >= now()
     AND (
          sp.scope = 'store'
       OR (sp.scope = 'category' AND sp.category_id = p_category)
       OR (sp.scope = 'products' AND p_product = ANY(sp.product_ids))
     )
     -- 709: un negozio in modalità demo non sconta in pubblico; il proprietario vede i suoi sconti
     AND (public.negozio_in_vetrina(sp.seller_id) OR sp.seller_id = (SELECT auth.uid()))
$function$;

COMMENT ON FUNCTION public.sconto_che_si_paga(uuid, uuid, uuid) IS
  'La promozione attiva piu alta che vale per un prodotto (0 se nessuna), con la regola di product_active_discounts. La usa prezzo_pagato.';

GRANT EXECUTE ON FUNCTION public.sconto_che_si_paga(uuid, uuid, uuid) TO anon, authenticated, service_role;

-- Senza SET e senza sotto-ricerche: così Postgres la srotola nella query (i nomi sono tutti scritti
-- con lo schema). Non aggiungere un SET search_path: tornerebbe lenta.
CREATE OR REPLACE FUNCTION public.prezzo_pagato(p public.products)
 RETURNS numeric
 LANGUAGE sql
 STABLE
AS $function$
  SELECT round(
    floor(
      p.price::float8
        * (1::float8 - GREATEST(0, LEAST(70, public.sconto_che_si_paga(p.seller_id, p.category_id, p.id)))::float8 / 100::float8)
        * 100::float8
      + 0.5::float8
    )::numeric / 100,
    2
  )
$function$;

COMMENT ON FUNCTION public.prezzo_pagato(public.products) IS
  'Il prezzo che si paga: price meno la promozione attiva piu alta del negozio, come product_active_discounts e discountedUnitCents. Colonna calcolata per la griglia (ordine e filtri di prezzo).';

-- Permessi scritti accanto alla funzione (regola della migrazione 425): la leggono la vetrina
-- (anon), i clienti e i negozi (authenticated) e il server (service_role).
GRANT EXECUTE ON FUNCTION public.prezzo_pagato(public.products) TO anon, authenticated, service_role;

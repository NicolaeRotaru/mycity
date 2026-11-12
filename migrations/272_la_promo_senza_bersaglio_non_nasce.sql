-- =============================================================================
-- 272 — Una promozione senza bersaglio non nasce, e quelle già nate si spengono (R03-020)
-- =============================================================================
-- Il modulo «Nuova promozione» offriva «Una categoria specifica» ma non faceva
-- scegliere quale: la riga nasceva con scope='category' e category_id NULL.
-- Tutte le funzioni che applicano lo sconto (122, 129) confrontano
-- sp.category_id = pr.category_id: con NULL non è mai vero, quindi nessun
-- prodotto veniva scontato, né in scheda né in cassa. Intanto la riga contava
-- come promo attiva: la striscia «Promozioni attive» si accendeva per tutti e la
-- vetrina del negozio annunciava «-15%» a chi poi pagava il prezzo pieno.
--
-- ① Le promo attive (o in bozza) senza bersaglio si annullano: annunciano uno
--    sconto che non c'è.
-- ② Due vincoli, per le promo attive o in bozza: una promo di categoria ha la
--    sua categoria, una promo di prodotti ha almeno un prodotto. Valgono su tutte
--    le righe (niente NOT VALID, come chiede la prova 14): quelle annullate al
--    passo ① non annunciano più niente e restano com'erano.
--
-- Il modulo (app/seller/promotions/page.tsx) adesso fa scegliere la categoria.
-- Prova: tests/sql/rls/riparazione-r03-promo-senza-bersaglio.test.sql
-- Per tornare indietro: DROP CONSTRAINT dei due vincoli qui sotto (le promo
-- annullate restano annullate: riaccenderle rimetterebbe in vetrina lo sconto finto).
-- =============================================================================

BEGIN;

UPDATE public.seller_promotions
   SET status = 'cancelled'
 WHERE status IN ('active', 'draft')
   AND ((scope = 'category' AND category_id IS NULL)
     OR (scope = 'products' AND coalesce(cardinality(product_ids), 0) = 0));

ALTER TABLE public.seller_promotions DROP CONSTRAINT IF EXISTS seller_promotions_la_categoria_c_e;
ALTER TABLE public.seller_promotions
  ADD CONSTRAINT seller_promotions_la_categoria_c_e
  CHECK (status NOT IN ('active', 'draft') OR scope <> 'category' OR category_id IS NOT NULL);

ALTER TABLE public.seller_promotions DROP CONSTRAINT IF EXISTS seller_promotions_i_prodotti_ci_sono;
ALTER TABLE public.seller_promotions
  ADD CONSTRAINT seller_promotions_i_prodotti_ci_sono
  CHECK (status NOT IN ('active', 'draft') OR scope <> 'products' OR coalesce(cardinality(product_ids), 0) > 0);

COMMIT;

NOTIFY pgrst, 'reload schema';

-- 082_products_insert_seller_bind.sql
--
-- FIX integrità/sicurezza (attribution spoofing).
-- La policy INSERT su products verificava SOLO che il chiamante fosse un seller
-- approvato, senza legare la riga a chi la inserisce. Un seller approvato poteva
-- quindi inserire (via PostgREST diretto) prodotti con seller_id di un ALTRO
-- venditore: prodotti/recensioni/payout finirebbero attribuiti al negozio
-- sbagliato.
--
-- Aggiunge il bind seller_id = auth.uid(). Usa (SELECT auth.uid()) per beneficiare
-- dell'ottimizzazione initplan delle RLS (coerente con 050/051).
--
-- NB: NON cambia il modello "il seller approvato pubblica liberamente" (lo status
-- di default resta scelto dal client) — chiude solo lo spoofing dell'attribuzione.
-- Idempotente: drop-if-exists + recreate.

DROP POLICY IF EXISTS "Approved sellers can insert products" ON public.products;

CREATE POLICY "Approved sellers can insert products"
    ON public.products FOR INSERT
    WITH CHECK (
        seller_id = (SELECT auth.uid())
        AND EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = (SELECT auth.uid()) AND is_approved = true
        )
    );

NOTIFY pgrst, 'reload schema';

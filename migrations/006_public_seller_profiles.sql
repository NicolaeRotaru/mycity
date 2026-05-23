-- 006: rende pubblicamente leggibili i profili dei seller approvati
--
-- Bug: la policy SELECT iniziale ("Users can view their own profile") era l'unica
-- regola SELECT su profiles, quindi un buyer non poteva vedere nessun negozio:
-- la pagina /stores, StoreShowcase e l'embed `profiles!products_seller_id_fkey`
-- restavano vuoti per chiunque non fosse il proprietario di quel profilo.
--
-- Aggiungiamo una policy che permette a chiunque (anche anonimo) di leggere
-- i campi pubblici dei seller approvati: chi vende, dove, come contattarlo.
--
-- Idempotente.

DROP POLICY IF EXISTS "Anyone can view approved seller profiles" ON public.profiles;

CREATE POLICY "Anyone can view approved seller profiles"
    ON public.profiles FOR SELECT
    USING (
        is_approved = true
        AND store_name IS NOT NULL
    );

NOTIFY pgrst, 'reload schema';

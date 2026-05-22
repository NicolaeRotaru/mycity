-- 005: collega products.seller_id direttamente a profiles(id) invece che a auth.users(id)
-- Cos� PostgREST riesce a fare l'embedding `profiles!products_seller_id_fkey`
-- usato da ProductGrid, product page, ecc.
--
-- L'integrit� referenziale � comunque garantita: profiles.id REFERENCES auth.users(id)
-- ON DELETE CASCADE, quindi cancellare un utente continua a propagare correttamente.
--
-- Idempotente: ri-eseguibile senza errori.

ALTER TABLE public.products
    DROP CONSTRAINT IF EXISTS products_seller_id_fkey;

ALTER TABLE public.products
    ADD CONSTRAINT products_seller_id_fkey
    FOREIGN KEY (seller_id)
    REFERENCES public.profiles(id)
    ON DELETE SET NULL;

-- Force PostgREST schema cache reload (Supabase listens to this notification)
NOTIFY pgrst, 'reload schema';

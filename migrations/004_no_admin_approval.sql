-- 004: rimuove l'approvazione admin per i seller + colonna store_address
-- Idempotente: ri-eseguibile senza errori.

-- 1) Trigger: alla registrazione, se il ruolo scelto è 'seller', il profilo
--    nasce già con role='seller' e is_approved=true (niente più 'pending_approval').
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
DECLARE
    role_choice text;
BEGIN
    role_choice := COALESCE(new.raw_user_meta_data->>'role', 'buyer');
    INSERT INTO public.profiles (id, role, is_approved)
    VALUES (
        new.id,
        CASE WHEN role_choice = 'seller' THEN 'seller' ELSE 'buyer' END,
        CASE WHEN role_choice = 'seller' THEN true  ELSE false END
    );
    RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2) Backfill: approva tutti i seller esistenti in attesa
UPDATE public.profiles
SET role = 'seller', is_approved = true
WHERE role = 'pending_approval';

-- 3) Nuova colonna per l'indirizzo testuale del negozio
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS store_address text;

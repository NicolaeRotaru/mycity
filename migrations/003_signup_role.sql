-- Aggiorna il trigger handle_new_user per leggere il ruolo scelto in fase di signup
-- via raw_user_meta_data.role ('buyer' o 'seller').
-- Se l'utente sceglie 'seller', il profilo viene creato con role='pending_approval'.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
DECLARE
    role_choice text;
BEGIN
    role_choice := COALESCE(new.raw_user_meta_data->>'role', 'buyer');
    INSERT INTO public.profiles (id, role)
    VALUES (
        new.id,
        CASE WHEN role_choice = 'seller' THEN 'pending_approval' ELSE 'buyer' END
    );
    RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

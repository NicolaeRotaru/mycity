-- 110: Fix "Public profile read" — la policy di 033 esponeva l'intera riga profiles
--      (IBAN, codice fiscale, stripe_account_id, wallet_balance_cents, ecc.)
--      a chiunque per i profili con public_profile_enabled=true.
--
-- La migrazione 107 ha già chiuso la stessa classe di problema per i seller
-- con una VIEW a colonne whitelist. Qui si applica lo stesso pattern ai profili pubblici.
--
-- Fix:
--   1) Drop della policy permissiva 'Public profile read' (che dava accesso all'intera riga)
--   2) View pubblica sicura con SOLO i campi non sensibili
--   3) Grant SELECT sulla view a anon e authenticated
--
-- La policy residua (self-read: auth.uid() = id) rimane tramite le policy esistenti.
-- Idempotente.

-- Rimuove la policy permissiva
DROP POLICY IF EXISTS "Public profile read" ON public.profiles;
DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON public.profiles;

-- View pubblica sicura: solo campi non sensibili
CREATE OR REPLACE VIEW public.public_buyer_profiles AS
  SELECT
    id,
    public_handle,
    public_bio,
    public_avatar_url,
    created_at
  FROM public.profiles
  WHERE public_profile_enabled = true;

-- Permessi: anon e authenticated possono leggere la view (non la tabella base)
GRANT SELECT ON public.public_buyer_profiles TO anon, authenticated;

-- Assicura che la policy self-read esista per consentire agli utenti di leggere il proprio profilo
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
CREATE POLICY "Users can view own profile" ON public.profiles
  FOR SELECT TO authenticated
  USING (auth.uid() = id);

NOTIFY pgrst, 'reload schema';

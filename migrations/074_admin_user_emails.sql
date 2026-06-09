-- 074 — admin_list_user_emails: espone email + ultimo accesso da auth.users
-- alla dashboard admin.
--
-- Problema: la pagina /admin/users legge solo public.profiles, che NON contiene
-- l'email (vive in auth.users, non accessibile dal client browser). Gli utenti
-- senza full_name comparivano come "—" senza alcun dato identificativo.
--
-- Soluzione: RPC SECURITY DEFINER che legge auth.users, ma SOLO per gli admin
-- (guard is_admin(), altrimenti solleva eccezione). Esposta a `authenticated`
-- ma di fatto utilizzabile solo dagli admin. Idempotente.

CREATE OR REPLACE FUNCTION public.admin_list_user_emails()
RETURNS TABLE (
  id                 uuid,
  email              text,
  phone              text,
  last_sign_in_at    timestamptz,
  email_confirmed_at timestamptz,
  created_at         timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;
  RETURN QUERY
    SELECT
      u.id,
      u.email::text,
      u.phone::text,
      u.last_sign_in_at,
      u.email_confirmed_at,
      u.created_at
    FROM auth.users u;
END;
$$;

-- Lockdown coerente con 064/067: niente anon, solo authenticated (poi filtrato
-- da is_admin() dentro la funzione).
REVOKE ALL ON FUNCTION public.admin_list_user_emails() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_user_emails() TO authenticated;

NOTIFY pgrst, 'reload schema';

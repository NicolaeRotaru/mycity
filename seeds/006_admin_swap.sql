-- Seed 006: crea admin demo dedicato + demoziona nicolaflorea50 a buyer
--
-- Idempotente: ripetibile senza danni.
-- Crea admin con email admin@piacenza-demo.local e password PiacenzaDemo2025!

DO $$
DECLARE
  admin_uuid  uuid := '33333333-3333-3333-3333-aaaaaaaa0001';
  admin_email text := 'admin@piacenza-demo.local';
  pwd text := crypt('PiacenzaDemo2025!', gen_salt('bf'));
BEGIN
  ----------------------------------------------------------------
  -- 1) Demoziona l'attuale admin (nicolaflorea50@gmail.com) a buyer
  ----------------------------------------------------------------
  UPDATE public.profiles
  SET role = 'buyer', is_approved = false
  WHERE id = (SELECT id FROM auth.users WHERE email = 'nicolaflorea50@gmail.com');

  ----------------------------------------------------------------
  -- 2) Cleanup: rimuovi eventuali tentativi precedenti rotti
  ----------------------------------------------------------------
  DELETE FROM auth.users
  WHERE id = admin_uuid OR email = admin_email;

  ----------------------------------------------------------------
  -- 3) Crea l'admin demo con tutti i campi auth corretti
  ----------------------------------------------------------------
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at,
    invited_at,
    confirmation_token, confirmation_sent_at,
    recovery_token,     recovery_sent_at,
    email_change_token_new, email_change, email_change_sent_at,
    last_sign_in_at,
    raw_app_meta_data, raw_user_meta_data,
    is_super_admin,
    created_at, updated_at,
    phone, phone_confirmed_at, phone_change, phone_change_token, phone_change_sent_at,
    email_change_token_current, email_change_confirm_status,
    banned_until,
    reauthentication_token, reauthentication_sent_at,
    is_sso_user
  ) VALUES (
    '00000000-0000-0000-0000-000000000000',
    admin_uuid,
    'authenticated',
    'authenticated',
    admin_email,
    pwd,
    now(),
    NULL,
    '', NULL,
    '', NULL,
    '', '', NULL,
    NULL,
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"role":"admin"}'::jsonb,
    false,
    now(), now(),
    NULL, NULL, '', '', NULL,
    '', 0,
    NULL,
    '', NULL,
    false
  );

  -- Identita' (richiesta da GoTrue)
  INSERT INTO auth.identities (
    id, provider_id, user_id, identity_data, provider,
    last_sign_in_at, created_at, updated_at
  ) VALUES (
    gen_random_uuid(),
    admin_uuid::text,
    admin_uuid,
    jsonb_build_object('sub', admin_uuid::text, 'email', admin_email, 'email_verified', true, 'phone_verified', false),
    'email',
    now(), now(), now()
  );

  ----------------------------------------------------------------
  -- 4) Profilo admin (in caso il trigger non l'abbia creato)
  ----------------------------------------------------------------
  INSERT INTO public.profiles (id, role, is_approved, full_name)
  VALUES (admin_uuid, 'admin', true, 'Admin MyCity')
  ON CONFLICT (id) DO UPDATE
    SET role = 'admin',
        is_approved = true,
        full_name = COALESCE(public.profiles.full_name, 'Admin MyCity');
END $$;

NOTIFY pgrst, 'reload schema';

-- Verifica finale
SELECT
  u.email,
  p.role,
  p.is_approved,
  p.full_name
FROM auth.users u
JOIN public.profiles p ON p.id = u.id
WHERE u.email IN ('admin@piacenza-demo.local', 'nicolaflorea50@gmail.com');

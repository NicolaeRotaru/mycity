-- Seed 005: promuove nicolaflorea50@gmail.com ad admin + crea un rider demo
--
-- Idempotente. Cancella eventuali tentativi precedenti per partire pulito.

DO $$
DECLARE
  rider_uuid    uuid := '22222222-2222-2222-2222-aaaaaaaa0001';
  rider_email   text := 'rider.demo@piacenza-demo.local';
  pwd text := crypt('PiacenzaDemo2025!', gen_salt('bf'));
BEGIN
  ----------------------------------------------------------------
  -- 1) Promuovi il proprietario del marketplace ad admin
  ----------------------------------------------------------------
  UPDATE public.profiles
  SET role = 'admin', is_approved = true
  WHERE id = (SELECT id FROM auth.users WHERE email = 'nicolaflorea50@gmail.com');

  ----------------------------------------------------------------
  -- 2) Cleanup: rimuovi eventuali tentativi precedenti rotti
  ----------------------------------------------------------------
  DELETE FROM auth.users
  WHERE id = rider_uuid OR email = rider_email;

  ----------------------------------------------------------------
  -- 3) Crea il rider demo con tutti i campi auth richiesti
  --    (token NULL fanno fallire il sign-in con "Database error querying schema")
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
    rider_uuid,
    'authenticated',
    'authenticated',
    rider_email,
    pwd,
    now(),
    NULL,
    '', NULL,
    '', NULL,
    '', '', NULL,
    NULL,
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"role":"rider"}'::jsonb,
    false,
    now(), now(),
    NULL, NULL, '', '', NULL,
    '', 0,
    NULL,
    '', NULL,
    false
  );

  -- Identita' auth (richiesta dalle versioni recenti di GoTrue)
  INSERT INTO auth.identities (
    id, provider_id, user_id, identity_data, provider,
    last_sign_in_at, created_at, updated_at
  ) VALUES (
    gen_random_uuid(),
    rider_uuid::text,
    rider_uuid,
    jsonb_build_object('sub', rider_uuid::text, 'email', rider_email, 'email_verified', true, 'phone_verified', false),
    'email',
    now(), now(), now()
  )
  ON CONFLICT DO NOTHING;

  ----------------------------------------------------------------
  -- 4) Profilo del rider (in caso il trigger non l'abbia creato bene)
  ----------------------------------------------------------------
  INSERT INTO public.profiles (id, role, is_approved, full_name, phone)
  VALUES (rider_uuid, 'rider', true, 'Marco Bianchi', '3331234567')
  ON CONFLICT (id) DO UPDATE
    SET role = 'rider',
        is_approved = true,
        full_name = COALESCE(public.profiles.full_name, 'Marco Bianchi'),
        phone     = COALESCE(public.profiles.phone,     '3331234567');

  ----------------------------------------------------------------
  -- 5) Repair: aggiungi auth.identities mancanti per tutti i demo sellers
  --    (seed 001 li ha creati senza identities, GoTrue le richiede)
  ----------------------------------------------------------------
  INSERT INTO auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  SELECT
    gen_random_uuid(),
    u.id::text,
    u.id,
    jsonb_build_object(
      'sub', u.id::text,
      'email', u.email,
      'email_verified', true,
      'phone_verified', false
    ),
    'email',
    now(), now(), now()
  FROM auth.users u
  WHERE u.email LIKE '%@piacenza-demo.local'
    AND NOT EXISTS (
      SELECT 1 FROM auth.identities i
      WHERE i.user_id = u.id AND i.provider = 'email'
    );

  -- Aggiorna anche i campi token che potrebbero essere NULL nei seller demo
  UPDATE auth.users
  SET confirmation_token         = COALESCE(confirmation_token,         ''),
      recovery_token             = COALESCE(recovery_token,             ''),
      email_change_token_new     = COALESCE(email_change_token_new,     ''),
      email_change_token_current = COALESCE(email_change_token_current, ''),
      email_change               = COALESCE(email_change,               ''),
      phone_change               = COALESCE(phone_change,               ''),
      phone_change_token         = COALESCE(phone_change_token,         ''),
      reauthentication_token     = COALESCE(reauthentication_token,     ''),
      email_change_confirm_status = COALESCE(email_change_confirm_status, 0)
  WHERE email LIKE '%@piacenza-demo.local';
END $$;

NOTIFY pgrst, 'reload schema';

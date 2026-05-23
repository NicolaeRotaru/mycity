-- Seed 005: promuove nicolaflorea50@gmail.com ad admin + crea un rider demo
--
-- Idempotente.

DO $$
DECLARE
  rider_uuid uuid := '22222222-2222-2222-2222-aaaaaaaa0001';
  pwd text := crypt('PiacenzaDemo2025!', gen_salt('bf'));
BEGIN
  ----------------------------------------------------------------
  -- 1) Promuovi il proprietario del marketplace ad admin
  ----------------------------------------------------------------
  UPDATE public.profiles
  SET role = 'admin', is_approved = true
  WHERE id = (SELECT id FROM auth.users WHERE email = 'nicolaflorea50@gmail.com');

  ----------------------------------------------------------------
  -- 2) Crea un rider demo
  ----------------------------------------------------------------
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, is_sso_user
  ) VALUES (
    '00000000-0000-0000-0000-000000000000',
    rider_uuid,
    'authenticated',
    'authenticated',
    'rider.demo@piacenza-demo.local',
    pwd,
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"role":"rider"}',
    now(),
    now(),
    false
  )
  ON CONFLICT (id) DO NOTHING;

  -- Crea il profilo se il trigger non l'ha fatto
  INSERT INTO public.profiles (id, role, is_approved, full_name, phone)
  VALUES (rider_uuid, 'rider', true, 'Marco Bianchi', '3331234567')
  ON CONFLICT (id) DO NOTHING;

  -- Aggiorna comunque i dati (in caso il trigger li abbia messi sbagliati)
  UPDATE public.profiles
  SET role = 'rider',
      is_approved = true,
      full_name = COALESCE(full_name, 'Marco Bianchi'),
      phone     = COALESCE(phone,     '3331234567')
  WHERE id = rider_uuid;
END $$;

NOTIFY pgrst, 'reload schema';

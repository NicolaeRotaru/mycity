-- Seed 007: negozio di sistema "MyCity"
--
-- Seller a cui l'admin assegna i prodotti importati dai marketplace esterni
-- (Amazon/eBay/…) quando non c'è un negozio reale di destinazione.
-- L'UUID combacia con MYCITY_SELLER_ID in lib/products/mycitySeller.ts.
--
-- Idempotente. Crea l'utente auth fittizio con tutti i campi token richiesti
-- (NULL fanno fallire GoTrue), come da pattern di seed 005. L'utente non fa mai
-- sign-in: serve solo a soddisfare la FK profiles.id -> auth.users.id.

DO $$
DECLARE
  mycity_uuid  uuid := '11111111-1111-1111-1111-c1ec0de00001';
  mycity_email text := 'mycity.import@mycity-system.local';
  pwd text := crypt('MyCitySystem2025!', gen_salt('bf'));
BEGIN
  ----------------------------------------------------------------
  -- 1) Cleanup di eventuali tentativi precedenti rotti
  ----------------------------------------------------------------
  DELETE FROM auth.users
  WHERE id = mycity_uuid OR email = mycity_email;

  ----------------------------------------------------------------
  -- 2) Utente auth fittizio con tutti i campi richiesti
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
    mycity_uuid,
    'authenticated',
    'authenticated',
    mycity_email,
    pwd,
    now(),
    NULL,
    '', NULL,
    '', NULL,
    '', '', NULL,
    NULL,
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"role":"seller"}'::jsonb,
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
    mycity_uuid::text,
    mycity_uuid,
    jsonb_build_object('sub', mycity_uuid::text, 'email', mycity_email, 'email_verified', true, 'phone_verified', false),
    'email',
    now(), now(), now()
  )
  ON CONFLICT DO NOTHING;

  ----------------------------------------------------------------
  -- 3) Profilo seller "MyCity" (approvato, visibile come negozio)
  ----------------------------------------------------------------
  INSERT INTO public.profiles (id, role, is_approved, store_name, offers_express)
  VALUES (mycity_uuid, 'seller', true, 'MyCity', false)
  ON CONFLICT (id) DO UPDATE
    SET role           = 'seller',
        is_approved    = true,
        store_name     = 'MyCity',
        offers_express = COALESCE(public.profiles.offers_express, false);
END $$;

NOTIFY pgrst, 'reload schema';

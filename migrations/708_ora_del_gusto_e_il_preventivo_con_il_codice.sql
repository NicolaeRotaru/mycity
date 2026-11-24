-- 708 — Ora del Gusto in «modalità preventivo», col link col codice e la scheda di n8n (24/11/2026).
--
-- Nicola: «Devi far iscrivere ora del gusto adesso, perché è solo in modalità preventivo, quando il
-- cliente accetta, si recupereranno tutti i dati del cliente che si ha recuperato con n8n e compila
-- tutto quello che bisogna compilare». Sulla forma, il 24/11 ha scelto «link col codice».
--
-- COSA FA.
--  1. schede_clienti — la scheda del cliente che manda n8n (flusso 16, il modulo 12 che parte da
--     solo) a /api/agenzia/scheda-cliente. Si tiene PER INTERA, com'è arrivata: per ogni campo il
--     valore, lo stato («confermato», «da_confermare», …) e la fonte, più l'analisi. Nicola, 24/11:
--     «tutti questi dati che si recuperano devono essere visibili nella dashboard». Il negozio legge
--     solo la sua; scrive solo il server. In pubblico va solo quello che il titolare ha confermato.
--  2. preventivi_con_codice — il link col codice di un'attività che non ha ancora un accesso: il
--     codice (64 caratteri esadecimali, 256 bit casuali) apre /preventivo/<codice>, una pagina con
--     solo quel preventivo. Lo legge solo il server (nessuna regola per i browser): il link lo vede
--     Nicola nell'area admin («Preventivi col link»).
--  3. Ora del Gusto, bar e pasticceria a Piacenza: un utente segnaposto (email .local, nessuna
--     password, bloccato finché il titolare non dà la sua email) e un profilo venditore NON
--     approvato e senza richiesta di approvazione (approval_status NULL), business_type 'bar',
--     nessun prodotto. Quando il titolare accetta dal link, il sito gli mette la sua email, gli
--     manda il link per entrare, compila il profilo coi dati confermati della scheda e lo mette in
--     revisione (approval_status 'pending').
--
-- PERMESSI (migrazione 425): scritti qui sotto, tabella per tabella.
-- DATI DI PERSONE: la scheda è dell'attività (dati pubblici del locale), ma entra lo stesso in
-- «scarica i miei dati» (app/api/account/export/route.ts), come il link.
--
-- Si può rieseguire: Ora del Gusto e il suo codice si creano una volta sola.
-- NON si applica a mano: lo decide Nicola, col pulsante «Migrazioni a mano».
-- REVERSIBILE:
--   DROP TABLE IF EXISTS public.preventivi_con_codice;
--   DROP TABLE IF EXISTS public.schede_clienti;
--   DELETE FROM auth.users WHERE id = '0de1905e-7000-4000-8000-000000000001';  -- se non ha ancora accettato

BEGIN;

-- 1) La scheda del cliente --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.schede_clienti (
  id_attivita uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  scheda jsonb NOT NULL CHECK (jsonb_typeof(scheda) = 'object' AND octet_length(scheda::text) <= 200000),
  origine text NOT NULL DEFAULT 'n8n-16' CHECK (char_length(origine) <= 40),
  ricevuta_il timestamptz NOT NULL DEFAULT now(),
  aggiornata_il timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.schede_clienti ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS schede_clienti_il_negozio_legge_la_sua ON public.schede_clienti;
CREATE POLICY schede_clienti_il_negozio_legge_la_sua ON public.schede_clienti
  FOR SELECT TO authenticated
  USING (id_attivita = (SELECT auth.uid()));

REVOKE ALL ON public.schede_clienti FROM anon, authenticated;
GRANT SELECT ON public.schede_clienti TO authenticated;
GRANT ALL ON public.schede_clienti TO service_role;

COMMENT ON TABLE public.schede_clienti IS
  'La scheda del cliente mandata da n8n (flusso 16), intera: campi con valore/stato/fonte e analisi. Il negozio legge la sua, scrive solo il server. In pubblico solo i campi confermati dal titolare (migrazione 708).';

-- 2) Il link col codice -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.preventivi_con_codice (
  seller_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  codice text NOT NULL UNIQUE CHECK (codice ~ '^[0-9a-f]{64}$'),
  stato text NOT NULL DEFAULT 'aperto' CHECK (stato IN ('aperto', 'accettato', 'chiuso')),
  fascia_scelta text CHECK (fascia_scelta IS NULL OR fascia_scelta IN ('base', 'business', 'premium')),
  creato_il timestamptz NOT NULL DEFAULT now(),
  accettato_il timestamptz,
  condizioni_accettate_il timestamptz
);

ALTER TABLE public.preventivi_con_codice ENABLE ROW LEVEL SECURITY;
-- Nessuna regola: browser e app non lo leggono mai. Solo il server (service_role).
REVOKE ALL ON public.preventivi_con_codice FROM anon, authenticated;
GRANT ALL ON public.preventivi_con_codice TO service_role;

COMMENT ON TABLE public.preventivi_con_codice IS
  'Il link /preventivo/<codice> di un''attività senza accesso (modalità preventivo). Solo il server lo legge (migrazione 708).';

-- 3) Ora del Gusto ----------------------------------------------------------------------------
DO $$
DECLARE
  odg_uuid  uuid := '0de1905e-7000-4000-8000-000000000001';
  odg_email text := 'ora-del-gusto.preventivo@mycity-system.local';
BEGIN
  PERFORM set_config('mycity.allow_profile_write', '1', true);

  -- Una volta sola: se il titolare ha già accettato, l'utente ha la sua email e non si tocca più.
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = odg_uuid) THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'instance_id') THEN
      EXECUTE $ins$
        INSERT INTO auth.users (
          instance_id, id, aud, role, email, encrypted_password,
          email_confirmed_at, invited_at,
          confirmation_token, confirmation_sent_at,
          recovery_token, recovery_sent_at,
          email_change_token_new, email_change, email_change_sent_at,
          last_sign_in_at, raw_app_meta_data, raw_user_meta_data,
          is_super_admin, created_at, updated_at,
          phone, phone_confirmed_at, phone_change, phone_change_token, phone_change_sent_at,
          email_change_token_current, email_change_confirm_status,
          banned_until, reauthentication_token, reauthentication_sent_at, is_sso_user
        ) VALUES (
          '00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2, '',
          now(), NULL,
          '', NULL,
          '', NULL,
          '', '', NULL,
          NULL, '{"provider":"email","providers":["email"]}'::jsonb, '{"role":"seller"}'::jsonb,
          false, now(), now(),
          NULL, NULL, '', '', NULL,
          '', 0,
          now() + interval '100 years', '', NULL, false
        )
      $ins$ USING odg_uuid, odg_email;
    ELSE
      INSERT INTO auth.users (id, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, email_confirmed_at)
      VALUES (odg_uuid, odg_email, '', '{"provider":"email","providers":["email"]}'::jsonb, '{"role":"seller"}'::jsonb, now());
    END IF;

    IF to_regclass('auth.identities') IS NOT NULL THEN
      EXECUTE $idn$
        INSERT INTO auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
        VALUES (gen_random_uuid(), $1::text, $1,
                jsonb_build_object('sub', $1::text, 'email', $2, 'email_verified', true, 'phone_verified', false),
                'email', now(), now(), now())
        ON CONFLICT DO NOTHING
      $idn$ USING odg_uuid, odg_email;
    END IF;

    INSERT INTO public.profiles (id, role, is_approved, approval_status, store_name, offers_express, business_type, business_type_detail)
    VALUES (odg_uuid, 'seller', false, NULL, 'Ora del Gusto', false, 'bar', 'Bar e pasticceria')
    ON CONFLICT (id) DO UPDATE
      SET role = 'seller', is_approved = false, approval_status = NULL, store_name = 'Ora del Gusto',
          business_type = 'bar', business_type_detail = 'Bar e pasticceria';
  END IF;

  -- Il codice del link: 256 bit casuali, da gen_random_uuid (nessuna estensione da cercare).
  INSERT INTO public.preventivi_con_codice (seller_id, codice)
  VALUES (odg_uuid, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
  ON CONFLICT (seller_id) DO NOTHING;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';

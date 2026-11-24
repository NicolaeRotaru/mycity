-- 707 — SDG Agenzia entra nel marketplace, coi tre abbonamenti come prodotti (24/11/2026).
--
-- Nicola: «sono servizi che offre mycity, ma tramite SDG», «specifica che SDG agenzia è il partner
-- di questi servizi», «metti i tre abbonamenti come prodotti nella vetrina di SDG».
--
-- COSA FA.
--  1. Crea il negozio di sistema «SDG Agenzia», come il negozio «MyCity» (seeds/007): UUID fisso
--     (SDG_SELLER_ID in lib/products/sdgSeller.ts), utente auth fittizio che non entra mai (email
--     .local, nessuna password, bandito per sempre), profilo venditore approvato,
--     business_type 'altro', dettaglio «Agenzia: web, marketing, foto e video».
--  2. Mette nella sua vetrina i tre abbonamenti: Base 300 €, Business 500 €, Premium 999 € al mese.
--     Nome, prezzo e descrizione sono quelli di lib/agenzia/prodotti-sdg.ts (dal listino FASCE);
--     la prova tests/unit/sdg-nel-marketplace.test.ts controlla che coincidano.
--  3. Un abbonamento non è un ordine con la consegna: una guardia su order_items rifiuta ogni riga
--     d'ordine con un prodotto di SDG. Il server lo rifiuta già prima (validaRigaDelCarrello, nella
--     cassa con la carta e in quella in contanti); questa è l'ultima porta, nel database.
--
-- PERMESSI (migrazione 425). Nessuna tabella nuova: profiles e products tengono le regole che hanno.
-- La funzione della guardia non si chiama da fuori: si toglie EXECUTE a tutti.
--
-- Si può rieseguire. NON si applica a mano: lo decide Nicola, col pulsante «Migrazioni a mano».
-- REVERSIBILE:
--   DROP TRIGGER IF EXISTS order_items_niente_abbonamenti_sdg ON public.order_items;
--   DROP FUNCTION IF EXISTS public.order_items_niente_abbonamenti_sdg();
--   UPDATE public.products SET status = 'draft' WHERE seller_id = '11111111-1111-1111-1111-5d9000000001';
--   UPDATE public.profiles SET is_approved = false, approval_status = 'suspended' WHERE id = '11111111-1111-1111-1111-5d9000000001';

BEGIN;

DO $$
DECLARE
  sdg_uuid  uuid := '11111111-1111-1111-1111-5d9000000001';
  sdg_email text := 'sdg.servizi@mycity-system.local';
BEGIN
  -- La guardia dei profili (119, ultima in 400) lascia l'approvazione solo allo staff: qui scrive la
  -- migrazione, come la semina 007. Vale solo per questa transazione.
  PERFORM set_config('mycity.allow_profile_write', '1', true);

  -- L'utente auth fittizio. Su Supabase vero auth.users ha tutte le colonne di GoTrue, e i token
  -- vuoti devono essere '' e non NULL (con NULL GoTrue si rompe: vedi seeds/005). Sul database di
  -- prova delle migrazioni (tests/sql/harness) la tabella è ridotta: lì si scrivono solo le colonne
  -- che ci sono. Nessuna password (encrypted_password vuota: nessuna parola apre) e bandito per sempre: non entra mai.
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = sdg_uuid) THEN
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
          '00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2,
          '',
          now(), NULL,
          '', NULL,
          '', NULL,
          '', '', NULL,
          NULL, '{"provider":"email","providers":["email"]}'::jsonb, '{"role":"seller"}'::jsonb,
          false, now(), now(),
          NULL, NULL, '', '', NULL,
          '', 0,
          'infinity'::timestamptz, '', NULL, false
        )
      $ins$ USING sdg_uuid, sdg_email;
    ELSE
      INSERT INTO auth.users (id, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, email_confirmed_at)
      VALUES (sdg_uuid, sdg_email, '',
              '{"provider":"email","providers":["email"]}'::jsonb, '{"role":"seller"}'::jsonb, now());
    END IF;

    IF to_regclass('auth.identities') IS NOT NULL THEN
      EXECUTE $idn$
        INSERT INTO auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
        VALUES (gen_random_uuid(), $1::text, $1,
                jsonb_build_object('sub', $1::text, 'email', $2, 'email_verified', true, 'phone_verified', false),
                'email', now(), now(), now())
        ON CONFLICT DO NOTHING
      $idn$ USING sdg_uuid, sdg_email;
    END IF;
  END IF;

  INSERT INTO public.profiles (id, role, is_approved, approval_status, store_name, offers_express, business_type, business_type_detail)
  VALUES (sdg_uuid, 'seller', true, 'approved', 'SDG Agenzia', false, 'altro', 'Agenzia: web, marketing, foto e video')
  ON CONFLICT (id) DO UPDATE
    SET role = 'seller',
        is_approved = true,
        approval_status = 'approved',
        store_name = 'SDG Agenzia',
        offers_express = false,
        business_type = 'altro',
        business_type_detail = 'Agenzia: web, marketing, foto e video';
END $$;

-- I tre abbonamenti. Scorte vuote (NULL): non sono merce, non finiscono.
INSERT INTO public.products (id, seller_id, name, description, price, status, stock, images)
SELECT v.id, '11111111-1111-1111-1111-5d9000000001'::uuid, v.name, v.description, v.price, 'available', NULL, '[]'::jsonb
FROM (VALUES
    ('11111111-1111-1111-1111-5d9000000101'::uuid, 'Abbonamento Base — 300 € al mese', 'Per essere online e vendere da subito, con un aiuto costante ma leggero.

Cosa comprende:
· Foto e video: Una sessione di foto all’avvio: copertina e prodotti principali.
· Gestione automatica dei social: 8 post al mese, preparati e pubblicati da noi.
· Sito web professionale: Un sito di una pagina col tuo nome, collegato alla vetrina.
· Scheda Google su Maps: Scheda creata o sistemata all’avvio.
· Vetrina: Vetrina su MyCity con ordini, consegna e ritiro in negozio.
· Assistenza: Su WhatsApp, risposta entro 24 ore lavorative.

Si attiva dal preventivo del tuo negozio, non dal carrello. Nessun vincolo di durata: disdici quando vuoi, con 30 giorni di preavviso. Il primo mese costa la metà.
I servizi li realizza SDG Agenzia, il partner di MyCity per foto, video, social e web.', 300.00),
    ('11111111-1111-1111-1111-5d9000000102'::uuid, 'Abbonamento Business — 500 € al mese', 'Per crescere ogni settimana: più contenuti, più clienti che ti trovano.

Cosa comprende:
· Foto e video: Foto all’avvio e una nuova sessione ogni tre mesi, più un video al mese.
· Gestione automatica dei social: 12 post al mese, 3 a settimana, con 2 video brevi.
· Sito web professionale: Un sito completo di più pagine, col tuo nome.
· Scheda Google su Maps: Scheda sistemata, più le risposte alle recensioni scritte da noi.
· Vetrina: Vetrina su MyCity con ordini, consegna e ritiro in negozio, in evidenza nella tua categoria una settimana al mese.
· Assistenza: Su WhatsApp, risposta entro 4 ore lavorative.

Si attiva dal preventivo del tuo negozio, non dal carrello. Nessun vincolo di durata: disdici quando vuoi, con 30 giorni di preavviso. Il primo mese costa la metà.
I servizi li realizza SDG Agenzia, il partner di MyCity per foto, video, social e web.', 500.00),
    ('11111111-1111-1111-1111-5d9000000103'::uuid, 'Abbonamento Premium — 999 € al mese', 'Il servizio completo: foto e video ogni mese, un referente tutto tuo.

Cosa comprende:
· Foto e video: Una sessione di foto e video ogni mese.
· Gestione automatica dei social: 20 post al mese, 4 video brevi e le storie.
· Sito web professionale: Un sito completo, aggiornato da noi ogni mese.
· Scheda Google su Maps: Scheda curata ogni mese: foto nuove, post e risposte alle recensioni.
· Vetrina: Vetrina su MyCity con ordini, consegna e ritiro in negozio, in home page due settimane al mese.
· Assistenza: Un referente tutto tuo e una visita nel locale ogni mese.

Si attiva dal preventivo del tuo negozio, non dal carrello. Nessun vincolo di durata: disdici quando vuoi, con 30 giorni di preavviso. Il primo mese costa la metà.
I servizi li realizza SDG Agenzia, il partner di MyCity per foto, video, social e web.', 999.00)
) AS v(id, name, description, price)
ON CONFLICT (id) DO UPDATE
  SET seller_id = EXCLUDED.seller_id,
      name = EXCLUDED.name,
      description = EXCLUDED.description,
      price = EXCLUDED.price,
      status = 'available',
      stock = NULL;

-- L'ultima porta: un prodotto di SDG non entra in nessun ordine.
CREATE OR REPLACE FUNCTION public.order_items_niente_abbonamenti_sdg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF NEW.product_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.id = NEW.product_id AND p.seller_id = '11111111-1111-1111-1111-5d9000000001'::uuid
  ) THEN
    RAISE EXCEPTION 'Gli abbonamenti di SDG Agenzia non si comprano col carrello: si attivano dal preventivo del negozio.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.order_items_niente_abbonamenti_sdg() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS order_items_niente_abbonamenti_sdg ON public.order_items;
CREATE TRIGGER order_items_niente_abbonamenti_sdg
  BEFORE INSERT OR UPDATE OF product_id ON public.order_items
  FOR EACH ROW EXECUTE FUNCTION public.order_items_niente_abbonamenti_sdg();

COMMIT;

NOTIFY pgrst, 'reload schema';

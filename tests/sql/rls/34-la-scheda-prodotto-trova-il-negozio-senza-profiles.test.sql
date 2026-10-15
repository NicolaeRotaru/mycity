-- =============================================================================
-- La scheda prodotto trova il suo negozio anche con la tabella dei profili chiusa
-- =============================================================================
-- Gira contro un database ricostruito dalle migrazioni vere (161 compresa):
--   tests/sql/harness/apply.sh mycity_test
--   tests/sql/harness/run.sh   mycity_test
--
-- PERCHE' ESISTE QUESTO FILE (R3, radiografia dell'11/10/2026).
--
-- La prova 19 pretende che `profiles` resti chiusa a chi non e' il proprietario:
-- contiene IBAN, documenti e saldo del portafoglio. Il catalogo pero' leggeva il
-- negozio proprio da li', agganciandolo al prodotto
-- (`profiles!products_seller_id_fkey`). Le due esigenze non si guardavano: in
-- produzione reggeva solo perche' una regola riaperta il 9 settembre lasciava
-- ancora leggere i negozi approvati, e la migrazione 161 la toglie. Dopo, per un
-- visitatore e per un cliente l'aggancio torna vuoto e ogni scheda dice «il
-- negozio non e' operativo».
--
-- Il codice adesso legge il negozio dalla vista `seller_public_profiles`. Qui si
-- eseguono, coi permessi di chi guarda, LE STESSE DOMANDE che fa il sito:
--   · la riga del prodotto con le colonne di COLONNE_SCHEDA_PRODOTTO
--     (lib/queries/catalogo.ts), categoria compresa;
--   · il negozio con le colonne di COLONNE_NEGOZIO_DELLA_SCHEDA
--     ('id, store_name, is_approved, offers_express, store_hours');
--   · il negozio delle fasce, COLONNE_NEGOZIO_IN_VETRINA
--     ('id, store_name, is_approved', lib/queries/seller-public-profiles.ts);
--   · il negozio dei metadati e dell'anteprima (lib/queries/metadati-vetrina.ts);
--   · il riquadro «Venduto da» (lib/queries/venduto-da.ts).
-- E nello stesso file si ricontrolla che `profiles` resti chiusa: la riparazione
-- non deve passare dal riaprirla.
--
-- Tutto in transazione con ROLLBACK: non lascia dati.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- La materia prima: un forno approvato, una bottega non approvata, una cliente
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('11111111-1111-1111-1111-111111111111', 'forno@test.it',   '{"role":"seller"}'),
  ('55555555-5555-5555-5555-555555555555', 'bottega@test.it', '{"role":"seller"}'),
  ('33333333-3333-3333-3333-333333333333', 'cliente@test.it', '{"role":"buyer"}');

UPDATE public.profiles
   SET is_approved = true, approval_status = 'approved', store_name = 'Pane Quotidiano',
       store_address = 'Via Roma 1', store_phone = '0523000000', store_logo = 'logo.png',
       store_description = 'Forno a legna', offers_express = true,
       store_hours = '{"lun":"7-13"}'::jsonb,
       business_legal_name = 'Pane Quotidiano', business_form = 'S.r.l.',
       business_vat_number = '01234567890', business_address = 'Via Roma 1',
       business_city = 'Piacenza', business_zip = '29121'
 WHERE id = '11111111-1111-1111-1111-111111111111';

UPDATE public.profiles
   SET is_approved = false, approval_status = 'pending', store_name = 'Bottega Segreta'
 WHERE id = '55555555-5555-5555-5555-555555555555';

INSERT INTO public.categories (id, slug, name)
VALUES ('cccccccc-0000-0000-0000-0000000000f1', 'forno-prova-34', 'Forno prova 34');

INSERT INTO public.products (id, name, description, price, seller_id, status, stock, category_id)
VALUES ('c0000000-0000-0000-0000-0000000000a1', 'Focaccia al rosmarino', 'Lievitata 24 ore',
        4.50, '11111111-1111-1111-1111-111111111111', 'available', 10,
        'cccccccc-0000-0000-0000-0000000000f1'),
       ('d0000000-0000-0000-0000-0000000000a9', 'Panettone di prova', 'Ancora in prova',
        19.90, '55555555-5555-5555-5555-555555555555', 'available', 7,
        'cccccccc-0000-0000-0000-0000000000f1');

RESET mycity.allow_profile_write;

-- ---------------------------------------------------------------------------
-- Le stesse domande, con gli occhi di chi guarda: il visitatore senza account e
-- la cliente con account, cioe' i due che il difetto colpiva.
-- ---------------------------------------------------------------------------

-- ── il visitatore senza account ─────────────────────────────────────────────
SET LOCAL ROLE anon;

-- ① La riga del prodotto, con le colonne esatte della scheda e la sua categoria.
INSERT INTO esiti
SELECT 'visitatore: la riga della scheda prodotto arriva con la categoria',
       count(*) = 1 AND bool_and(c.slug = 'forno-prova-34'),
       'righe: ' || count(*)
  FROM (SELECT id, name, description, price, images, seller_id, status, created_at, category_id,
               stock, attributes, unit, compare_at_price, condition, express_enabled, has_variants,
               external_source_url
          FROM public.products WHERE id = 'c0000000-0000-0000-0000-0000000000a1') p
  LEFT JOIN public.categories c ON c.id = p.category_id;

-- ② Il negozio della scheda, dalla vista, con le colonne esatte che chiede il sito.
INSERT INTO esiti
SELECT 'visitatore: la scheda trova il negozio approvato nella vista',
       count(*) = 1 AND bool_and(store_name = 'Pane Quotidiano' AND is_approved
                                 AND offers_express AND store_hours IS NOT NULL),
       'negozi trovati: ' || count(*)
  FROM (SELECT id, store_name, is_approved, offers_express, store_hours
          FROM public.seller_public_profiles
         WHERE id IN (SELECT seller_id FROM public.products
                       WHERE id = 'c0000000-0000-0000-0000-0000000000a1')) v;

-- ③ Il negozio delle fasce (tendenze, simili, sponsorizzati, carrello, ricerca).
INSERT INTO esiti
SELECT 'visitatore: le fasce trovano il negozio approvato',
       count(*) = 1, 'negozi trovati: ' || count(*)
  FROM (SELECT id, store_name, is_approved FROM public.seller_public_profiles
         WHERE id IN ('11111111-1111-1111-1111-111111111111')) v
 WHERE v.is_approved;

-- ④ I metadati per Google e l'anteprima per WhatsApp.
INSERT INTO esiti
SELECT 'visitatore: Google e WhatsApp leggono nome, descrizione e logo del negozio',
       count(*) = 1 AND bool_and(store_logo = 'logo.png' AND store_description = 'Forno a legna'),
       'righe: ' || count(*)
  FROM (SELECT store_name, is_approved, store_description, store_logo
          FROM public.seller_public_profiles
         WHERE id = '11111111-1111-1111-1111-111111111111') v;

-- ⑤ Il riquadro «Venduto da», con le colonne d'impresa della migrazione 126.
INSERT INTO esiti
SELECT 'visitatore: «Venduto da» legge ragione sociale, partita IVA e sede',
       count(*) = 1 AND bool_and(business_vat_number = '01234567890' AND business_city = 'Piacenza'),
       'righe: ' || count(*)
  FROM (SELECT store_name, business_legal_name, business_form, business_vat_number,
               business_address, business_city, business_zip, store_address, store_phone
          FROM public.seller_public_profiles
         WHERE id = '11111111-1111-1111-1111-111111111111') v;

-- ⑥ Il negozio non approvato NON e' nella vista: il suo prodotto non si compra.
INSERT INTO esiti
SELECT 'visitatore: la bottega non approvata non compare nella vetrina',
       count(*) = 0, 'righe: ' || count(*)
  FROM public.seller_public_profiles WHERE id = '55555555-5555-5555-5555-555555555555';

-- ⑦ E `profiles` resta chiusa: e' il gemello della prova 19, nello stesso posto.
INSERT INTO esiti
SELECT 'visitatore: la tabella dei profili resta chiusa',
       count(*) = 0, 'righe di profiles lette: ' || count(*)
  FROM public.profiles;

-- ⑧ La malattia, misurata: il VECCHIO aggancio a profiles (come lo esegue
--    PostgREST, un LEFT JOIN coi permessi di chi guarda) torna vuoto. Se un
--    giorno tornasse pieno, vorrebbe dire che `profiles` si e' riaperta.
INSERT INTO esiti
SELECT 'visitatore: il vecchio aggancio a profiles torna vuoto, per questo il sito non lo usa piu',
       count(*) = 1 AND bool_and(pr.id IS NULL), 'righe: ' || count(*)
  FROM public.products p
  LEFT JOIN LATERAL (SELECT id FROM public.profiles WHERE id = p.seller_id) pr ON true
 WHERE p.id = 'c0000000-0000-0000-0000-0000000000a1';

RESET ROLE;

-- ── la cliente con account ──────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';

INSERT INTO esiti
SELECT 'cliente: la scheda trova il negozio approvato nella vista',
       count(*) = 1 AND bool_and(store_name = 'Pane Quotidiano' AND is_approved
                                 AND offers_express AND store_hours IS NOT NULL),
       'negozi trovati: ' || count(*)
  FROM (SELECT id, store_name, is_approved, offers_express, store_hours
          FROM public.seller_public_profiles
         WHERE id IN (SELECT seller_id FROM public.products
                       WHERE id = 'c0000000-0000-0000-0000-0000000000a1')) v;

INSERT INTO esiti
SELECT 'cliente: «Venduto da» legge ragione sociale e partita IVA',
       count(*) = 1 AND bool_and(business_legal_name = 'Pane Quotidiano'),
       'righe: ' || count(*)
  FROM public.seller_public_profiles WHERE id = '11111111-1111-1111-1111-111111111111';

INSERT INTO esiti
SELECT 'cliente: la bottega non approvata non compare nella vetrina',
       count(*) = 0, 'righe: ' || count(*)
  FROM public.seller_public_profiles WHERE id = '55555555-5555-5555-5555-555555555555';

INSERT INTO esiti
SELECT 'cliente: dei profili legge solo il proprio',
       count(*) = 1 AND bool_and(id = '33333333-3333-3333-3333-333333333333'),
       'righe di profiles lette: ' || count(*)
  FROM public.profiles;

INSERT INTO esiti
SELECT 'cliente: il vecchio aggancio a profiles torna vuoto anche per lei',
       count(*) = 1 AND bool_and(pr.id IS NULL), 'righe: ' || count(*)
  FROM public.products p
  LEFT JOIN LATERAL (SELECT id FROM public.profiles WHERE id = p.seller_id) pr ON true
 WHERE p.id = 'c0000000-0000-0000-0000-0000000000a1';

RESET request.jwt.claims;
RESET ROLE;

-- ── il proprietario della bottega non approvata ─────────────────────────────
-- Vede il suo prodotto (e' suo), ma la vetrina pubblica non lo mostra: la scheda
-- resta «non acquistabile» anche per lui, come deve.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated"}';

INSERT INTO esiti
SELECT 'proprietario non approvato: legge il suo prodotto',
       count(*) = 1, 'righe: ' || count(*)
  FROM public.products WHERE id = 'd0000000-0000-0000-0000-0000000000a9';

INSERT INTO esiti
SELECT 'proprietario non approvato: il suo negozio non e nella vetrina, quindi non vende',
       count(*) = 0, 'righe: ' || count(*)
  FROM public.seller_public_profiles WHERE id = '55555555-5555-5555-5555-555555555555';

RESET request.jwt.claims;
RESET ROLE;

-- ---------------------------------------------------------------------------
SELECT nome, CASE WHEN ok THEN 'ok' ELSE 'ROTTO' END AS esito, dettaglio FROM esiti ORDER BY nome;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM esiti WHERE ok IS NOT TRUE;
  IF n > 0 THEN
    RAISE EXCEPTION '% controlli falliti: con profiles chiusa la scheda prodotto non trova il negozio', n;
  END IF;
  SELECT count(*) INTO n FROM esiti;
  IF n < 15 THEN
    RAISE EXCEPTION 'solo % controlli eseguiti su 15: la prova non misura quello che dice', n;
  END IF;
END $$;

ROLLBACK;

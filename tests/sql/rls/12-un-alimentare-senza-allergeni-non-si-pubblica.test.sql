-- =============================================================================
-- Un alimentare non si pubblica senza allergeni (migrazione 126)
-- =============================================================================
-- Gira contro un database ricostruito dalle migrazioni vere:
--   tests/sql/harness/apply.sh mycity_test
--   tests/sql/harness/run.sh   mycity_test
--
-- IL DIFETTO. Si poteva pubblicare e vendere un prodotto alimentare senza
-- dichiarare gli allergeni: la scheda restava vuota e nessuno lo impediva. Il
-- regolamento europeo 1169/2011 vuole quell'informazione PRIMA dell'acquisto
-- anche nella vendita a distanza, e per chi e' allergico e' la differenza fra
-- una spesa e un ricovero.
--
-- PERCHE' LA PROVA STA QUI E NON SUL MODULO. Al catalogo si arriva da almeno
-- quattro strade: il modulo del venditore, l'assistente AI, la creazione in
-- blocco, l'importazione da un altro sito. Una prova sul modulo copre una
-- strada su quattro — e le altre tre sono proprio quelle che riempiono il
-- catalogo in fretta.
--
-- Tutto in transazione, ROLLBACK.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('11111111-1111-1111-1111-111111111111', 'negozio@test.it', '{"role":"seller"}');
UPDATE public.profiles
   SET is_approved = true, approval_status = 'approved', store_name = 'Bottega di prova', role = 'seller'
 WHERE id = '11111111-1111-1111-1111-111111111111';

-- Le categorie possono gia' esistere (le semina una migrazione): si riusano
-- quelle vere invece di crearne di finte, cosi' la prova gira sullo schema
-- com'e' davvero.
DO $$
DECLARE v_alimentari uuid; v_sotto uuid; v_altra uuid;
BEGIN
  SELECT id INTO v_alimentari FROM public.categories WHERE slug = 'alimentari' AND parent_id IS NULL;
  IF v_alimentari IS NULL THEN
    INSERT INTO public.categories (id, slug, name, parent_id)
    VALUES ('c0000000-0000-0000-0000-000000000001', 'alimentari', 'Alimentari', NULL)
    RETURNING id INTO v_alimentari;
  END IF;

  SELECT id INTO v_sotto FROM public.categories WHERE parent_id = v_alimentari LIMIT 1;
  IF v_sotto IS NULL THEN
    INSERT INTO public.categories (id, slug, name, parent_id)
    VALUES ('c0000000-0000-0000-0000-000000000002', 'pane-e-forno-prova', 'Pane e forno', v_alimentari)
    RETURNING id INTO v_sotto;
  END IF;

  SELECT id INTO v_altra FROM public.categories WHERE parent_id IS NULL AND slug <> 'alimentari' LIMIT 1;
  IF v_altra IS NULL THEN
    INSERT INTO public.categories (id, slug, name, parent_id)
    VALUES ('c0000000-0000-0000-0000-000000000003', 'casa-prova', 'Casa', NULL)
    RETURNING id INTO v_altra;
  END IF;

  CREATE TEMP TABLE categorie_prova ON COMMIT DROP AS
    SELECT v_alimentari AS alimentari, v_sotto AS sotto, v_altra AS altra;
END $$;

-- ---------------------------------------------------------------------------
-- ① Un alimentare pubblicato senza allergeni viene rifiutato
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  INSERT INTO public.products (id, seller_id, category_id, name, price, status, attributes)
  VALUES ('d0000000-0000-0000-0000-000000000001',
          '11111111-1111-1111-1111-111111111111',
          (SELECT alimentari FROM categorie_prova),
          'Focaccia', 4.50, 'available', '{}'::jsonb);
  INSERT INTO esiti VALUES ('un alimentare senza allergeni NON si pubblica', false, 'e passato lo stesso');
EXCEPTION WHEN others THEN
  INSERT INTO esiti VALUES ('un alimentare senza allergeni NON si pubblica', true, 'rifiutato: ' || SQLERRM);
END $$;

-- ---------------------------------------------------------------------------
-- ② Anche una SOTTOCATEGORIA degli alimentari e' coperta
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  INSERT INTO public.products (id, seller_id, category_id, name, price, status, attributes)
  VALUES ('d0000000-0000-0000-0000-000000000002',
          '11111111-1111-1111-1111-111111111111',
          (SELECT sotto FROM categorie_prova),
          'Michetta', 0.60, 'available', '{}'::jsonb);
  INSERT INTO esiti VALUES ('la sottocategoria eredita l obbligo dal padre', false, 'e passato lo stesso');
EXCEPTION WHEN others THEN
  INSERT INTO esiti VALUES ('la sottocategoria eredita l obbligo dal padre', true, 'rifiutato');
END $$;

-- ---------------------------------------------------------------------------
-- ③ Con gli allergeni dichiarati si pubblica
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  INSERT INTO public.products (id, seller_id, category_id, name, price, status, attributes)
  VALUES ('d0000000-0000-0000-0000-000000000003',
          '11111111-1111-1111-1111-111111111111',
          (SELECT alimentari FROM categorie_prova),
          'Pane comune', 3.00, 'available', '{"allergeni":"Glutine"}'::jsonb);
  INSERT INTO esiti VALUES ('con gli allergeni dichiarati si pubblica', true, 'passato');
EXCEPTION WHEN others THEN
  INSERT INTO esiti VALUES ('con gli allergeni dichiarati si pubblica', false, 'rifiutato: ' || SQLERRM);
END $$;

-- ---------------------------------------------------------------------------
-- ④ «Nessuno dei 14 allergeni» e' una dichiarazione valida
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  INSERT INTO public.products (id, seller_id, category_id, name, price, status, attributes)
  VALUES ('d0000000-0000-0000-0000-000000000004',
          '11111111-1111-1111-1111-111111111111',
          (SELECT alimentari FROM categorie_prova),
          'Mele', 2.00, 'available', '{"allergeni":"Nessuno dei 14 allergeni"}'::jsonb);
  INSERT INTO esiti VALUES ('«nessuno dei 14 allergeni» e una dichiarazione valida', true, 'passato');
EXCEPTION WHEN others THEN
  INSERT INTO esiti VALUES ('«nessuno dei 14 allergeni» e una dichiarazione valida', false, 'rifiutato: ' || SQLERRM);
END $$;

-- ---------------------------------------------------------------------------
-- ⑤ La bozza resta libera: si blocca la pubblicazione, non il lavoro
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  INSERT INTO public.products (id, seller_id, category_id, name, price, status, attributes)
  VALUES ('d0000000-0000-0000-0000-000000000005',
          '11111111-1111-1111-1111-111111111111',
          (SELECT alimentari FROM categorie_prova),
          'Torta in lavorazione', 12.00, 'draft', '{}'::jsonb);
  INSERT INTO esiti VALUES ('la bozza si salva anche senza allergeni', true, 'passato');
EXCEPTION WHEN others THEN
  INSERT INTO esiti VALUES ('la bozza si salva anche senza allergeni', false, 'rifiutato: ' || SQLERRM);
END $$;

-- Ma pubblicarla dopo, sempre vuota, no.
DO $$
BEGIN
  UPDATE public.products SET status = 'available'
   WHERE id = 'd0000000-0000-0000-0000-000000000005';
  INSERT INTO esiti VALUES ('una bozza vuota non diventa pubblicabile dopo', false, 'e passata lo stesso');
EXCEPTION WHEN others THEN
  INSERT INTO esiti VALUES ('una bozza vuota non diventa pubblicabile dopo', true, 'rifiutata');
END $$;

-- ---------------------------------------------------------------------------
-- ⑥ Le altre categorie non vengono toccate
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  INSERT INTO public.products (id, seller_id, category_id, name, price, status, attributes)
  VALUES ('d0000000-0000-0000-0000-000000000006',
          '11111111-1111-1111-1111-111111111111',
          (SELECT altra FROM categorie_prova),
          'Tovaglia', 15.00, 'available', '{}'::jsonb);
  INSERT INTO esiti VALUES ('una tovaglia non ha bisogno di allergeni', true, 'passato');
EXCEPTION WHEN others THEN
  INSERT INTO esiti VALUES ('una tovaglia non ha bisogno di allergeni', false, 'rifiutato: ' || SQLERRM);
END $$;

-- =============================================================================
-- Verdetto
-- =============================================================================
DO $$
DECLARE r record; rossi int;
BEGIN
  FOR r IN SELECT * FROM esiti ORDER BY nome LOOP
    RAISE INFO '%  %  — %', CASE WHEN r.ok THEN 'ok  ' ELSE 'ROTTO' END, r.nome, r.dettaglio;
  END LOOP;
  SELECT count(*) INTO rossi FROM esiti WHERE NOT ok;
  IF rossi > 0 THEN
    RAISE EXCEPTION '% controlli rossi in questo file', rossi;
  END IF;
END $$;

ROLLBACK;

-- =============================================================================
-- R18-014 — La risalita dei genitori delle categorie si ferma su un cerchio
-- (migrazione 426)
-- =============================================================================
--   tests/sql/harness/apply.sh mycity_test && tests/sql/harness/run.sh mycity_test
--
-- Nei dati due categorie si tengono a vicenda (A sotto B, B sotto A): la chiave
-- esterna su parent_id non lo impedisce. Ogni controllo ha 5 secondi.
-- ① un prodotto in vendita in una categoria del cerchio si salva (prima: la
--    risalita del guardiano dei prodotti girava fino al timeout)
-- ② se una categoria del cerchio porta l'obbligo alimentare, il prodotto senza
--    allergeni e' fermato col messaggio giusto, non dal timeout
-- ③ radice_con_obbligo_alimentare risponde su una categoria del cerchio
-- ④ spostare una categoria sotto il cerchio si puo' (il guardiano delle
--    categorie risale anche lui)
-- ⑤ una catena lunga 30 livelli non blocca niente
-- ⑥ lontano dal cerchio niente cambia: una sottocategoria di «alimentari» senza
--    allergeni resta fermata, con gli allergeni e gli ingredienti si salva
-- ⑦ l'obbligo in cima a una catena di 30 livelli arriva fino in fondo: nessun
--    tetto di passi lo perde per strada (un tetto di 20 lasciava passare)
-- ⑧ la vecchia guardia della 126, riagganciata come dice il ritorno indietro
--    della 195, regge anche lei il cerchio
-- Senza la 426 ①-④ e ⑧ vanno in timeout. ROLLBACK finale.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('14141414-1414-1414-1414-141414141414', 'bottega-cerchio-r18@test.it', '{"role":"seller"}');
UPDATE public.profiles
   SET is_approved = true, approval_status = 'approved', store_name = 'Bottega del cerchio',
       store_address = 'Via Roma 1', store_lat = 45.05, store_lng = 9.69
 WHERE id = '14141414-1414-1414-1414-141414141414';

-- Il cerchio senza obbligo: A ⇄ B. Il cerchio con l'obbligo: C ⇄ D, D lo porta.
INSERT INTO public.categories (id, slug, name, richiede_dichiarazioni_alimentari) VALUES
  ('c1800000-0000-0000-0000-00000000000a', 'r18-cerchio-a', 'Cerchio A', false),
  ('c1800000-0000-0000-0000-00000000000b', 'r18-cerchio-b', 'Cerchio B', false),
  ('c1800000-0000-0000-0000-00000000000c', 'r18-cerchio-c', 'Cerchio C', false),
  ('c1800000-0000-0000-0000-00000000000d', 'r18-cerchio-d', 'Cerchio D', true),
  ('c1800000-0000-0000-0000-00000000000e', 'r18-da-spostare', 'Da spostare', false);
UPDATE public.categories SET parent_id = 'c1800000-0000-0000-0000-00000000000a' WHERE id = 'c1800000-0000-0000-0000-00000000000b';
UPDATE public.categories SET parent_id = 'c1800000-0000-0000-0000-00000000000b' WHERE id = 'c1800000-0000-0000-0000-00000000000a';
UPDATE public.categories SET parent_id = 'c1800000-0000-0000-0000-00000000000c' WHERE id = 'c1800000-0000-0000-0000-00000000000d';
UPDATE public.categories SET parent_id = 'c1800000-0000-0000-0000-00000000000d' WHERE id = 'c1800000-0000-0000-0000-00000000000c';

-- Una catena di 30 livelli: L1 radice, L30 in fondo.
INSERT INTO public.categories (id, slug, name, parent_id)
SELECT ('c1810000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid,
       'r18-livello-' || n, 'Livello ' || n,
       CASE WHEN n = 1 THEN NULL ELSE ('c1810000-0000-0000-0000-0000000000' || lpad((n - 1)::text, 2, '0'))::uuid END
  FROM generate_series(1, 30) AS n
 ORDER BY n;

-- Un'altra catena di 30 livelli, con l'obbligo alimentare sulla radice M1.
INSERT INTO public.categories (id, slug, name, parent_id, richiede_dichiarazioni_alimentari)
SELECT ('c1820000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid,
       'r18-profondo-' || n, 'Profondo ' || n,
       CASE WHEN n = 1 THEN NULL ELSE ('c1820000-0000-0000-0000-0000000000' || lpad((n - 1)::text, 2, '0'))::uuid END,
       n = 1
  FROM generate_series(1, 30) AS n
 ORDER BY n;

SET LOCAL statement_timeout = '5s';

-- ① prodotto in vendita in una categoria del cerchio senza obbligo
DO $$
BEGIN
  INSERT INTO public.products (seller_id, name, price, status, category_id)
  VALUES ('14141414-1414-1414-1414-141414141414', 'Vaso di coccio', 12.50, 'available', 'c1800000-0000-0000-0000-00000000000a');
  INSERT INTO esiti VALUES ('un prodotto in una categoria del cerchio si salva', true, 'salvato');
EXCEPTION
  WHEN query_canceled THEN
    INSERT INTO esiti VALUES ('un prodotto in una categoria del cerchio si salva', false, 'timeout: la risalita gira in tondo');
  WHEN others THEN
    INSERT INTO esiti VALUES ('un prodotto in una categoria del cerchio si salva', false, SQLERRM);
END $$;

-- ② cerchio con l'obbligo: fermato col messaggio degli allergeni
DO $$
BEGIN
  INSERT INTO public.products (seller_id, name, price, status, category_id)
  VALUES ('14141414-1414-1414-1414-141414141414', 'Torta della casa', 18, 'available', 'c1800000-0000-0000-0000-00000000000c');
  INSERT INTO esiti VALUES ('nel cerchio con l''obbligo il prodotto senza allergeni è fermato', false, 'salvato senza allergeni');
EXCEPTION
  WHEN query_canceled THEN
    INSERT INTO esiti VALUES ('nel cerchio con l''obbligo il prodotto senza allergeni è fermato', false, 'timeout: la risalita gira in tondo');
  WHEN check_violation THEN
    INSERT INTO esiti VALUES ('nel cerchio con l''obbligo il prodotto senza allergeni è fermato', SQLERRM LIKE '%allergeni%', SQLERRM);
  WHEN others THEN
    INSERT INTO esiti VALUES ('nel cerchio con l''obbligo il prodotto senza allergeni è fermato', false, SQLERRM);
END $$;

-- ③ la funzione della radice risponde
DO $$
DECLARE v boolean; w boolean;
BEGIN
  v := public.radice_con_obbligo_alimentare('c1800000-0000-0000-0000-00000000000c');
  w := public.radice_con_obbligo_alimentare('c1800000-0000-0000-0000-00000000000b');
  INSERT INTO esiti VALUES ('radice_con_obbligo_alimentare risponde sul cerchio', v IS TRUE AND w IS FALSE,
                            format('cerchio C⇄D: %s, cerchio A⇄B: %s', v, w));
EXCEPTION
  WHEN query_canceled THEN
    INSERT INTO esiti VALUES ('radice_con_obbligo_alimentare risponde sul cerchio', false, 'timeout: la risalita gira in tondo');
END $$;

-- ④ spostare una categoria sotto il cerchio con l'obbligo
DO $$
BEGIN
  UPDATE public.categories SET parent_id = 'c1800000-0000-0000-0000-00000000000c'
   WHERE id = 'c1800000-0000-0000-0000-00000000000e';
  UPDATE public.categories SET parent_id = 'c1800000-0000-0000-0000-00000000000a'
   WHERE id = 'c1800000-0000-0000-0000-00000000000e';
  INSERT INTO esiti VALUES ('una categoria si sposta sotto il cerchio senza bloccarsi', false,
                            'uscita da sotto un cerchio con l''obbligo verso uno senza');
EXCEPTION
  WHEN query_canceled THEN
    INSERT INTO esiti VALUES ('una categoria si sposta sotto il cerchio senza bloccarsi', false, 'timeout: la risalita gira in tondo');
  WHEN check_violation THEN
    -- Il primo spostamento riesce; il secondo la porterebbe fuori dall'obbligo: fermato, come per una radice vera.
    INSERT INTO esiti VALUES ('una categoria si sposta sotto il cerchio senza bloccarsi',
                              SQLERRM LIKE '%non si sposta fuori%', SQLERRM);
END $$;

-- ⑤ catena di 30 livelli
DO $$
BEGIN
  INSERT INTO public.products (seller_id, name, price, status, category_id)
  VALUES ('14141414-1414-1414-1414-141414141414', 'Cosa in fondo', 3, 'available', 'c1810000-0000-0000-0000-000000000030');
  INSERT INTO esiti VALUES ('una catena di 30 livelli non blocca il salvataggio', true, 'salvato');
EXCEPTION
  WHEN query_canceled THEN
    INSERT INTO esiti VALUES ('una catena di 30 livelli non blocca il salvataggio', false, 'timeout');
  WHEN others THEN
    INSERT INTO esiti VALUES ('una catena di 30 livelli non blocca il salvataggio', false, SQLERRM);
END $$;

-- ⑥ lontano dal cerchio: una sottocategoria vera di «alimentari»
DO $$
DECLARE v_sotto uuid;
BEGIN
  INSERT INTO public.categories (slug, name, parent_id)
  SELECT 'r18-pane', 'Pane', id FROM public.categories WHERE slug = 'alimentari' AND parent_id IS NULL
  RETURNING id INTO v_sotto;
  BEGIN
    INSERT INTO public.products (seller_id, name, price, status, category_id)
    VALUES ('14141414-1414-1414-1414-141414141414', 'Pane di casa', 2.5, 'available', v_sotto);
    INSERT INTO esiti VALUES ('sotto «alimentari» senza allergeni resta fermato', false, 'salvato senza allergeni');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO esiti VALUES ('sotto «alimentari» senza allergeni resta fermato', SQLERRM LIKE '%allergeni%', SQLERRM);
  END;
  INSERT INTO public.products (seller_id, name, price, status, category_id, attributes)
  VALUES ('14141414-1414-1414-1414-141414141414', 'Pane dichiarato', 2.5, 'available', v_sotto,
          '{"allergeni":"Glutine","ingredienti":"Farina, acqua, sale, lievito"}');
  INSERT INTO esiti VALUES ('sotto «alimentari» con le dichiarazioni si salva', true, 'salvato');
EXCEPTION
  WHEN query_canceled THEN
    INSERT INTO esiti VALUES ('sotto «alimentari» con le dichiarazioni si salva', false, 'timeout');
  WHEN others THEN
    INSERT INTO esiti VALUES ('sotto «alimentari» con le dichiarazioni si salva', false, SQLERRM);
END $$;

-- ⑦ l'obbligo della radice M1 vale anche per M30
DO $$
BEGIN
  INSERT INTO public.products (seller_id, name, price, status, category_id)
  VALUES ('14141414-1414-1414-1414-141414141414', 'Biscotti dal fondo', 4, 'available', 'c1820000-0000-0000-0000-000000000030');
  INSERT INTO esiti VALUES ('l''obbligo in cima a 30 livelli arriva fino in fondo', false, 'salvato senza allergeni a 30 livelli dalla radice');
EXCEPTION
  WHEN query_canceled THEN
    INSERT INTO esiti VALUES ('l''obbligo in cima a 30 livelli arriva fino in fondo', false, 'timeout');
  WHEN check_violation THEN
    INSERT INTO esiti VALUES ('l''obbligo in cima a 30 livelli arriva fino in fondo', SQLERRM LIKE '%allergeni%', SQLERRM);
  WHEN others THEN
    INSERT INTO esiti VALUES ('l''obbligo in cima a 30 livelli arriva fino in fondo', false, SQLERRM);
END $$;

-- ⑧ la guardia della 126 riagganciata (solo dentro questa prova, che finisce in ROLLBACK)
CREATE TRIGGER r18_prova_guardia_126
  BEFORE INSERT ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.alimentare_senza_allergeni_non_si_pubblica();
DO $$
BEGIN
  INSERT INTO public.products (seller_id, name, price, status, category_id)
  VALUES ('14141414-1414-1414-1414-141414141414', 'Ciotola di coccio', 9, 'available', 'c1800000-0000-0000-0000-00000000000b');
  INSERT INTO esiti VALUES ('la guardia della 126 regge il cerchio', true, 'salvato');
EXCEPTION
  WHEN query_canceled THEN
    INSERT INTO esiti VALUES ('la guardia della 126 regge il cerchio', false, 'timeout: la risalita della 126 gira in tondo');
  WHEN others THEN
    INSERT INTO esiti VALUES ('la guardia della 126 regge il cerchio', false, SQLERRM);
END $$;
DROP TRIGGER r18_prova_guardia_126 ON public.products;

SET LOCAL statement_timeout = 0;

DO $$
DECLARE r record; rossi int;
BEGIN
  FOR r IN SELECT * FROM esiti ORDER BY nome LOOP
    RAISE INFO '%  %  — %', CASE WHEN r.ok THEN 'ok  ' ELSE 'ROTTO' END, r.nome, r.dettaglio;
  END LOOP;
  SELECT count(*) INTO rossi FROM esiti WHERE ok IS NOT TRUE;
  IF rossi > 0 OR (SELECT count(*) FROM esiti) <> 9 THEN
    RAISE EXCEPTION '% controlli su % sono rossi (attesi 9)', rossi, (SELECT count(*) FROM esiti);
  END IF;
  RAISE INFO 'tutti verdi: % controlli', (SELECT count(*) FROM esiti);
END $$;

ROLLBACK;

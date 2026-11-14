-- =============================================================================
-- R16-004 — Il prodotto e le sue varianti si salvano insieme (salva_prodotto_e_varianti, migrations/405)
-- =============================================================================
-- Una maglietta da 20 € con la S (2 pezzi) e la M (3), nei preferiti di un cliente.
-- Il negoziante apre la scheda; mentre è aperta si vende una S (ne resta 1). Lui la
-- rinomina, la porta a 15 € (un ribasso che manda l'avviso «Prezzo abbassato») e
-- cambia le taglie:
--   ① la S riscritta a 4 (vista 2, ora 1): la chiamata cade e NON resta niente, né
--     nome né prezzo né scorta, e nessun avviso di ribasso;
--   ② una variante che il database rifiuta DOPO che il prodotto è già scritto (e il
--     trigger del ribasso ha già scritto l'avviso): torna indietro tutto, avviso compreso;
--   ③ la scorta del prodotto non è più quella vista: niente si scrive;
--   ④ un altro negozio non la può usare sul prodotto di questo, e nemmeno il negozio
--     stesso può scrivere una colonna fuori lista (il negozio del prodotto);
--   ⑤ l'anonimo non la può chiamare;
--   ⑥ il caso buono salva tutto insieme: nome, prezzo, S non toccata (resta 1), M tolta,
--     XL nuova, scorta = somma, e un avviso di ribasso;
--   ⑦ la chiave di servizio (la rotta dell'amministrazione) salva anche senza essere
--     il negozio.
-- Tutto in transazione, ROLLBACK.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated, service_role;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('e4050000-0000-0000-0000-000000000001', 'negozio-405@test.it', '{"role":"seller"}'),
  ('e4050000-0000-0000-0000-000000000002', 'altro-405@test.it',   '{"role":"seller"}'),
  ('e4050000-0000-0000-0000-000000000003', 'cliente-405@test.it', '{}');
UPDATE public.profiles SET is_approved = true, approval_status = 'approved', store_name = 'Magliette 405'
 WHERE id = 'e4050000-0000-0000-0000-000000000001';
UPDATE public.profiles SET is_approved = true, approval_status = 'approved', store_name = 'Altro 405'
 WHERE id = 'e4050000-0000-0000-0000-000000000002';

INSERT INTO public.products (id, seller_id, name, description, price, stock, status, images) VALUES
  ('e4050000-0000-0000-0000-0000000000f1', 'e4050000-0000-0000-0000-000000000001', 'Maglietta',
   'Cotone pettinato, girocollo.', 20, 0, 'available', '["https://mycity.test/maglietta.jpg"]'),
  ('e4050000-0000-0000-0000-0000000000f2', 'e4050000-0000-0000-0000-000000000001', 'Focaccia',
   'Con olio extravergine.', 4, 5, 'available', '["https://mycity.test/focaccia.jpg"]');
INSERT INTO public.product_variants (id, product_id, options, label, stock, position) VALUES
  ('e4050000-0000-0000-0000-00000000005a', 'e4050000-0000-0000-0000-0000000000f1', '{"taglia":"S"}', 'S', 2, 0),
  ('e4050000-0000-0000-0000-00000000005b', 'e4050000-0000-0000-0000-0000000000f1', '{"taglia":"M"}', 'M', 3, 1);
INSERT INTO public.favorites (user_id, product_id) VALUES
  ('e4050000-0000-0000-0000-000000000003', 'e4050000-0000-0000-0000-0000000000f1'),
  ('e4050000-0000-0000-0000-000000000003', 'e4050000-0000-0000-0000-0000000000f2');

-- Mentre la scheda è aperta si vende una S: ne resta 1 (la maglietta scende a 4 pezzi).
UPDATE public.product_variants SET stock = 1 WHERE id = 'e4050000-0000-0000-0000-00000000005a';

-- ② Una regola del database che rifiuta la variante «VIETATA» al momento di scriverla,
-- cioè dopo la riga del prodotto: dice anche se l'avviso del ribasso era già scritto
-- (coi permessi di chi crea la prova: gli avvisi del cliente il negozio non li vede).
CREATE FUNCTION pg_temp.variante_vietata() RETURNS trigger LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.label = 'VIETATA' THEN
    RAISE EXCEPTION 'variante_vietata (prezzo già scritto: %, avviso già scritto: %)',
      (SELECT price = 15 FROM public.products WHERE id = NEW.product_id)::text,
      (EXISTS (SELECT 1 FROM public.notifications
                WHERE link = '/product/' || NEW.product_id AND title LIKE 'Prezzo abbassato%'))::text;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER zz_variante_vietata BEFORE INSERT ON public.product_variants
  FOR EACH ROW EXECUTE FUNCTION pg_temp.variante_vietata();

RESET mycity.allow_profile_write;

-- Le chiamate del negoziante proprietario.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"e4050000-0000-0000-0000-000000000001","role":"authenticated"}';

DO $$
BEGIN
  -- ① la S vista a 2, ora 1, riscritta a 4
  BEGIN
    PERFORM public.salva_prodotto_e_varianti(
      'e4050000-0000-0000-0000-0000000000f1',
      '{"name":"Maglietta bio","price":15}'::jsonb, NULL,
      '[{"id":"e4050000-0000-0000-0000-00000000005a","options":{"taglia":"S"},"label":"S","stock":4},
        {"id":"e4050000-0000-0000-0000-00000000005b","options":{"taglia":"M"},"label":"M","stock":3}]'::jsonb,
      '{"e4050000-0000-0000-0000-00000000005a":2,"e4050000-0000-0000-0000-00000000005b":3}'::jsonb);
    INSERT INTO esiti VALUES ('① la taglia venduta nel frattempo ferma la chiamata', false, 'nessun errore');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO esiti VALUES ('① la taglia venduta nel frattempo ferma la chiamata',
      SQLERRM = 'scorta_variante_cambiata', SQLERRM);
  END;

  -- ② la XL «VIETATA» cade quando il prodotto è già scritto
  BEGIN
    PERFORM public.salva_prodotto_e_varianti(
      'e4050000-0000-0000-0000-0000000000f1',
      '{"name":"Maglietta bio","price":15}'::jsonb, NULL,
      '[{"id":"e4050000-0000-0000-0000-00000000005a","options":{"taglia":"S"},"label":"S","stock":2},
        {"id":"e4050000-0000-0000-0000-00000000005b","options":{"taglia":"M"},"label":"M","stock":3},
        {"options":{"taglia":"XL"},"label":"VIETATA","stock":2}]'::jsonb,
      '{"e4050000-0000-0000-0000-00000000005a":2,"e4050000-0000-0000-0000-00000000005b":3}'::jsonb);
    INSERT INTO esiti VALUES ('② la variante rifiutata dopo il prodotto ferma la chiamata', false, 'nessun errore');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO esiti VALUES ('② la variante rifiutata dopo il prodotto ferma la chiamata',
      SQLERRM LIKE 'variante_vietata (prezzo già scritto: true, avviso già scritto: true)%', SQLERRM);
  END;

  -- ③ la focaccia: scorta vista 6, ma ce ne sono 5
  BEGIN
    PERFORM public.salva_prodotto_e_varianti(
      'e4050000-0000-0000-0000-0000000000f2', '{"price":3.5,"stock":8}'::jsonb, 6, NULL, NULL);
    INSERT INTO esiti VALUES ('③ la scorta del prodotto cambiata ferma la chiamata', false, 'nessun errore');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO esiti VALUES ('③ la scorta del prodotto cambiata ferma la chiamata',
      SQLERRM = 'scorta_prodotto_cambiata', SQLERRM);
  END;

  -- ④bis il negozio prova a regalare il prodotto a un altro negozio
  BEGIN
    PERFORM public.salva_prodotto_e_varianti(
      'e4050000-0000-0000-0000-0000000000f2', '{"seller_id":"e4050000-0000-0000-0000-000000000002"}'::jsonb);
    INSERT INTO esiti VALUES ('④bis una colonna fuori lista non si scrive', false, 'nessun errore');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO esiti VALUES ('④bis una colonna fuori lista non si scrive', SQLERRM = 'colonna_non_ammessa', SQLERRM);
  END;
END $$;

-- ④ un altro negozio
SET LOCAL request.jwt.claims = '{"sub":"e4050000-0000-0000-0000-000000000002","role":"authenticated"}';
DO $$
BEGIN
  PERFORM public.salva_prodotto_e_varianti(
    'e4050000-0000-0000-0000-0000000000f1', '{"name":"Maglietta rubata","price":1}'::jsonb, NULL, '[]'::jsonb, NULL);
  INSERT INTO esiti VALUES ('④ un altro negozio non salva il prodotto di questo', false, 'nessun errore');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO esiti VALUES ('④ un altro negozio non salva il prodotto di questo', SQLERRM = 'prodotto_non_tuo', SQLERRM);
END $$;

-- ⑤ l'anonimo
SET LOCAL ROLE anon;
SET LOCAL request.jwt.claims = '{"role":"anon"}';
DO $$
BEGIN
  PERFORM public.salva_prodotto_e_varianti('e4050000-0000-0000-0000-0000000000f2', '{"price":1}'::jsonb);
  INSERT INTO esiti VALUES ('⑤ l anonimo non chiama la funzione', false, 'nessun errore');
EXCEPTION
  WHEN insufficient_privilege THEN
    INSERT INTO esiti VALUES ('⑤ l anonimo non chiama la funzione', true, SQLERRM);
  WHEN OTHERS THEN
    INSERT INTO esiti VALUES ('⑤ l anonimo non chiama la funzione', false, 'errore diverso: ' || SQLERRM);
END $$;
RESET ROLE;
RESET request.jwt.claims;

INSERT INTO esiti SELECT '⑤ nemmeno il permesso c è', NOT has_function_privilege('anon',
  'public.salva_prodotto_e_varianti(uuid, jsonb, integer, jsonb, jsonb)', 'EXECUTE'), '';

-- Dopo ①–⑤ la maglietta e la focaccia sono come prima, e nessun avviso di ribasso.
INSERT INTO esiti SELECT '①②④ la maglietta resta com era (nome, prezzo, scorta)',
  (SELECT name = 'Maglietta' AND price = 20 AND stock = 4 FROM public.products WHERE id = 'e4050000-0000-0000-0000-0000000000f1'),
  (SELECT name || ' · ' || price || ' € · ' || stock || ' pezzi' FROM public.products WHERE id = 'e4050000-0000-0000-0000-0000000000f1');
INSERT INTO esiti SELECT '①② le taglie restano com erano (S 1, M 3)',
  (SELECT string_agg(label || ' ' || stock, ', ' ORDER BY position) = 'S 1, M 3'
     FROM public.product_variants WHERE product_id = 'e4050000-0000-0000-0000-0000000000f1'),
  (SELECT string_agg(label || ' ' || stock, ', ' ORDER BY position)
     FROM public.product_variants WHERE product_id = 'e4050000-0000-0000-0000-0000000000f1');
INSERT INTO esiti SELECT '③④bis la focaccia resta com era (prezzo 4, 5 pezzi, stesso negozio)',
  (SELECT price = 4 AND stock = 5 AND seller_id = 'e4050000-0000-0000-0000-000000000001'
     FROM public.products WHERE id = 'e4050000-0000-0000-0000-0000000000f2'),
  (SELECT price || ' € · ' || stock || ' pezzi' FROM public.products WHERE id = 'e4050000-0000-0000-0000-0000000000f2');
INSERT INTO esiti SELECT '①②③ nessun avviso di ribasso al cliente',
  NOT EXISTS (SELECT 1 FROM public.notifications
               WHERE user_id = 'e4050000-0000-0000-0000-000000000003' AND title LIKE 'Prezzo abbassato%'),
  (SELECT count(*)::text || ' avvisi' FROM public.notifications
    WHERE user_id = 'e4050000-0000-0000-0000-000000000003' AND title LIKE 'Prezzo abbassato%');

-- ⑥ il caso buono: S non toccata (vista 2, rimandata 2), M tolta, XL nuova
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"e4050000-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT public.salva_prodotto_e_varianti(
  'e4050000-0000-0000-0000-0000000000f1',
  '{"name":"Maglietta bio","price":15}'::jsonb, NULL,
  '[{"id":"e4050000-0000-0000-0000-00000000005a","options":{"taglia":"S"},"label":"S","stock":2},
    {"options":{"taglia":"XL"},"label":"XL","stock":2}]'::jsonb,
  '{"e4050000-0000-0000-0000-00000000005a":2,"e4050000-0000-0000-0000-00000000005b":3}'::jsonb);
RESET ROLE;
RESET request.jwt.claims;

INSERT INTO esiti SELECT '⑥ il caso buono salva nome e prezzo',
  (SELECT name = 'Maglietta bio' AND price = 15 FROM public.products WHERE id = 'e4050000-0000-0000-0000-0000000000f1'),
  (SELECT name || ' · ' || price || ' €' FROM public.products WHERE id = 'e4050000-0000-0000-0000-0000000000f1');
INSERT INTO esiti SELECT '⑥ e le taglie: S resta 1 (venduta), M tolta, XL 2',
  (SELECT string_agg(label || ' ' || stock, ', ' ORDER BY position) = 'S 1, XL 2'
     FROM public.product_variants WHERE product_id = 'e4050000-0000-0000-0000-0000000000f1'),
  (SELECT string_agg(label || ' ' || stock, ', ' ORDER BY position)
     FROM public.product_variants WHERE product_id = 'e4050000-0000-0000-0000-0000000000f1');
INSERT INTO esiti SELECT '⑥ la scorta del prodotto è la somma delle taglie',
  (SELECT stock = 3 FROM public.products WHERE id = 'e4050000-0000-0000-0000-0000000000f1'),
  (SELECT stock::text FROM public.products WHERE id = 'e4050000-0000-0000-0000-0000000000f1');
INSERT INTO esiti SELECT '⑥ un avviso di ribasso, quello vero',
  (SELECT count(*) = 1 FROM public.notifications
    WHERE user_id = 'e4050000-0000-0000-0000-000000000003' AND title LIKE 'Prezzo abbassato%'
      AND link = '/product/e4050000-0000-0000-0000-0000000000f1'),
  (SELECT count(*)::text || ' avvisi' FROM public.notifications
    WHERE user_id = 'e4050000-0000-0000-0000-000000000003' AND title LIKE 'Prezzo abbassato%');

-- ⑦ la chiave di servizio (rotta dell'amministrazione), senza essere il negozio
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims = '{"role":"service_role"}';
SELECT public.salva_prodotto_e_varianti(
  'e4050000-0000-0000-0000-0000000000f2', '{"name":"Focaccia genovese","external_marketplace":"other"}'::jsonb);
RESET ROLE;
RESET request.jwt.claims;
INSERT INTO esiti SELECT '⑦ la chiave di servizio salva anche le colonne dell amministrazione',
  (SELECT name = 'Focaccia genovese' AND external_marketplace = 'other'
     FROM public.products WHERE id = 'e4050000-0000-0000-0000-0000000000f2'),
  (SELECT name || ' · ' || coalesce(external_marketplace, '-') FROM public.products WHERE id = 'e4050000-0000-0000-0000-0000000000f2');

-- ⑧
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"e4050000-0000-0000-0000-000000000001","role":"service_role"}';
DO $$
DECLARE v_mercato text; v_prezzo numeric;
BEGIN
  BEGIN
    PERFORM public.salva_prodotto_e_varianti(
      'e4050000-0000-0000-0000-0000000000f1', '{"external_marketplace":"other"}'::jsonb);
    SELECT external_marketplace INTO v_mercato FROM public.products WHERE id = 'e4050000-0000-0000-0000-0000000000f1';
    INSERT INTO esiti VALUES ('⑧ il negozio non salva le colonne dell''amministrazione', false,
      'nessun errore · external_marketplace = ' || coalesce(v_mercato, '-'));
  EXCEPTION WHEN OTHERS THEN
    SELECT external_marketplace INTO v_mercato FROM public.products WHERE id = 'e4050000-0000-0000-0000-0000000000f1';
    INSERT INTO esiti VALUES ('⑧ il negozio non salva le colonne dell''amministrazione',
      SQLSTATE = '42501' AND SQLERRM = 'colonna_non_ammessa' AND v_mercato IS NULL,
      SQLSTATE || ' ' || SQLERRM || ' · external_marketplace = ' || coalesce(v_mercato, '-'));
  END;

  BEGIN
    PERFORM public.salva_prodotto_e_varianti(
      'e4050000-0000-0000-0000-0000000000f1', '{"price":0}'::jsonb);
    SELECT price INTO v_prezzo FROM public.products WHERE id = 'e4050000-0000-0000-0000-0000000000f1';
    INSERT INTO esiti VALUES ('⑧ il negozio non salva un prezzo a zero', false,
      'nessun errore · prezzo ' || coalesce(v_prezzo::text, '-') || ' €');
  EXCEPTION WHEN OTHERS THEN
    SELECT price INTO v_prezzo FROM public.products WHERE id = 'e4050000-0000-0000-0000-0000000000f1';
    INSERT INTO esiti VALUES ('⑧ il negozio non salva un prezzo a zero',
      SQLSTATE = '22023' AND SQLERRM = 'prezzo_non_valido' AND v_prezzo IS NOT DISTINCT FROM 15,
      SQLSTATE || ' ' || SQLERRM || ' · prezzo ' || coalesce(v_prezzo::text, '-') || ' €');
  END;
END $$;
RESET ROLE;
RESET request.jwt.claims;

SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims = '{"role":"service_role"}';
DO $$
DECLARE v_prezzo numeric;
BEGIN
  PERFORM public.salva_prodotto_e_varianti(
    'e4050000-0000-0000-0000-0000000000f2', '{"price":0}'::jsonb);
  SELECT price INTO v_prezzo FROM public.products WHERE id = 'e4050000-0000-0000-0000-0000000000f2';
  INSERT INTO esiti VALUES ('⑧ la chiave di servizio salva un prezzo a zero',
    v_prezzo IS NOT DISTINCT FROM 0, 'prezzo ' || coalesce(v_prezzo::text, '-') || ' €');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO esiti VALUES ('⑧ la chiave di servizio salva un prezzo a zero', false, SQLSTATE || ' ' || SQLERRM);
END $$;
RESET ROLE;
RESET request.jwt.claims;

DO $$
DECLARE r record; rossi int;
BEGIN
  FOR r IN SELECT * FROM esiti ORDER BY nome LOOP
    RAISE INFO '%  %  — %', CASE WHEN r.ok THEN 'ok  ' ELSE 'ROTTO' END, r.nome, r.dettaglio;
  END LOOP;
  SELECT count(*) INTO rossi FROM esiti WHERE ok IS NOT TRUE;
  IF rossi > 0 THEN
    RAISE EXCEPTION '% controlli rossi in questo file', rossi;
  END IF;
END $$;

ROLLBACK;

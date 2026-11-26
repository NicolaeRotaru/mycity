-- =============================================================================
-- Il prezzo che si paga lo sa il database (ordine e taglio di prezzo della griglia)
-- =============================================================================
--   tests/sql/harness/apply.sh mycity_test && psql -d mycity_test -f <questo file>
--
-- La griglia dei prodotti ordinava e tagliava sul prezzo pieno: un prodotto da 12 € al -25%
-- (9 € alla cassa) finiva dopo uno da 9,99 € e restava nell'elenco con «minimo 10 €».
-- Qui si cerca la colonna calcolata di `products` che restituisce il prezzo scontato (una funzione
-- con un solo argomento di tipo `products` che torna un numero) e si guarda cosa fa:
-- ① «prezzo crescente» mette il da 12 € scontato a 9 € per primo, prima del 9,99 €
-- ② «prezzo decrescente» è l'ordine inverso
-- ③ «prezzo minimo 10 €» lascia fuori il prodotto che alla cassa costa 9 €
-- ④ una promozione scaduta non sconta niente
-- ⑤ un visitatore senza account vede lo stesso prezzo scontato
-- ⑥ l'arrotondamento è quello della cassa (`discountedUnitCents`, virgola mobile): 19,99 € al -50%
--    costa 9,99 € (non 10,00), 12,85 € al -30% costa 8,99 € (non 9,00), 42,10 € al -5% 39,99 € (non 40,00)
-- ⑦ una promozione per categoria sconta solo i prodotti di quella categoria
-- ⑧ una promozione futura o annullata non sconta niente
-- ⑨ la funzione ha il suo GRANT EXECUTE per anon e authenticated (regola della migrazione 425)
-- Senza la colonna calcolata il controllo ① è rosso; con l'arrotondamento esatto il ⑥ è rosso. Tutto con ROLLBACK.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('f1000000-0000-0000-0000-000000000001', 'negozio-pagato-1@test.it', '{"role":"seller"}'),
  ('f1000000-0000-0000-0000-000000000002', 'negozio-pagato-2@test.it', '{"role":"seller"}'),
  ('f1000000-0000-0000-0000-000000000003', 'negozio-pagato-3@test.it', '{"role":"seller"}'),
  ('f1000000-0000-0000-0000-000000000004', 'negozio-pagato-4@test.it', '{"role":"seller"}'),
  ('f1000000-0000-0000-0000-000000000005', 'negozio-pagato-5@test.it', '{"role":"seller"}'),
  ('f1000000-0000-0000-0000-000000000006', 'negozio-pagato-6@test.it', '{"role":"seller"}'),
  ('f1000000-0000-0000-0000-000000000007', 'negozio-pagato-7@test.it', '{"role":"seller"}');

UPDATE public.profiles
   SET is_approved = true, visibile_senza_abbonamento = true, approval_status = 'approved', role = 'seller',
       store_name = 'Bottega prezzi'
 WHERE id::text LIKE 'f1000000-0000-0000-0000-00000000000%';

INSERT INTO public.products (id, seller_id, name, description, price, stock, status, images) VALUES
  ('f2000000-0000-0000-0000-00000000000a', 'f1000000-0000-0000-0000-000000000001', 'Da dodici', 'x', 12,   5, 'available', '[]'::jsonb),
  ('f2000000-0000-0000-0000-00000000000b', 'f1000000-0000-0000-0000-000000000001', 'Da dieci',  'x', 10,   5, 'available', '[]'::jsonb),
  ('f2000000-0000-0000-0000-00000000000c', 'f1000000-0000-0000-0000-000000000001', 'Da 9,99',   'x', 9.99, 5, 'available', '[]'::jsonb),
  ('f2000000-0000-0000-0000-00000000000d', 'f1000000-0000-0000-0000-000000000002', 'Da venti',  'x', 20,   5, 'available', '[]'::jsonb);

INSERT INTO public.categories (id, slug, name) VALUES
  ('f3000000-0000-0000-0000-000000000001', 'r10-prezzo-pagato-a', 'Categoria scontata'),
  ('f3000000-0000-0000-0000-000000000002', 'r10-prezzo-pagato-b', 'Categoria non scontata');

INSERT INTO public.products (id, seller_id, name, description, price, stock, status, images, category_id) VALUES
  ('f2000000-0000-0000-0000-000000000011', 'f1000000-0000-0000-0000-000000000003', 'Da 19,99', 'x', 19.99, 5, 'available', '[]'::jsonb, NULL),
  ('f2000000-0000-0000-0000-000000000012', 'f1000000-0000-0000-0000-000000000004', 'Da 12,85', 'x', 12.85, 5, 'available', '[]'::jsonb, NULL),
  ('f2000000-0000-0000-0000-000000000013', 'f1000000-0000-0000-0000-000000000005', 'Da 42,10', 'x', 42.10, 5, 'available', '[]'::jsonb, NULL),
  ('f2000000-0000-0000-0000-000000000014', 'f1000000-0000-0000-0000-000000000006', 'Categoria dentro', 'x', 10, 5, 'available', '[]'::jsonb, 'f3000000-0000-0000-0000-000000000001'),
  ('f2000000-0000-0000-0000-000000000015', 'f1000000-0000-0000-0000-000000000006', 'Categoria fuori',  'x', 10, 5, 'available', '[]'::jsonb, 'f3000000-0000-0000-0000-000000000002'),
  ('f2000000-0000-0000-0000-000000000016', 'f1000000-0000-0000-0000-000000000007', 'Futura e annullata', 'x', 20, 5, 'available', '[]'::jsonb, NULL);

INSERT INTO public.seller_promotions (seller_id, title, scope, category_id, discount_percent, status, starts_at, ends_at) VALUES
  ('f1000000-0000-0000-0000-000000000003', 'Meta prezzo', 'store', NULL, 50, 'active', now() - interval '1 day', now() + interval '7 days'),
  ('f1000000-0000-0000-0000-000000000004', 'Meno trenta', 'store', NULL, 30, 'active', now() - interval '1 day', now() + interval '7 days'),
  ('f1000000-0000-0000-0000-000000000005', 'Meno cinque', 'store', NULL, 5, 'active', now() - interval '1 day', now() + interval '7 days'),
  ('f1000000-0000-0000-0000-000000000006', 'Una categoria', 'category', 'f3000000-0000-0000-0000-000000000001', 20, 'active', now() - interval '1 day', now() + interval '7 days'),
  ('f1000000-0000-0000-0000-000000000007', 'Futura', 'store', NULL, 50, 'active', now() + interval '2 days', now() + interval '9 days'),
  ('f1000000-0000-0000-0000-000000000007', 'Annullata', 'store', NULL, 40, 'cancelled', now() - interval '1 day', now() + interval '7 days');

-- Il -25% vale solo per il prodotto da 12 €; l'altro negozio ha una promozione già scaduta.
INSERT INTO public.seller_promotions (seller_id, title, scope, product_ids, discount_percent, status, starts_at, ends_at) VALUES
  ('f1000000-0000-0000-0000-000000000001', 'Solo il dodici', 'products', ARRAY['f2000000-0000-0000-0000-00000000000a'::uuid],
   25, 'active', now() - interval '1 day', now() + interval '7 days'),
  ('f1000000-0000-0000-0000-000000000002', 'Scaduta', 'store', NULL,
   50, 'active', now() - interval '10 days', now() - interval '1 day');

DO $$
DECLARE
  colonna text;
  elenco text;
  sotto text;
  prezzo numeric;
  ids text := $q$ ('f2000000-0000-0000-0000-00000000000a','f2000000-0000-0000-0000-00000000000b','f2000000-0000-0000-0000-00000000000c','f2000000-0000-0000-0000-00000000000d') $q$;
BEGIN
  -- La colonna calcolata: un solo argomento di tipo products, risultato numerico.
  SELECT p.proname INTO colonna
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
   WHERE p.pronargs = 1
     AND p.proargtypes[0] = 'public.products'::regtype::oid
     AND p.prorettype = 'numeric'::regtype
   LIMIT 1;
  INSERT INTO esiti VALUES ('esiste una colonna calcolata col prezzo pagato', colonna IS NOT NULL, 'nessuna funzione products -> numeric');
  IF colonna IS NULL THEN RETURN; END IF;

  EXECUTE format('SELECT string_agg(p.name, ''|'' ORDER BY public.%I(p) ASC, p.id) FROM public.products p WHERE p.id IN ' || ids, colonna) INTO elenco;
  INSERT INTO esiti VALUES ('① crescente: il 12 € scontato a 9 € passa davanti al 9,99 €',
    elenco = 'Da dodici|Da 9,99|Da dieci|Da venti', 'ordine ' || COALESCE(elenco, 'NULL'));

  EXECUTE format('SELECT string_agg(p.name, ''|'' ORDER BY public.%I(p) DESC, p.id) FROM public.products p WHERE p.id IN ' || ids, colonna) INTO elenco;
  INSERT INTO esiti VALUES ('② decrescente: ordine inverso',
    elenco = 'Da venti|Da dieci|Da 9,99|Da dodici', 'ordine ' || COALESCE(elenco, 'NULL'));

  EXECUTE format('SELECT string_agg(p.name, ''|'' ORDER BY p.name) FROM public.products p WHERE p.id IN ' || ids || ' AND public.%I(p) >= 10', colonna) INTO sotto;
  INSERT INTO esiti VALUES ('③ minimo 10 €: il 12 € a 9 € alla cassa resta fuori',
    sotto = 'Da dieci|Da venti', 'restano ' || COALESCE(sotto, 'NULL'));

  EXECUTE format('SELECT public.%I(p) FROM public.products p WHERE p.id = ''f2000000-0000-0000-0000-00000000000d''', colonna) INTO prezzo;
  INSERT INTO esiti VALUES ('④ la promozione scaduta non sconta', prezzo = 20, 'prezzo ' || COALESCE(prezzo::text, 'NULL'));

  SET LOCAL ROLE anon;
  EXECUTE format('SELECT public.%I(p) FROM public.products p WHERE p.id = ''f2000000-0000-0000-0000-00000000000a''', colonna) INTO prezzo;
  RESET ROLE;
  INSERT INTO esiti VALUES ('⑤ il visitatore senza account vede 9 €', prezzo = 9, 'prezzo ' || COALESCE(prezzo::text, 'NULL'));

  EXECUTE format('SELECT string_agg(p.name || ''='' || public.%I(p)::text, ''|'' ORDER BY p.name) FROM public.products p WHERE p.id IN (''f2000000-0000-0000-0000-000000000011'',''f2000000-0000-0000-0000-000000000012'',''f2000000-0000-0000-0000-000000000013'')', colonna) INTO elenco;
  INSERT INTO esiti VALUES ('⑥ arrotonda come la cassa: 19,99 al -50% = 9,99; 12,85 al -30% = 8,99; 42,10 al -5% = 39,99',
    elenco = 'Da 12,85=8.99|Da 19,99=9.99|Da 42,10=39.99', 'prezzi ' || COALESCE(elenco, 'NULL'));

  EXECUTE format('SELECT string_agg(p.name || ''='' || public.%I(p)::text, ''|'' ORDER BY p.name) FROM public.products p WHERE p.id IN (''f2000000-0000-0000-0000-000000000014'',''f2000000-0000-0000-0000-000000000015'')', colonna) INTO elenco;
  INSERT INTO esiti VALUES ('⑦ la promozione per categoria sconta solo la categoria (10 € al -20% = 8 €, l''altro resta 10 €)',
    elenco = 'Categoria dentro=8.00|Categoria fuori=10.00', 'prezzi ' || COALESCE(elenco, 'NULL'));

  EXECUTE format('SELECT public.%I(p) FROM public.products p WHERE p.id = ''f2000000-0000-0000-0000-000000000016''', colonna) INTO prezzo;
  INSERT INTO esiti VALUES ('⑧ la promozione futura e quella annullata non scontano', prezzo = 20, 'prezzo ' || COALESCE(prezzo::text, 'NULL'));

  -- GRANT scritto per nome (non il solo EXECUTE a PUBLIC che Postgres dà da solo).
  INSERT INTO esiti VALUES ('⑨ GRANT EXECUTE esplicito ad anon e authenticated',
    (SELECT count(DISTINCT a.grantee) FROM pg_proc p, LATERAL aclexplode(p.proacl) a
      WHERE p.proname = colonna AND p.pronargs = 1 AND p.proargtypes[0] = 'public.products'::regtype::oid
        AND a.privilege_type = 'EXECUTE'
        AND a.grantee IN ('anon'::regrole, 'authenticated'::regrole)) = 2,
    'EXECUTE esplicito mancante');
END $$;

DO $$
DECLARE r record; rossi int;
BEGIN
  FOR r IN SELECT * FROM esiti ORDER BY nome LOOP
    RAISE INFO '%  %  — %', CASE WHEN r.ok THEN 'ok  ' ELSE 'ROTTO' END, r.nome, r.dettaglio;
  END LOOP;
  SELECT count(*) INTO rossi FROM esiti WHERE ok IS NOT TRUE;
  IF rossi > 0 THEN
    RAISE EXCEPTION '% controlli su % sono rossi', rossi, (SELECT count(*) FROM esiti);
  END IF;
  RAISE INFO 'tutti verdi: % controlli', (SELECT count(*) FROM esiti);
END $$;

ROLLBACK;

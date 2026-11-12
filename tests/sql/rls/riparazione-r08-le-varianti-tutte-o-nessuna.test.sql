-- =============================================================================
-- R08-008 — Le varianti si salvano tutte o nessuna (salva_varianti, migrations/323)
-- =============================================================================
-- Una maglietta con S (2 pezzi), M (5) e L (1). Il negoziante toglie la L, porta la
-- S a 4, la M a 3 e aggiunge la XL. Nel frattempo una vendita ha portato la M a 4,
-- quindi la scorta vista (5) non c'è più:
--   ① il salvataggio dà «scorta_cambiata» e NON lascia niente a metà: la L c'è
--     ancora, la S resta a 2, la XL non c'è;
--   ② con le scorte giuste lo stesso salvataggio passa tutto;
--   ③ un altro negozio non tocca le varianti di questo (regole per riga);
--   ④ l'anonimo non può chiamare la funzione.
-- Tutto in transazione, ROLLBACK.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('e3230000-0000-0000-0000-000000000001', 'negozio-323@test.it', '{"role":"seller"}'),
  ('e3230000-0000-0000-0000-000000000002', 'altro-323@test.it',   '{"role":"seller"}');
UPDATE public.profiles SET is_approved = true, approval_status = 'approved', store_name = 'Magliette 323'
 WHERE id = 'e3230000-0000-0000-0000-000000000001';
UPDATE public.profiles SET is_approved = true, approval_status = 'approved', store_name = 'Altro 323'
 WHERE id = 'e3230000-0000-0000-0000-000000000002';

INSERT INTO public.products (id, seller_id, name, description, price, stock, status)
VALUES ('e3230000-0000-0000-0000-0000000000f1', 'e3230000-0000-0000-0000-000000000001', 'Maglietta', 'cotone', 15, 8, 'available');

INSERT INTO public.product_variants (id, product_id, options, label, stock, position) VALUES
  ('e3230000-0000-0000-0000-00000000005a', 'e3230000-0000-0000-0000-0000000000f1', '{"taglia":"S"}', 'S', 2, 0),
  ('e3230000-0000-0000-0000-00000000005b', 'e3230000-0000-0000-0000-0000000000f1', '{"taglia":"M"}', 'M', 4, 1),
  ('e3230000-0000-0000-0000-00000000005c', 'e3230000-0000-0000-0000-0000000000f1', '{"taglia":"L"}', 'L', 1, 2);

RESET mycity.allow_profile_write;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"e3230000-0000-0000-0000-000000000001","role":"authenticated"}';

-- ① la M vista a 5, ma una vendita l'ha portata a 4
DO $$
BEGIN
  BEGIN
    PERFORM public.salva_varianti(
      'e3230000-0000-0000-0000-0000000000f1',
      ARRAY['e3230000-0000-0000-0000-00000000005c']::uuid[],
      '[{"id":"e3230000-0000-0000-0000-00000000005a","options":{"taglia":"S"},"label":"S","position":0,"stock":4,"vista":2},
        {"id":"e3230000-0000-0000-0000-00000000005b","options":{"taglia":"M"},"label":"M","position":1,"stock":3,"vista":5}]'::jsonb,
      '[{"options":{"taglia":"XL"},"label":"XL","stock":2,"position":2}]'::jsonb);
    INSERT INTO esiti VALUES ('① la scorta cambiata ferma il salvataggio', false, 'nessun errore');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO esiti VALUES ('① la scorta cambiata ferma il salvataggio', SQLERRM = 'scorta_cambiata', SQLERRM);
  END;
END $$;

INSERT INTO esiti SELECT '① niente a metà: la L tolta c è ancora',
  EXISTS (SELECT 1 FROM public.product_variants WHERE id = 'e3230000-0000-0000-0000-00000000005c'), '';
INSERT INTO esiti SELECT '① niente a metà: la S resta a 2',
  (SELECT stock = 2 FROM public.product_variants WHERE id = 'e3230000-0000-0000-0000-00000000005a'),
  (SELECT stock::text FROM public.product_variants WHERE id = 'e3230000-0000-0000-0000-00000000005a');
INSERT INTO esiti SELECT '① niente a metà: la XL non c è',
  NOT EXISTS (SELECT 1 FROM public.product_variants WHERE product_id = 'e3230000-0000-0000-0000-0000000000f1' AND label = 'XL'), '';

-- ② con la M vista a 4 (quella vera) passa tutto
SELECT public.salva_varianti(
  'e3230000-0000-0000-0000-0000000000f1',
  ARRAY['e3230000-0000-0000-0000-00000000005c']::uuid[],
  '[{"id":"e3230000-0000-0000-0000-00000000005a","options":{"taglia":"S"},"label":"S","position":0,"stock":4,"vista":2},
    {"id":"e3230000-0000-0000-0000-00000000005b","options":{"taglia":"M"},"label":"M","position":1,"stock":3,"vista":4}]'::jsonb,
  '[{"options":{"taglia":"XL"},"label":"XL","stock":2,"position":2}]'::jsonb);

INSERT INTO esiti SELECT '② con le scorte giuste: S 4, M 3, XL 2, niente L',
  (SELECT string_agg(label || ' ' || stock, ', ' ORDER BY position) = 'S 4, M 3, XL 2'
     FROM public.product_variants WHERE product_id = 'e3230000-0000-0000-0000-0000000000f1'),
  (SELECT string_agg(label || ' ' || stock, ', ' ORDER BY position)
     FROM public.product_variants WHERE product_id = 'e3230000-0000-0000-0000-0000000000f1');

-- ②bis options null non scrive una jsonb null (la colonna è NOT NULL, ma la jsonb null passerebbe)
SELECT public.salva_varianti('e3230000-0000-0000-0000-0000000000f1', '{}'::uuid[],
  '[{"id":"e3230000-0000-0000-0000-00000000005a","options":null,"label":"S","position":0}]'::jsonb,
  '[{"options":null,"label":"XXL","stock":1,"position":3}]'::jsonb);
INSERT INTO esiti SELECT '②bis options null non diventa una jsonb null',
  (SELECT bool_and(jsonb_typeof(options) = 'object') FROM public.product_variants WHERE product_id = 'e3230000-0000-0000-0000-0000000000f1'),
  (SELECT string_agg(label || '=' || options::text, ' ') FROM public.product_variants WHERE product_id = 'e3230000-0000-0000-0000-0000000000f1');
DELETE FROM public.product_variants WHERE label = 'XXL' AND product_id = 'e3230000-0000-0000-0000-0000000000f1';

-- ③ un altro negozio prova a cancellare e riscrivere
SET LOCAL request.jwt.claims = '{"sub":"e3230000-0000-0000-0000-000000000002","role":"authenticated"}';
SELECT public.salva_varianti(
  'e3230000-0000-0000-0000-0000000000f1',
  ARRAY['e3230000-0000-0000-0000-00000000005a']::uuid[],
  '[{"id":"e3230000-0000-0000-0000-00000000005b","options":{},"label":"M","position":1,"stock":99}]'::jsonb,
  '[]'::jsonb);
SET LOCAL request.jwt.claims = '{"sub":"e3230000-0000-0000-0000-000000000001","role":"authenticated"}';
INSERT INTO esiti SELECT '③ un altro negozio non cancella né riscrive le varianti di questo',
  (SELECT string_agg(label || ' ' || stock, ', ' ORDER BY position) = 'S 4, M 3, XL 2'
     FROM public.product_variants WHERE product_id = 'e3230000-0000-0000-0000-0000000000f1'),
  (SELECT string_agg(label || ' ' || stock, ', ' ORDER BY position)
     FROM public.product_variants WHERE product_id = 'e3230000-0000-0000-0000-0000000000f1');
RESET ROLE;
RESET request.jwt.claims;

INSERT INTO esiti SELECT '④ l anonimo non chiama salva_varianti',
  NOT has_function_privilege('anon', 'public.salva_varianti(uuid, uuid[], jsonb, jsonb)', 'EXECUTE'), '';

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

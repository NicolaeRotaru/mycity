-- =============================================================================
-- R02-014 (12/11/2026) — Le visite del negoziante e dell'amministratore non
-- contano fra le visite dei clienti: né nell'Andamento del negozio né fra i
-- «più visti» della home.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('a2111111-1111-1111-1111-111111111111', 'negozio-r02@test.it', '{"role":"seller"}'),
  ('a2222222-2222-2222-2222-222222222222', 'admin-r02@test.it',   '{"role":"buyer"}'),
  ('a2333333-3333-3333-3333-333333333333', 'cliente-r02@test.it', '{"role":"buyer"}');

UPDATE public.profiles
   SET is_approved = true, approval_status = 'approved', store_name = 'Bottega R02'
 WHERE id = 'a2111111-1111-1111-1111-111111111111';
UPDATE public.profiles SET role = 'admin' WHERE id = 'a2222222-2222-2222-2222-222222222222';

INSERT INTO public.products (id, seller_id, name, description, price, stock, status)
VALUES ('a2999999-9999-9999-9999-999999999999',
        'a2111111-1111-1111-1111-111111111111',
        'Pane R02', 'per i test', 3.50, 100, 'available');

RESET mycity.allow_profile_write;

-- Quattro visite: il negoziante, l'amministratore, un cliente, un anonimo con impronta.
INSERT INTO public.product_views (product_id, user_id, view_fingerprint) VALUES
  ('a2999999-9999-9999-9999-999999999999', 'a2111111-1111-1111-1111-111111111111', NULL),
  ('a2999999-9999-9999-9999-999999999999', 'a2222222-2222-2222-2222-222222222222', NULL),
  ('a2999999-9999-9999-9999-999999999999', 'a2333333-3333-3333-3333-333333333333', NULL),
  ('a2999999-9999-9999-9999-999999999999', NULL, 'impronta-r02');

DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM public.product_views WHERE product_id = 'a2999999-9999-9999-9999-999999999999';
  INSERT INTO esiti VALUES ('le quattro visite sono state scritte', n = 4, 'righe: ' || n);
END $$;

-- I più visti della home, come li chiede un anonimo.
SET LOCAL ROLE anon;
DO $$
DECLARE n bigint;
BEGIN
  SELECT view_count INTO n FROM public.trending_product_ids_24h(50)
   WHERE product_id = 'a2999999-9999-9999-9999-999999999999';
  INSERT INTO esiti VALUES ('i più visti contano solo cliente e anonimo', n = 2, 'visite contate: ' || coalesce(n::text, 'nessuna'));
END $$;
RESET ROLE;

-- L'Andamento, come lo chiede il negoziante.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"a2111111-1111-1111-1111-111111111111","role":"authenticated"}';
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM public.andamento_del_negozio();
  INSERT INTO esiti VALUES ('l andamento non conta il negoziante né l admin', r.viste_30 = 2, 'viste_30: ' || r.viste_30);
  INSERT INTO esiti VALUES ('anche la visita per prodotto', (r.viste_per_prodotto ->> 'a2999999-9999-9999-9999-999999999999')::int = 2,
    'per prodotto: ' || coalesce(r.viste_per_prodotto::text, 'null'));
END $$;
RESET request.jwt.claims;
RESET ROLE;

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

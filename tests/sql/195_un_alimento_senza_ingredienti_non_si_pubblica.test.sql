-- Prova della migrazione 195: un alimento con gli allergeni ma SENZA ingredienti
-- non deve poter nascere 'available'.
-- Rossa prima della 195 (l'insert passa e la prova solleva FAIL), verde dopo.
-- Gira in una transazione e torna indietro: non lascia dati.
BEGIN;

-- Su un database vuoto (tests/sql/harness/apply.sh) crea il minimo che serve:
-- un negozio e la categoria alimentari. Tutto torna indietro col ROLLBACK.
SET mycity.allow_profile_write = '1';
INSERT INTO auth.users (id, email, raw_user_meta_data)
SELECT '19500000-0000-0000-0000-000000000001', 'prova195@test.it', '{"role":"seller"}'
 WHERE NOT EXISTS (SELECT 1 FROM public.profiles);
INSERT INTO public.categories (name, slug)
SELECT 'Alimentari', 'alimentari'
 WHERE NOT EXISTS (SELECT 1 FROM public.categories WHERE slug = 'alimentari' AND parent_id IS NULL);

DO $$
DECLARE
  v_cat uuid;
  v_seller uuid;
  v_passato boolean := false;
BEGIN
  SELECT id INTO v_cat FROM public.categories WHERE slug = 'alimentari' AND parent_id IS NULL LIMIT 1;
  SELECT id INTO v_seller FROM public.profiles LIMIT 1;
  IF v_cat IS NULL OR v_seller IS NULL THEN
    RAISE EXCEPTION 'NON PROVATO: manca la categoria alimentari o un profilo';
  END IF;

  BEGIN
    INSERT INTO public.products (seller_id, name, description, price, stock, category_id, attributes, status)
    VALUES (v_seller, 'Prova 195', 'x', 1, 1, v_cat, '{"allergeni":"Glutine"}'::jsonb, 'available');
    v_passato := true;
  EXCEPTION WHEN check_violation THEN
    v_passato := false;
  END;
  IF v_passato THEN
    RAISE EXCEPTION 'FAIL: alimento senza ingredienti messo in vendita';
  END IF;

  -- La bozza resta libera.
  INSERT INTO public.products (seller_id, name, description, price, stock, category_id, attributes, status)
  VALUES (v_seller, 'Prova 195 bozza', 'x', 1, 1, v_cat, '{"allergeni":"Glutine"}'::jsonb, 'draft');

  -- Il rifornimento: un alimento esaurito senza ingredienti NON torna in
  -- vendita da solo quando torna lo stock (trg_auto_republish della 032).
  INSERT INTO public.products (seller_id, name, description, price, stock, category_id, attributes, status)
  VALUES (v_seller, 'Prova 195 esaurito', 'x', 1, 0, v_cat, '{"allergeni":"Glutine"}'::jsonb, 'out_of_stock');
  v_passato := false;
  BEGIN
    UPDATE public.products SET stock = 5 WHERE name = 'Prova 195 esaurito' AND seller_id = v_seller;
    v_passato := true;
  EXCEPTION WHEN check_violation THEN
    v_passato := false;
  END;
  IF v_passato THEN
    RAISE EXCEPTION 'FAIL: alimento senza ingredienti tornato in vendita al rifornimento';
  END IF;

  -- Con allergeni e ingredienti il rifornimento lo rimette in vendita.
  INSERT INTO public.products (seller_id, name, description, price, stock, category_id, attributes, status)
  VALUES (v_seller, 'Prova 195 completo', 'x', 1, 0, v_cat, '{"allergeni":"Glutine","ingredienti":"Farina, acqua"}'::jsonb, 'out_of_stock');
  UPDATE public.products SET stock = 5 WHERE name = 'Prova 195 completo' AND seller_id = v_seller;

  RAISE NOTICE 'PASS: 195 regge';
END $$;

ROLLBACK;

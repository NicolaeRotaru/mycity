-- Prova della migrazione 195: un alimento con gli allergeni ma SENZA ingredienti
-- non deve poter nascere 'available'.
-- Rossa prima della 195 (l'insert passa e la prova solleva FAIL), verde dopo.
-- Gira in una transazione e torna indietro: non lascia dati.
BEGIN;

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

  RAISE NOTICE 'PASS: 195 regge';
END $$;

ROLLBACK;

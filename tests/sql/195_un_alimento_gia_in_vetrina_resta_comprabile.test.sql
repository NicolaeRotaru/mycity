-- Prova del collaudo finale dell'1/11/2026. Un alimento gia' in vendita PRIMA della 195 senza allergeni ne'
-- ingredienti: e' il caso vero di produzione (7 prodotti su 9 in vendita il 1/11/2026).
-- Dopo la 195: il cliente lo compra (reserve_stock, come checkout carta e contrassegno) e il negozio cambia il prezzo.
BEGIN;
SET mycity.allow_profile_write = '1';
INSERT INTO auth.users (id, email, raw_user_meta_data)
SELECT '19600000-0000-0000-0000-000000000001', 'collaudo196@test.it', '{"role":"seller"}'
 WHERE NOT EXISTS (SELECT 1 FROM public.profiles);
INSERT INTO public.categories (name, slug)
SELECT 'Alimentari', 'alimentari'
 WHERE NOT EXISTS (SELECT 1 FROM public.categories WHERE slug = 'alimentari' AND parent_id IS NULL);
-- la riga esisteva gia' quando la 195 non c'era: la inserisco col guardiano spento
ALTER TABLE public.products DISABLE TRIGGER zz_prodotti_alimentari_dichiarazioni;
INSERT INTO public.products (id, seller_id, name, description, price, stock, category_id, attributes, status)
SELECT '19600000-0000-0000-0000-0000000000aa', (SELECT id FROM public.profiles LIMIT 1), 'Focaccia vecchia', 'Focaccia genovese', 3, 10,
       (SELECT id FROM public.categories WHERE slug='alimentari' AND parent_id IS NULL LIMIT 1),
       '{}'::jsonb, 'available';
ALTER TABLE public.products ENABLE TRIGGER zz_prodotti_alimentari_dichiarazioni;
DO $$
DECLARE ok boolean; rotto text := '';
BEGIN
  BEGIN
    PERFORM public.reserve_stock('[{"product_id":"19600000-0000-0000-0000-0000000000aa","qty":1}]'::jsonb);
    ok := true;
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'CHECKOUT ROTTO: reserve_stock su un alimento in vetrina -> %', SQLERRM; ok := false;
  END;
  IF ok THEN RAISE NOTICE 'checkout ok: reserve_stock passa'; END IF;
  BEGIN
    UPDATE public.products SET price = 3.5 WHERE id = '19600000-0000-0000-0000-0000000000aa';
    RAISE NOTICE 'cambio prezzo ok';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'CAMBIO PREZZO ROTTO -> %', SQLERRM; rotto := rotto || ' prezzo';
  END;
  BEGIN
    PERFORM public.restore_stock('[{"product_id":"19600000-0000-0000-0000-0000000000aa","qty":1}]'::jsonb);
    RAISE NOTICE 'restituzione merce (annullo) ok';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'ANNULLO ROTTO: restore_stock -> %', SQLERRM; rotto := rotto || ' annullo';
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL: un alimento ancora in vetrina non si puo comprare dopo la 195'; END IF;
  IF rotto <> '' THEN RAISE EXCEPTION 'FAIL: dopo la 195 un alimento in vetrina non regge:%', rotto; END IF;
  RAISE NOTICE 'PASS: un alimento gia in vetrina resta comprabile, annullabile e col prezzo modificabile';
END $$;
ROLLBACK;

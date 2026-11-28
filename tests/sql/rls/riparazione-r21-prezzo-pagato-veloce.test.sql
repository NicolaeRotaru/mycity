-- =============================================================================
-- Il prezzo che si paga resta veloce con un catalogo grande (20.000 prodotti)
-- =============================================================================
--   tests/sql/harness/apply.sh mycity_test && psql -d mycity_test -f <questo file>
--
-- La griglia ordina e taglia su `prezzo_pagato` (migrazione 911). La prima versione era una funzione
-- con SET search_path e una sotto-ricerca: Postgres non la srotolava e, da anon, con 20.000 prodotti
-- «minimo 10 € e prezzo crescente» durava 4-5 s, oltre il limite di 3 s di anon (errore 57014).
-- Qui:
-- ① `prezzo_pagato` si srotola nella query: nel piano non compare più come funzione chiamata
-- ② da anon, 20.000 prodotti di 40 negozi con promozioni di negozio, di categoria e di elenco,
--    «minimo 10 € e prezzo crescente» (24 righe) finisce sotto i 3 s
-- ③ lo stesso per «fra 10 e 20 € e prezzo decrescente» (la colonna tre volte nella stessa domanda)
-- ④ il conteggio di «minimo 10 €» finisce sotto i 3 s
-- Il tempo si misura dentro il blocco (clock_timestamp), il migliore di fino a tre giri: senza la cura
-- ② e ③ superano i 3 s a ogni giro.
-- Tutto con ROLLBACK.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon;

INSERT INTO auth.users (id, email, raw_user_meta_data)
SELECT ('e7100000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, 'negozio-veloce-' || g || '@test.it', '{"role":"seller"}'
  FROM generate_series(1, 40) g;

-- Un negozio su cinque è in modalità demo (709): conta anche la regola della vetrina.
UPDATE public.profiles
   SET is_approved = true, approval_status = 'approved', role = 'seller', store_name = 'Bottega grande',
       visibile_senza_abbonamento = (right(id::text, 2)::int % 5 <> 0)
 WHERE id::text LIKE 'e7100000-%';

INSERT INTO public.categories (id, slug, name)
SELECT ('e7300000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, 'r21-veloce-' || g, 'Categoria veloce ' || g
  FROM generate_series(1, 10) g;

INSERT INTO public.products (seller_id, name, description, price, stock, status, images, category_id)
SELECT ('e7100000-0000-0000-0000-' || lpad((1 + g % 40)::text, 12, '0'))::uuid,
       'Prodotto ' || g, 'x', round((1 + (g * 7919 % 6000) / 100.0)::numeric, 2), 5, 'available', '[]'::jsonb,
       ('e7300000-0000-0000-0000-' || lpad((1 + g % 10)::text, 12, '0'))::uuid
  FROM generate_series(1, 20000) g;

INSERT INTO public.seller_promotions (seller_id, title, scope, category_id, discount_percent, status, starts_at, ends_at)
SELECT ('e7100000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, 'Promo ' || g,
       CASE WHEN g % 2 = 0 THEN 'store' ELSE 'category' END,
       CASE WHEN g % 2 = 0 THEN NULL ELSE ('e7300000-0000-0000-0000-' || lpad((1 + g % 10)::text, 12, '0'))::uuid END,
       10 + g, 'active', now() - interval '1 day', now() + interval '7 days'
  FROM generate_series(1, 12) g;

INSERT INTO public.seller_promotions (seller_id, title, scope, product_ids, discount_percent, status, starts_at, ends_at)
SELECT 'e7100000-0000-0000-0000-000000000020', 'Elenco', 'products', array_agg(p.id), 25, 'active',
       now() - interval '1 day', now() + interval '7 days'
  FROM (SELECT id FROM public.products WHERE seller_id = 'e7100000-0000-0000-0000-000000000020' LIMIT 30) p;

ANALYZE public.products;
ANALYZE public.seller_promotions;
ANALYZE public.profiles;

-- 28/11/2026 — LA COPIA LENTA DI CONTROLLO. Il limite di 3 s è quello di anon in produzione, ma la
-- macchina della CI sta proprio su quella soglia: lo stesso commit usciva verde in un giro e rosso
-- nell'altro. Qui nasce una copia di prezzo_pagato NON srotolabile (SET search_path, come la prima
-- versione: il guasto che questa prova deve scoprire). Quando una lettura supera i 3 s, la stessa
-- lettura gira con la copia lenta sulla stessa macchina nello stesso momento: la prova è rossa solo
-- se la lettura sta sopra i 3 s E non è almeno tre volte più veloce della copia lenta. Su una
-- macchina veloce vale il limite di produzione; se la cura sparisce, è rossa ovunque.
DO $c$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.prezzo_pagato(public.products)'::regprocedure);
  d := replace(d, 'FUNCTION public.prezzo_pagato(', 'FUNCTION public.prezzo_pagato_controllo_lento(');
  d := regexp_replace(d, '\s+AS \$function\$', E'\n SET search_path TO ''public''\nAS $function$');
  EXECUTE d;
END $c$;
GRANT EXECUTE ON FUNCTION public.prezzo_pagato_controllo_lento(public.products) TO anon;

DO $$
DECLARE
  riga text;
  piano text := '';
  inizio timestamptz;
  ms numeric;
  migliore numeric;
  lento numeric;
  tempi text;
  giro int;
  n bigint;
BEGIN
  -- ① Il piano non chiama prezzo_pagato: la funzione è srotolata nell'espressione.
  FOR riga IN EXECUTE 'EXPLAIN (VERBOSE) SELECT p.id FROM public.products p ORDER BY public.prezzo_pagato(p) LIMIT 24' LOOP
    piano := piano || riga || E'\n';
  END LOOP;
  INSERT INTO esiti VALUES ('① prezzo_pagato si srotola nella query', position('prezzo_pagato(' in piano) = 0,
    CASE WHEN position('prezzo_pagato(' in piano) = 0 THEN 'srotolata' ELSE 'chiamata riga per riga' END);

  PERFORM set_config('request.jwt.claims', '', true);
  SET LOCAL ROLE anon;

  -- ② minimo 10 € e prezzo crescente, la domanda della griglia
  -- 28/11/2026 — Ogni domanda gira fino a tre volte e conta la più veloce: sulle macchine condivise
  -- della CI un giro solo poteva sforare per il rumore della macchina (rosso a caso con lo stesso
  -- database). Una domanda lenta davvero sfora tutte e tre le volte: il limite di 3 s resta quello.
  migliore := NULL; tempi := '';
  FOR giro IN 1..3 LOOP
    inizio := clock_timestamp();
    PERFORM p.id FROM public.products p
      WHERE p.status = 'available' AND public.prezzo_pagato(p) >= 10
      ORDER BY public.prezzo_pagato(p), p.price, p.id LIMIT 24;
    ms := round(extract(epoch FROM clock_timestamp() - inizio) * 1000);
    tempi := tempi || ms || ' ';
    migliore := least(coalesce(migliore, ms), ms);
    EXIT WHEN migliore < 3000;
  END LOOP;
  lento := NULL;
  IF migliore >= 3000 THEN
    inizio := clock_timestamp();
    PERFORM p.id FROM public.products p
      WHERE p.status = 'available' AND public.prezzo_pagato_controllo_lento(p) >= 10
      ORDER BY public.prezzo_pagato_controllo_lento(p), p.price, p.id LIMIT 24;
    lento := round(extract(epoch FROM clock_timestamp() - inizio) * 1000);
  END IF;
  INSERT INTO esiti VALUES ('② anon, 20.000 prodotti: minimo 10 € e prezzo crescente sotto i 3 s (o 3 volte più veloce della copia lenta)',
    migliore < 3000 OR migliore * 3 <= lento, tempi || 'ms' || coalesce(', copia lenta ' || lento || ' ms', ''));

  -- ③ fra 10 e 20 € e prezzo decrescente (fino a tre giri, come ②)
  migliore := NULL; tempi := '';
  FOR giro IN 1..3 LOOP
    inizio := clock_timestamp();
    PERFORM p.id FROM public.products p
      WHERE p.status = 'available' AND public.prezzo_pagato(p) >= 10 AND public.prezzo_pagato(p) <= 20
      ORDER BY public.prezzo_pagato(p) DESC, p.price DESC, p.id LIMIT 24;
    ms := round(extract(epoch FROM clock_timestamp() - inizio) * 1000);
    tempi := tempi || ms || ' ';
    migliore := least(coalesce(migliore, ms), ms);
    EXIT WHEN migliore < 3000;
  END LOOP;
  lento := NULL;
  IF migliore >= 3000 THEN
    inizio := clock_timestamp();
    PERFORM p.id FROM public.products p
      WHERE p.status = 'available' AND public.prezzo_pagato_controllo_lento(p) >= 10 AND public.prezzo_pagato_controllo_lento(p) <= 20
      ORDER BY public.prezzo_pagato_controllo_lento(p) DESC, p.price DESC, p.id LIMIT 24;
    lento := round(extract(epoch FROM clock_timestamp() - inizio) * 1000);
  END IF;
  INSERT INTO esiti VALUES ('③ anon, 20.000 prodotti: fra 10 e 20 € e prezzo decrescente sotto i 3 s (o 3 volte più veloce della copia lenta)',
    migliore < 3000 OR migliore * 3 <= lento, tempi || 'ms' || coalesce(', copia lenta ' || lento || ' ms', ''));

  -- ④ il conteggio di minimo 10 € (fino a tre giri, come ②)
  migliore := NULL; tempi := '';
  FOR giro IN 1..3 LOOP
    inizio := clock_timestamp();
    SELECT count(*) INTO n FROM public.products p WHERE p.status = 'available' AND public.prezzo_pagato(p) >= 10;
    ms := round(extract(epoch FROM clock_timestamp() - inizio) * 1000);
    tempi := tempi || ms || ' ';
    migliore := least(coalesce(migliore, ms), ms);
    EXIT WHEN migliore < 3000;
  END LOOP;
  lento := NULL;
  IF migliore >= 3000 THEN
    inizio := clock_timestamp();
    PERFORM count(*) FROM public.products p WHERE p.status = 'available' AND public.prezzo_pagato_controllo_lento(p) >= 10;
    lento := round(extract(epoch FROM clock_timestamp() - inizio) * 1000);
  END IF;
  INSERT INTO esiti VALUES ('④ anon, 20.000 prodotti: conteggio di minimo 10 € sotto i 3 s (o 3 volte più veloce della copia lenta)',
    (migliore < 3000 OR migliore * 3 <= lento) AND n > 0, tempi || 'ms, ' || n || ' prodotti' || coalesce(', copia lenta ' || lento || ' ms', ''));

  RESET ROLE;
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

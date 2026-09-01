-- =============================================================================
-- «Ordina per prezzo» non fa scorrere tutto il catalogo
-- =============================================================================
-- Gira contro un database ricostruito dalle migrazioni vere:
--   tests/sql/harness/apply.sh mycity_test
--   tests/sql/harness/run.sh   mycity_test
--
-- PERCHE' ESISTE QUESTO FILE.
--
-- 27/8/2026 (R074) — Il sito offre «ordina per prezzo» e i filtri prezzo minimo
-- e massimo su ogni griglia di prodotti: home, categorie, vetrina del negozio,
-- risultati di ricerca. Su `products` c'erano nove indici e nessuno conteneva
-- il prezzo. Il piano di esecuzione era: leggi tutto il catalogo, ordinalo
-- tutto in memoria, tieni le prime ventiquattro righe.
--
-- Finche' i prodotti sono qualche migliaio non si vede. Il conto arriva quando
-- il catalogo diventa interessante — un supermercato che importa il listino —
-- ed e' processore che si paga a consumo.
--
-- COSA CONTROLLA. Mette dentro ventimila prodotti veri, aggiorna le statistiche
-- e poi CHIEDE AL DATABASE come ha intenzione di rispondere. Se nel piano
-- compare «Seq Scan on products», l'indice non c'e' o non serve, e questo file
-- diventa rosso. Una ricerca del nome dell'indice nel catalogo non basterebbe:
-- un indice che esiste ma che il pianificatore non usa non ha riparato niente.
--
-- E' l'unico file della cartella che mette dentro tanti dati: ci mette qualche
-- secondo. Sotto le poche migliaia di righe il pianificatore sceglie di leggere
-- tutto e ha ragione — la differenza si vede solo dove il difetto fa male.
--
-- Tutto in transazione con ROLLBACK: non lascia dati.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';

CREATE TEMP TABLE esiti (nome text, verde boolean, dettaglio text) ON COMMIT DROP;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('cccccccc-0000-0000-0000-00000000000a', 'supermercato@test.it', '{"role":"seller"}');

UPDATE public.profiles
   SET is_approved = true, approval_status = 'approved', store_name = 'Supermercato del Corso'
 WHERE id = 'cccccccc-0000-0000-0000-00000000000a';

INSERT INTO public.categories (id, name, slug)
VALUES ('dddddddd-0000-0000-0000-00000000000e', 'Dispensa', 'dispensa-prova')
ON CONFLICT DO NOTHING;

-- Un listino importato: ventimila articoli, un quarto dentro la categoria.
INSERT INTO public.products (name, description, price, seller_id, status, stock, category_id)
SELECT 'Articolo ' || g,
       'Riga di listino importata',
       (g % 5000)::numeric / 100 + 0.50,
       'cccccccc-0000-0000-0000-00000000000a',
       'available',
       10,
       CASE WHEN g % 4 = 0 THEN 'dddddddd-0000-0000-0000-00000000000e'::uuid ELSE NULL END
  FROM generate_series(1, 20000) g;

ANALYZE public.products;

-- Aiuto: restituisce il piano di esecuzione come una riga di testo sola.
CREATE OR REPLACE FUNCTION pg_temp.piano(p_sql text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE riga text; tutto text := '';
BEGIN
  FOR riga IN EXECUTE 'EXPLAIN (COSTS OFF) ' || p_sql LOOP
    tutto := tutto || riga || ' | ';
  END LOOP;
  RETURN tutto;
END $$;

-- ── ① «Ordina per prezzo» sulla griglia di tutto il catalogo ──────────────
DO $$
DECLARE p text;
BEGIN
  p := pg_temp.piano($q$
    SELECT id, name, price FROM public.products
     WHERE status = 'available' ORDER BY price ASC LIMIT 24
  $q$);
  INSERT INTO esiti VALUES (
    'ordinare per prezzo non fa leggere tutto il catalogo',
    p LIKE '%products_status_price_idx%' AND p NOT LIKE '%Seq Scan on products%',
    'piano: ' || p
  );
END $$;

-- ── ② I filtri «da … a …» sul prezzo ─────────────────────────────────────
DO $$
DECLARE p text;
BEGIN
  p := pg_temp.piano($q$
    SELECT id, name, price FROM public.products
     WHERE status = 'available' AND price >= 10 AND price <= 20
     ORDER BY price ASC LIMIT 24
  $q$);
  INSERT INTO esiti VALUES (
    'il filtro sul prezzo minimo e massimo passa dall''indice',
    p LIKE '%products_status_price_idx%' AND p NOT LIKE '%Seq Scan on products%',
    'piano: ' || p
  );
END $$;

-- ── ③ «Dal piu caro» dentro una categoria ────────────────────────────────
DO $$
DECLARE p text;
BEGIN
  p := pg_temp.piano($q$
    SELECT id, name, price FROM public.products
     WHERE status = 'available' AND category_id = 'dddddddd-0000-0000-0000-00000000000e'
     ORDER BY price DESC LIMIT 24
  $q$);
  INSERT INTO esiti VALUES (
    'ordinare per prezzo dentro una categoria passa dall''indice',
    p LIKE '%products_category_price_idx%' AND p NOT LIKE '%Seq Scan on products%',
    'piano: ' || p
  );
END $$;

-- ── ④ E lo stesso con gli occhi di un visitatore senza account ───────────
--    E' il caso vero: la griglia la guarda quasi sempre chi non ha fatto
--    l'accesso, e con la regola di lettura accesa il piano cambia.
DO $$
DECLARE p text;
BEGIN
  SET LOCAL ROLE anon;
  p := pg_temp.piano($q$
    SELECT id, name, price FROM public.products
     WHERE status = 'available' ORDER BY price ASC LIMIT 24
  $q$);
  RESET ROLE;
  INSERT INTO esiti VALUES (
    'anche per un visitatore senza account l''indice viene usato',
    p LIKE '%products_status_price_idx%' AND p NOT LIKE '%Seq Scan on products%',
    'piano: ' || p
  );
END $$;

-- ── Verdetto ──────────────────────────────────────────────────────────────
SELECT nome, CASE WHEN verde THEN 'ok' ELSE 'ROTTO' END AS esito, dettaglio
  FROM esiti ORDER BY nome;

DO $$
DECLARE rossi int; elenco text;
BEGIN
  SELECT count(*), coalesce(string_agg(format('%s → %s', e.nome, e.dettaglio), E'\n  '), '')
    INTO rossi, elenco
  FROM esiti e WHERE e.verde IS NOT TRUE;

  IF rossi > 0 THEN
    RAISE EXCEPTION E'% controllo/i rosso/i sull''ordinamento per prezzo:\n  %', rossi, elenco;
  END IF;
  RAISE NOTICE 'ordinare per prezzo passa dall''indice: % controlli verdi', (SELECT count(*) FROM esiti);
END $$;

ROLLBACK;

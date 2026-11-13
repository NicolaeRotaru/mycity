-- =============================================================================
-- R13-004 — «ESCLUSO DAL RECESSO» SOLO SUGLI ALIMENTI (migrazione 373).
-- =============================================================================
-- La spunta products.non_recedibile (migrazione 180) era un interruttore
-- libero: una merceria poteva toglierla a un maglione, e il cliente si vedeva
-- rifiutare il ripensamento «per legge». Qui si prova ogni strada che la
-- accende: un prodotto nuovo, la spunta accesa dopo, la categoria cambiata.
-- Togli la migrazione 373 e la prova torna rossa.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('13004000-0000-0000-0000-000000000001', 'merceria-r13@test.it', '{"role":"seller"}');
UPDATE public.profiles
   SET is_approved = true, approval_status = 'approved', store_name = 'Merceria R13', role = 'seller'
 WHERE id = '13004000-0000-0000-0000-000000000001';

-- Le categorie vere, se ci sono; se no se ne crea una di ognuna.
DO $$
DECLARE v_alimentari uuid; v_sotto uuid; v_altra uuid;
BEGIN
  SELECT id INTO v_alimentari FROM public.categories WHERE slug = 'alimentari' AND parent_id IS NULL;
  IF v_alimentari IS NULL THEN
    INSERT INTO public.categories (id, slug, name, parent_id, richiede_dichiarazioni_alimentari)
    VALUES ('c1300400-0000-0000-0000-000000000001', 'alimentari', 'Alimentari', NULL, true)
    RETURNING id INTO v_alimentari;
  END IF;
  SELECT id INTO v_sotto FROM public.categories WHERE parent_id = v_alimentari LIMIT 1;
  IF v_sotto IS NULL THEN
    INSERT INTO public.categories (id, slug, name, parent_id)
    VALUES ('c1300400-0000-0000-0000-000000000002', 'dolci-r13', 'Dolci', v_alimentari)
    RETURNING id INTO v_sotto;
  END IF;
  SELECT id INTO v_altra FROM public.categories
   WHERE parent_id IS NULL AND NOT public.radice_con_obbligo_alimentare(id) LIMIT 1;
  IF v_altra IS NULL THEN
    INSERT INTO public.categories (id, slug, name, parent_id)
    VALUES ('c1300400-0000-0000-0000-000000000003', 'abbigliamento-r13', 'Abbigliamento', NULL)
    RETURNING id INTO v_altra;
  END IF;
  CREATE TEMP TABLE categorie_prova ON COMMIT DROP AS
    SELECT v_sotto AS dolci, v_altra AS vestiti;
END $$;

CREATE FUNCTION pg_temp.prova(nome text, comando text, deve_passare boolean) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE passato boolean := true; codice text := '—';
BEGIN
  BEGIN
    EXECUTE comando;
  EXCEPTION WHEN OTHERS THEN
    passato := false;
    codice := SQLSTATE;
  END;
  INSERT INTO esiti VALUES (nome,
    CASE WHEN deve_passare THEN passato ELSE (NOT passato AND codice = '23514') END,
    format('passato=%s codice=%s', passato, codice));
END $$;

-- ① Un maglione nuovo, già segnato «escluso dal recesso»: rifiutato.
SELECT pg_temp.prova('un maglione nuovo non nasce escluso dal recesso', format(
  $q$INSERT INTO public.products (id, seller_id, category_id, name, price, status, non_recedibile)
     VALUES ('d1300400-0000-0000-0000-000000000001', '13004000-0000-0000-0000-000000000001', %L, 'Maglione', 60, 'draft', true)$q$,
  (SELECT vestiti FROM categorie_prova)), false);

-- ② La torta su ordinazione, sotto gli alimentari: passa.
SELECT pg_temp.prova('la torta (alimentare) si segna esclusa', format(
  $q$INSERT INTO public.products (id, seller_id, category_id, name, price, status, non_recedibile)
     VALUES ('d1300400-0000-0000-0000-000000000002', '13004000-0000-0000-0000-000000000001', %L, 'Torta di compleanno', 24, 'draft', true)$q$,
  (SELECT dolci FROM categorie_prova)), true);

-- ③ Un maglione senza spunta si salva; accenderla dopo è rifiutato, anche dal server.
SELECT pg_temp.prova('un maglione senza spunta si salva', format(
  $q$INSERT INTO public.products (id, seller_id, category_id, name, price, status)
     VALUES ('d1300400-0000-0000-0000-000000000003', '13004000-0000-0000-0000-000000000001', %L, 'Sciarpa', 25, 'draft')$q$,
  (SELECT vestiti FROM categorie_prova)), true);
SELECT pg_temp.prova('la spunta accesa dopo sul maglione è rifiutata',
  $q$UPDATE public.products SET non_recedibile = true WHERE id = 'd1300400-0000-0000-0000-000000000003'$q$, false);

-- ④ La torta segnata spostata fra i vestiti, con la spunta: rifiutata.
SELECT pg_temp.prova('la torta segnata non si sposta fra i vestiti con la spunta', format(
  $q$UPDATE public.products SET category_id = %L WHERE id = 'd1300400-0000-0000-0000-000000000002'$q$,
  (SELECT vestiti FROM categorie_prova)), false);

-- ⑤ Sulla torta segnata la scorta cambia come sempre, e togliere la spunta passa sempre.
SELECT pg_temp.prova('la scorta della torta segnata cambia',
  $q$UPDATE public.products SET stock = 4, non_recedibile = true WHERE id = 'd1300400-0000-0000-0000-000000000002'$q$, true);
SELECT pg_temp.prova('togliere la spunta passa sempre', format(
  $q$UPDATE public.products SET non_recedibile = false, category_id = %L WHERE id = 'd1300400-0000-0000-0000-000000000002'$q$,
  (SELECT vestiti FROM categorie_prova)), true);

-- Verdetto
DO $$
DECLARE rossi int; elenco text;
BEGIN
  SELECT count(*), coalesce(string_agg(format('%s → %s', e.nome, e.dettaglio), E'\n  '), '')
    INTO rossi, elenco
  FROM esiti e WHERE e.ok IS NOT TRUE;
  IF rossi > 0 THEN
    RAISE EXCEPTION E'% controllo/i rosso/i:\n  %', rossi, elenco;
  END IF;
  RAISE NOTICE 'l esclusione dal recesso sta sugli alimenti: % controlli verdi', (SELECT count(*) FROM esiti);
END $$;

ROLLBACK;

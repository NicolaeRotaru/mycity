-- =============================================================================
-- R12-023 — L'obbligo di allergeni e ingredienti segue la categoria, non il nome
-- =============================================================================
--   tests/sql/harness/apply.sh mycity_test && tests/sql/harness/run.sh mycity_test
--
-- Il guardiano dei prodotti (195) controllava solo la radice di nome
-- 'alimentari'. Qui:
--   ① una radice nuova «Gastronomia» con l'obbligo: il pane senza dichiarazioni
--      NON si pubblica;
--   ② una radice senza l'obbligo (libri) resta libera;
--   ③ lo slug di 'alimentari' non si cambia piu' dal pannello;
--   ④ l'obbligo non si spegne con un UPDATE.
-- Senza la migrazione 363 la colonna non esiste: ROSSO.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('e1230000-0000-0000-0000-000000000001', 'fornaio-r12a@test.it', '{"role":"seller"}');
UPDATE public.profiles SET is_approved = true, approval_status = 'approved', store_name = 'Forno R12'
 WHERE id = 'e1230000-0000-0000-0000-000000000001';

INSERT INTO public.categories (id, name, slug, richiede_dichiarazioni_alimentari) VALUES
  ('e1230000-0000-0000-0000-0000000000c1', 'Gastronomia R12', 'gastronomia-r12', true),
  ('e1230000-0000-0000-0000-0000000000c3', 'Fumetti R12', 'fumetti-r12', false);
INSERT INTO public.categories (id, name, slug, parent_id) VALUES
  ('e1230000-0000-0000-0000-0000000000c2', 'Pane R12', 'pane-r12', 'e1230000-0000-0000-0000-0000000000c1');

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;

DO $$
DECLARE v_passato boolean;
BEGIN
  -- ① il pane sotto «Gastronomia», senza allergeni
  BEGIN
    INSERT INTO public.products (seller_id, name, description, price, stock, category_id, attributes, status)
    VALUES ('e1230000-0000-0000-0000-000000000001', 'Pane R12', 'x', 2, 5,
            'e1230000-0000-0000-0000-0000000000c2', '{}'::jsonb, 'available');
    v_passato := true;
  EXCEPTION WHEN check_violation THEN v_passato := false;
  END;
  INSERT INTO esiti VALUES ('1 sotto una radice nuova con l obbligo il pane senza allergeni non si pubblica', NOT v_passato, '');

  -- ①b con le dichiarazioni si pubblica
  BEGIN
    INSERT INTO public.products (seller_id, name, description, price, stock, category_id, attributes, status)
    VALUES ('e1230000-0000-0000-0000-000000000001', 'Pane R12 completo', 'x', 2, 5,
            'e1230000-0000-0000-0000-0000000000c2',
            '{"allergeni":"Glutine","ingredienti":"Farina, acqua, sale"}'::jsonb, 'available');
    v_passato := true;
  EXCEPTION WHEN check_violation THEN v_passato := false;
  END;
  INSERT INTO esiti VALUES ('1b con allergeni e ingredienti si pubblica', v_passato, '');

  -- ② una radice senza l'obbligo
  BEGIN
    INSERT INTO public.products (seller_id, name, description, price, stock, category_id, attributes, status)
    VALUES ('e1230000-0000-0000-0000-000000000001', 'Fumetto R12', 'x', 5, 1,
            'e1230000-0000-0000-0000-0000000000c3', '{}'::jsonb, 'available');
    v_passato := true;
  EXCEPTION WHEN check_violation THEN v_passato := false;
  END;
  INSERT INTO esiti VALUES ('2 una radice senza l obbligo resta libera', v_passato, '');

  -- ③ lo slug di 'alimentari'
  BEGIN
    UPDATE public.categories SET slug = 'spesa-fresca' WHERE slug = 'alimentari' AND parent_id IS NULL;
    v_passato := FOUND;
  EXCEPTION WHEN check_violation THEN v_passato := false;
  END;
  INSERT INTO esiti VALUES ('3 lo slug di alimentari non si cambia', NOT v_passato, '');

  -- ④ l'obbligo non si spegne
  BEGIN
    UPDATE public.categories SET richiede_dichiarazioni_alimentari = false
     WHERE id = 'e1230000-0000-0000-0000-0000000000c1';
    v_passato := FOUND;
  EXCEPTION WHEN check_violation THEN v_passato := false;
  END;
  INSERT INTO esiti VALUES ('4 l obbligo non si toglie con un update', NOT v_passato, '');

  -- ⑥ una sottocategoria spostata fuori dalla radice con l'obbligo
  BEGIN
    UPDATE public.categories SET parent_id = 'e1230000-0000-0000-0000-0000000000c3'
     WHERE id = 'e1230000-0000-0000-0000-0000000000c2';
    v_passato := FOUND;
  EXCEPTION WHEN check_violation THEN v_passato := false;
  END;
  INSERT INTO esiti VALUES ('6 il pane non esce da sotto la radice con l obbligo', NOT v_passato, '');

  -- ⑦ la radice con l'obbligo non si cancella
  BEGIN
    DELETE FROM public.categories WHERE id = 'e1230000-0000-0000-0000-0000000000c1';
    v_passato := FOUND;
  EXCEPTION WHEN check_violation OR foreign_key_violation THEN v_passato := false;
  END;
  INSERT INTO esiti VALUES ('7 la radice con l obbligo non si cancella', NOT v_passato, '');

  -- ⑧ le modifiche normali passano (nome della categoria)
  BEGIN
    UPDATE public.categories SET name = 'Gastronomia R12 rinominata' WHERE id = 'e1230000-0000-0000-0000-0000000000c1';
    v_passato := FOUND;
  EXCEPTION WHEN check_violation THEN v_passato := false;
  END;
  INSERT INTO esiti VALUES ('8 cambiare il nome resta libero', v_passato, '');

  -- ⑤ alimentari nasce con l'obbligo
  INSERT INTO esiti
  SELECT '5 la radice alimentari ha l obbligo', coalesce(bool_and(richiede_dichiarazioni_alimentari), false), count(*)::text
    FROM public.categories WHERE slug = 'alimentari' AND parent_id IS NULL;
END $$;

SELECT nome, CASE WHEN ok THEN 'ok' ELSE 'ROTTO' END AS esito, dettaglio FROM esiti ORDER BY nome;

DO $$
DECLARE rossi int; elenco text;
BEGIN
  SELECT count(*), coalesce(string_agg(format('%s → %s', e.nome, e.dettaglio), E'\n  '), '')
    INTO rossi, elenco FROM esiti e WHERE e.ok IS NOT TRUE;
  IF rossi > 0 THEN
    RAISE EXCEPTION E'% controllo/i rosso/i sugli allergeni per categoria:\n  %', rossi, elenco;
  END IF;
  RAISE NOTICE 'l obbligo degli allergeni segue la categoria: % controlli verdi', (SELECT count(*) FROM esiti);
END $$;

ROLLBACK;

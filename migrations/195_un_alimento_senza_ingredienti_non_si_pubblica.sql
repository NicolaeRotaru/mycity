-- ═══════════════════════════════════════════════════════════════════════════
-- 195 · Un alimento senza ingredienti non si pubblica (come senza allergeni)
-- ═══════════════════════════════════════════════════════════════════════════
-- Il guardiano della 126 (alimentare_senza_allergeni_non_si_pubblica) legge solo
-- attributes->>'allergeni'. Il modulo pretende anche gli Ingredienti
-- (lib/category-attributes.ts, required: true), ma e' un controllo del browser:
-- un insert diretto (caricamento da file, API) poteva mettere in vendita un
-- alimento con gli allergeni e senza ingredienti. Reg. UE 1169/2011 art. 9:
-- l'elenco degli ingredienti e' obbligatorio anche nella vendita a distanza.
--
-- La 126 non si tocca: qui si RIDEFINISCE la stessa funzione (stesso nome,
-- stesso trigger), con allergeni E ingredienti. Le bozze restano libere.
--
-- DA FIRMARE DA NICOLA prima di applicarla in produzione (rosso).
-- Prima di applicarla: controllare quanti alimenti 'available' sono gia' senza
-- ingredienti (il trigger scatta solo su INSERT/UPDATE, quelli esistenti restano
-- comprabili finche' non si modificano):
--   SELECT p.id, p.name FROM products p JOIN categories c ON c.id = p.category_id
--    WHERE p.status = 'available'
--      AND btrim(coalesce(p.attributes->>'ingredienti','')) = '';
--
-- Prova: tests/sql/195_un_alimento_senza_ingredienti_non_si_pubblica.test.sql
-- (rossa prima della 195, verde dopo).
--
-- RITORNO INDIETRO (ripristina il guardiano della 126, solo allergeni):
--   esegui di nuovo il blocco CREATE OR REPLACE FUNCTION
--   public.alimentare_senza_allergeni_non_si_pubblica() della
--   migrations/126_radiografia_22_agosto.sql (righe 501-536). Il trigger
--   prodotti_alimentari_allergeni non cambia e non va ricreato.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.alimentare_senza_allergeni_non_si_pubblica()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_radice text;
  v_allergeni text;
  v_ingredienti text;
BEGIN
  -- Solo i prodotti comprabili. Bozze e archiviati passano.
  IF NEW.status IS DISTINCT FROM 'available' THEN
    RETURN NEW;
  END IF;
  IF NEW.category_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- La categoria di primo livello: le sottocategorie ereditano dal padre.
  WITH RECURSIVE risali AS (
    SELECT id, parent_id, slug FROM public.categories WHERE id = NEW.category_id
    UNION ALL
    SELECT c.id, c.parent_id, c.slug
      FROM public.categories c JOIN risali r ON c.id = r.parent_id
  )
  SELECT slug INTO v_radice FROM risali WHERE parent_id IS NULL LIMIT 1;

  IF v_radice IS DISTINCT FROM 'alimentari' THEN
    RETURN NEW;
  END IF;

  v_allergeni := btrim(coalesce(NEW.attributes ->> 'allergeni', ''));
  IF v_allergeni = '' THEN
    RAISE EXCEPTION 'Un prodotto alimentare non si puo pubblicare senza dichiarare gli allergeni. Se non ne contiene nessuno, scrivi «Nessuno dei 14 allergeni».'
      USING ERRCODE = '23514';
  END IF;

  v_ingredienti := btrim(coalesce(NEW.attributes ->> 'ingredienti', ''));
  IF v_ingredienti = '' THEN
    RAISE EXCEPTION 'Un prodotto alimentare non si puo pubblicare senza la lista degli ingredienti. Salvalo come bozza e completala dal prodotto.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END$$;

COMMENT ON FUNCTION public.alimentare_senza_allergeni_non_si_pubblica() IS
  'Reg. UE 1169/2011: allergeni e ingredienti devono esserci prima dell acquisto, anche a distanza (dalla 195 anche gli ingredienti).';

REVOKE ALL ON FUNCTION public.alimentare_senza_allergeni_non_si_pubblica() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';

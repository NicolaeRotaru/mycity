-- 363_l_obbligo_degli_allergeni_e_una_proprieta_della_categoria.sql
--
-- 12/11/2026 (R12-023) — L'OBBLIGO DI DICHIARARE ALLERGENI E INGREDIENTI VALEVA
-- SOLO FINCHE' LA CATEGORIA PRINCIPALE SI CHIAMAVA ESATTAMENTE «alimentari».
--
-- Il guardiano del database (195) e il modulo del negozio
-- (lib/category-attributes.ts) sceglievano i campi obbligatori dal nome
-- tecnico (slug) della categoria di primo livello. Il pannello lascia
-- cambiare lo slug e creare radici nuove: per allargare l'albero come chiede
-- il fatto catalogo.categorie (spesa fresca, gastronomia, pasta fresca)
-- bastava una radice «gastronomia» o rinominare «alimentari», e il pane
-- tornava in vendita senza allergeni ne' ingredienti (Reg. UE 1169/2011).
--
-- Da qui:
--   ① l'obbligo e' una colonna della categoria:
--      categories.richiede_dichiarazioni_alimentari (vera per 'alimentari');
--   ② il guardiano dei prodotti legge la colonna della radice (il nome resta
--      come rete);
--   ③ una categoria con l'obbligo non cambia slug e non perde l'obbligo dal
--      pannello: per toglierlo serve una migrazione, cioe' una decisione scritta.
-- Il sito non dipende da questa migrazione: senza la colonna il modulo usa il
-- nome, come prima.
-- Non si applica da sola: la applica Nicola.

ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS richiede_dichiarazioni_alimentari boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.categories.richiede_dichiarazioni_alimentari IS
  'R12-023: i prodotti sotto questa radice si pubblicano solo con allergeni e ingredienti (Reg. UE 1169/2011). Letta dal guardiano dei prodotti e dal modulo del negozio.';

UPDATE public.categories
   SET richiede_dichiarazioni_alimentari = true
 WHERE slug = 'alimentari' AND parent_id IS NULL;

CREATE OR REPLACE FUNCTION public.alimento_senza_dichiarazioni_non_si_pubblica()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_radice text;
  v_obbligo boolean;
  v_allergeni text;
  v_ingredienti text;
  v_pubblica boolean := true;
  v_cambia boolean := true;
  v_manca text;
BEGIN
  -- Solo i prodotti comprabili. Bozze e archiviati passano.
  IF NEW.status IS DISTINCT FROM 'available' THEN
    RETURN NEW;
  END IF;

  -- Su un UPDATE si controlla solo quando il prodotto DIVENTA comprabile o
  -- cambiano le sue dichiarazioni o la categoria. Mai sulla giacenza o sul
  -- prezzo di un prodotto che resta in vetrina: un alimento gia' in vendita
  -- prima della 195 deve restare comprabile (reserve_stock), annullabile
  -- (restore_stock, cancel_order) e modificabile nel prezzo.
  IF TG_OP = 'UPDATE' THEN
    v_pubblica := OLD.status IS DISTINCT FROM 'available';
    v_cambia := NEW.attributes IS DISTINCT FROM OLD.attributes
             OR NEW.category_id IS DISTINCT FROM OLD.category_id;
    IF NOT v_pubblica AND NOT v_cambia THEN
      RETURN NEW;
    END IF;
  END IF;
  IF NEW.category_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- La categoria di primo livello: le sottocategorie ereditano dal padre.
  -- 363 (R12-023): l'obbligo e' una proprieta' della categoria, non il nome della
  -- radice. Vale se la porta la categoria o uno qualunque dei suoi padri (collaudo
  -- K03: «alimentari» spostata sotto un'altra radice non deve perderlo). Il nome
  -- 'alimentari' resta come rete per una riga nata prima della colonna.
  WITH RECURSIVE risali AS (
    SELECT id, parent_id, slug, richiede_dichiarazioni_alimentari FROM public.categories WHERE id = NEW.category_id
    UNION ALL
    SELECT c.id, c.parent_id, c.slug, c.richiede_dichiarazioni_alimentari
      FROM public.categories c JOIN risali r ON c.id = r.parent_id
  )
  SELECT (array_agg(slug) FILTER (WHERE parent_id IS NULL))[1],
         coalesce(bool_or(richiede_dichiarazioni_alimentari), false)
    INTO v_radice, v_obbligo
    FROM risali;

  IF NOT v_obbligo AND v_radice IS DISTINCT FROM 'alimentari' THEN
    RETURN NEW;
  END IF;

  v_allergeni := btrim(coalesce(NEW.attributes ->> 'allergeni', ''));
  v_ingredienti := btrim(coalesce(NEW.attributes ->> 'ingredienti', ''));
  IF v_allergeni = '' THEN
    v_manca := 'Un prodotto alimentare non si puo pubblicare senza dichiarare gli allergeni. Se non ne contiene nessuno, scrivi «Nessuno dei 14 allergeni».';
  ELSIF v_ingredienti = '' THEN
    v_manca := 'Un prodotto alimentare non si puo pubblicare senza la lista degli ingredienti. Salvalo come bozza e completala dal prodotto.';
  END IF;
  IF v_manca IS NULL THEN
    RETURN NEW;
  END IF;

  -- La merce che torna a scaffale (annullo di un ordine, rifornimento): la
  -- ripubblicazione automatica (trg_auto_republish, 032) lo rimetterebbe in
  -- vendita. Qui non si blocca il movimento di magazzino, che deve riuscire
  -- (altrimenti l'ordine non si annulla): il prodotto resta dov'era, fuori
  -- vendita, finche' il negozio non completa le dichiarazioni.
  IF TG_OP = 'UPDATE' AND v_pubblica AND NOT v_cambia
     AND NEW.stock IS DISTINCT FROM OLD.stock THEN
    NEW.status := OLD.status;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION '%', v_manca USING ERRCODE = '23514';
END$$;

COMMENT ON FUNCTION public.alimento_senza_dichiarazioni_non_si_pubblica() IS
  'Reg. UE 1169/2011: allergeni e ingredienti devono esserci prima dell acquisto, anche a distanza. Dalla 363 vale per ogni radice con richiede_dichiarazioni_alimentari.';

-- La radice di una categoria e se ha l'obbligo (risale i padri).
CREATE OR REPLACE FUNCTION public.radice_con_obbligo_alimentare(p_categoria uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path = public AS $$
  WITH RECURSIVE risali AS (
    SELECT id, parent_id, richiede_dichiarazioni_alimentari FROM public.categories WHERE id = p_categoria
    UNION ALL
    SELECT c.id, c.parent_id, c.richiede_dichiarazioni_alimentari
      FROM public.categories c JOIN risali r ON c.id = r.parent_id
  )
  SELECT coalesce(bool_or(richiede_dichiarazioni_alimentari), false) FROM risali;
$$;

-- Collaudo del 12/11: oltre a slug e obbligo, anche lo spostamento e la
-- cancellazione toglievano l'obbligo (il pane spostato sotto una radice senza
-- obbligo si pubblicava senza allergeni). Da qui una categoria che sta sotto
-- una radice con l'obbligo non esce da quella radice, e una categoria con
-- l'obbligo non si cancella.
CREATE OR REPLACE FUNCTION public.categoria_alimentare_non_si_spegne()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.richiede_dichiarazioni_alimentari THEN
      RAISE EXCEPTION 'La categoria «%» non si cancella: da lei dipende l''obbligo di allergeni e ingredienti.', OLD.name
        USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.richiede_dichiarazioni_alimentari THEN
    IF NEW.slug IS DISTINCT FROM OLD.slug THEN
      RAISE EXCEPTION 'Lo slug di «%» non si cambia: da questa categoria dipende l''obbligo di allergeni e ingredienti.', OLD.name
        USING ERRCODE = '23514';
    END IF;
    IF NOT NEW.richiede_dichiarazioni_alimentari THEN
      RAISE EXCEPTION 'L''obbligo di allergeni e ingredienti di «%» non si toglie dal pannello.', OLD.name
        USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.parent_id IS DISTINCT FROM OLD.parent_id
     AND public.radice_con_obbligo_alimentare(OLD.id)
     AND NOT NEW.richiede_dichiarazioni_alimentari
     AND (NEW.parent_id IS NULL OR NOT public.radice_con_obbligo_alimentare(NEW.parent_id)) THEN
    RAISE EXCEPTION '«%» sta sotto una categoria con l''obbligo di allergeni e ingredienti: non si sposta fuori.', OLD.name
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END$$;

REVOKE ALL ON FUNCTION public.categoria_alimentare_non_si_spegne() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS categoria_alimentare_non_si_spegne ON public.categories;
CREATE TRIGGER categoria_alimentare_non_si_spegne
  BEFORE UPDATE OR DELETE ON public.categories
  FOR EACH ROW
  EXECUTE FUNCTION public.categoria_alimentare_non_si_spegne();

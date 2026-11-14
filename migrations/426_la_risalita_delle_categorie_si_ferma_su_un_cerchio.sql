-- 426_la_risalita_delle_categorie_si_ferma_su_un_cerchio.sql
--
-- 14/11/2026 (R18-014, giro di correzione) — LA RISALITA DEI GENITORI DELLE
-- CATEGORIE NEL DATABASE NON AVEVA UN TETTO.
--
-- Le due funzioni della 363 (e la vecchia guardia della 126) risalgono i padri
-- di una categoria con una WITH RECURSIVE ... UNION ALL senza nessun controllo: se nei dati c'e' un
-- cerchio (A sotto B e B sotto A, che la chiave esterna su parent_id non
-- impedisce) la query non finisce mai. Il guardiano dei prodotti
-- (zz_prodotti_alimentari_dichiarazioni) gira a ogni salvataggio di un prodotto
-- in vendita, quindi il negozio restava appeso fino al timeout; lo stesso per
-- lo spostamento di una categoria (categoria_alimentare_non_si_spegne chiama
-- radice_con_obbligo_alimentare).
--
-- Da qui le risalite portano la lista dei gia' visti: un passo va solo verso
-- una categoria mai vista, quindi la risalita finisce al piu' dopo tante
-- categorie quante ce ne sono, e un cerchio si chiude al primo ritorno.
-- Nessun tetto di passi: un tetto fisso (20) lasciava pubblicare senza
-- allergeni un prodotto piu' profondo di 21 livelli sotto «alimentari»
-- (verificatore del giro di correzione), cosa che la 363 fermava.
-- Il resto delle funzioni e' copiato senza cambiare niente: stesse regole,
-- stessi messaggi, stessa firma. CREATE OR REPLACE tiene proprietario e
-- permessi (la 425 elenca radice_con_obbligo_alimentare(uuid) fra le funzioni
-- pubbliche). Su un cerchio senza radice vale l'obbligo se lo porta una
-- qualunque categoria del cerchio: nel dubbio si chiede la dichiarazione.
-- Anche la vecchia alimentare_senza_allergeni_non_si_pubblica (126) prende la
-- lista dei gia' visti: oggi nessun trigger la usa, ma il ritorno indietro
-- scritto nella 195 la riaggancia.
--
-- Non si applica da sola: sul database vero la applica Nicola.

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
  -- 426 (R18-014): la risalita tiene la lista dei gia' visti. Senza, un
  -- cerchio nei dati (A sotto B, B sotto A) faceva girare la query per sempre
  -- e il salvataggio del prodotto finiva in timeout.
  WITH RECURSIVE risali AS (
    SELECT id, parent_id, slug, richiede_dichiarazioni_alimentari,
           ARRAY[id] AS visti
      FROM public.categories WHERE id = NEW.category_id
    UNION ALL
    SELECT c.id, c.parent_id, c.slug, c.richiede_dichiarazioni_alimentari,
           r.visti || c.id
      FROM public.categories c JOIN risali r ON c.id = r.parent_id
     WHERE NOT c.id = ANY (r.visti)
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

-- La radice di una categoria e se ha l'obbligo (risale i padri, con la stessa
-- lista dei gia' visti).
CREATE OR REPLACE FUNCTION public.radice_con_obbligo_alimentare(p_categoria uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path = public AS $$
  WITH RECURSIVE risali AS (
    SELECT id, parent_id, richiede_dichiarazioni_alimentari,
           ARRAY[id] AS visti
      FROM public.categories WHERE id = p_categoria
    UNION ALL
    SELECT c.id, c.parent_id, c.richiede_dichiarazioni_alimentari,
           r.visti || c.id
      FROM public.categories c JOIN risali r ON c.id = r.parent_id
     WHERE NOT c.id = ANY (r.visti)
  )
  SELECT coalesce(bool_or(richiede_dichiarazioni_alimentari), false) FROM risali;
$$;

-- La guardia della 126, oggi senza trigger: stessa risalita con la lista dei
-- gia' visti, il resto copiato dalla 126.
CREATE OR REPLACE FUNCTION public.alimentare_senza_allergeni_non_si_pubblica()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_radice text;
  v_allergeni text;
BEGIN
  -- Solo i prodotti comprabili. Bozze e archiviati passano.
  IF NEW.status IS DISTINCT FROM 'available' THEN
    RETURN NEW;
  END IF;
  IF NEW.category_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- La categoria di primo livello: le sottocategorie ereditano dal padre.
  -- 426 (R18-014): con la lista dei gia' visti, un cerchio non la fa girare per sempre.
  WITH RECURSIVE risali AS (
    SELECT id, parent_id, slug, ARRAY[id] AS visti
      FROM public.categories WHERE id = NEW.category_id
    UNION ALL
    SELECT c.id, c.parent_id, c.slug, r.visti || c.id
      FROM public.categories c JOIN risali r ON c.id = r.parent_id
     WHERE NOT c.id = ANY (r.visti)
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

  RETURN NEW;
END$$;

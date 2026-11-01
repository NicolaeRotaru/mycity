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
-- La 126 non si tocca: qui si RIDEFINISCE la stessa funzione (stesso nome),
-- con allergeni E ingredienti. Le bozze restano libere.
--
-- E si RIFA' il trigger, per due buchi trovati al collaudo dell'1/11/2026:
-- ① il trigger della 126 guardava solo UPDATE OF status, attributes,
--   category_id: un rifornimento (UPDATE stock) passava senza controllo;
-- ② i trigger BEFORE scattano in ordine alfabetico: «prodotti_alimentari_…»
--   girava PRIMA di «trg_auto_republish» (032), che rimette 'available' un
--   alimento esaurito o in bozza quando torna lo stock. Il guardiano vedeva
--   ancora lo stato vecchio e lasciava passare.
-- Il trigger nuovo si chiama «zz_prodotti_alimentari_dichiarazioni» (scatta
-- dopo trg_auto_republish) e guarda ogni INSERT e ogni UPDATE, ma su un UPDATE
-- controlla solo quando il prodotto diventa comprabile o cambiano dichiarazioni
-- o categoria (collaudo finale dell'1/11: la prima versione bloccava anche lo
-- scalo della merce e il cambio prezzo di un alimento gia' in vetrina). Se e'
-- la merce che torna a scaffale a ripubblicarlo, il movimento riesce e il
-- prodotto resta fuori vendita. Il DROP del
-- vecchio e il CREATE del nuovo stanno qui, cosi' la 195 regge anche su un
-- database dove la 126 non e' ancora passata.
--
-- DA FIRMARE DA NICOLA prima di applicarla in produzione (rosso).
-- Prima di applicarla: contare gli alimenti gia' in vendita a cui mancano
-- allergeni o ingredienti. Restano comprabili, annullabili e col prezzo
-- modificabile anche dopo la 195 (il controllo non guarda giacenza e prezzo),
-- ma PRIMA di ripubblicarli o di cambiarne le dichiarazioni o la categoria vanno
-- completati allergeni e ingredienti, altrimenti il salvataggio viene rifiutato.
-- Il 1/11/2026 erano 7 su 9 prodotti in vendita, tutti senza allergeni e senza
-- ingredienti (il catalogo del fornaio).
--   WITH RECURSIVE alimentari AS (
--     SELECT id FROM categories WHERE slug = 'alimentari' AND parent_id IS NULL
--     UNION ALL
--     SELECT c.id FROM categories c JOIN alimentari a ON c.parent_id = a.id
--   )
--   SELECT count(*) FROM products p
--    WHERE p.status = 'available'
--      AND p.category_id IN (SELECT id FROM alimentari)
--      AND (btrim(coalesce(p.attributes->>'allergeni','')) = ''
--        OR btrim(coalesce(p.attributes->>'ingredienti','')) = '');
--
-- Prova: tests/sql/195_un_alimento_senza_ingredienti_non_si_pubblica.test.sql
-- (rossa prima della 195, verde dopo).
--
-- RITORNO INDIETRO (ripristina il guardiano della 126, solo allergeni):
--   DROP TRIGGER IF EXISTS zz_prodotti_alimentari_dichiarazioni ON public.products;
--   poi esegui di nuovo, dalla migrations/126_radiografia_22_agosto.sql,
--   il blocco CREATE OR REPLACE FUNCTION
--   public.alimentare_senza_allergeni_non_si_pubblica() e il blocco
--   DROP/CREATE TRIGGER prodotti_alimentari_allergeni che lo segue.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.alimentare_senza_allergeni_non_si_pubblica()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_radice text;
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

COMMENT ON FUNCTION public.alimentare_senza_allergeni_non_si_pubblica() IS
  'Reg. UE 1169/2011: allergeni e ingredienti devono esserci prima dell acquisto, anche a distanza (dalla 195 anche gli ingredienti).';

REVOKE ALL ON FUNCTION public.alimentare_senza_allergeni_non_si_pubblica() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS prodotti_alimentari_allergeni ON public.products;
DROP TRIGGER IF EXISTS zz_prodotti_alimentari_dichiarazioni ON public.products;
CREATE TRIGGER zz_prodotti_alimentari_dichiarazioni
  BEFORE INSERT OR UPDATE ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.alimentare_senza_allergeni_non_si_pubblica();

NOTIFY pgrst, 'reload schema';

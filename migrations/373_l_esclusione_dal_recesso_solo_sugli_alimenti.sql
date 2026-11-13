-- 373_l_esclusione_dal_recesso_solo_sugli_alimenti.sql
--
-- 13/11/2026 (R13-004) — IL NEGOZIO NON TOGLIE IL RIPENSAMENTO A UN MAGLIONE.
--
-- La 180 ha dato al prodotto la spunta «escluso dal recesso» (non_recedibile),
-- senza nessun legame col tipo di bene: una merceria poteva segnarla su un
-- maglione da 60 euro, e la rotta dei resi rifiutava il ripensamento dicendo
-- al cliente che era la legge. L'elenco dell'art. 59 del Codice del Consumo è
-- chiuso, e la scelta di Nicola (fatto legale.recesso-esclusi) ne prende due
-- voci: i prodotti che si deteriorano in fretta e quelli fatti su ordinazione.
-- Sul catalogo sono tutti e due alimenti.
--
-- Da qui la spunta accesa vale solo su un prodotto la cui categoria (o una
-- sua madre) è alimentare: la stessa regola degli allergeni, con la funzione
-- della 363 (radice_con_obbligo_alimentare). Vale per ogni strada che scrive
-- products (il modulo dal browser, la porta del venditore, l'assistente,
-- l'importazione, la chiave di servizio): un prodotto nuovo, una spunta
-- accesa o una categoria cambiata fuori dagli alimenti danno errore 23514.
-- Togliere la spunta passa sempre.
--
-- Le spunte già messe su prodotti non alimentari si tolgono qui: davano al
-- cliente una scheda che negava un diritto di legge. Il sito le ignora già
-- (lib/ordini/recesso.ts, esclusioniAmmesse), ma la scheda prodotto le
-- mostrerebbe ancora.
--
-- Si annulla con:
--   DROP TRIGGER IF EXISTS esclusione_dal_recesso_solo_sugli_alimenti ON public.products;
--   DROP FUNCTION IF EXISTS public.esclusione_dal_recesso_solo_sugli_alimenti();
-- (le spunte tolte non tornano: andrebbero rimesse a mano, ed erano sbagliate.)

UPDATE public.products
   SET non_recedibile = false
 WHERE non_recedibile
   AND NOT public.radice_con_obbligo_alimentare(category_id);

CREATE OR REPLACE FUNCTION public.esclusione_dal_recesso_solo_sugli_alimenti()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.non_recedibile IS NOT TRUE THEN
    RETURN NEW;
  END IF;
  IF public.radice_con_obbligo_alimentare(NEW.category_id) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Escluso dal recesso vale solo per gli alimenti freschi o fatti su ordinazione (art. 59 Cod. Cons.): togli la spunta per questa categoria'
    USING ERRCODE = '23514';
END$$;

COMMENT ON FUNCTION public.esclusione_dal_recesso_solo_sugli_alimenti() IS
  'R13-004: products.non_recedibile vero solo se la categoria (o una madre) ha richiede_dichiarazioni_alimentari. Art. 59 Cod. Cons., fatto legale.recesso-esclusi.';

DROP TRIGGER IF EXISTS esclusione_dal_recesso_solo_sugli_alimenti ON public.products;
CREATE TRIGGER esclusione_dal_recesso_solo_sugli_alimenti
  BEFORE INSERT OR UPDATE OF non_recedibile, category_id ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.esclusione_dal_recesso_solo_sugli_alimenti();

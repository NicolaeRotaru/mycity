-- 881 — Un prodotto tolto dopo una segnalazione accolta non torna in vendita da solo
--
-- IL DIFETTO. Accogliere una segnalazione su un prodotto lo mette in bozza
-- (app/api/admin/segnalazioni/accogli, dal 12/11). Ma nessun campo dice «tolto
-- dall'amministrazione»: nell'elenco del venditore (app/seller/products) il
-- pulsante «Attiva» porta qualunque stato diverso da 'available' ad 'available',
-- e la regola per riga dei prodotti lascia al venditore scrivere lo stato dei
-- suoi prodotti. Il prodotto contraffatto o pericoloso tornava in vetrina con un
-- clic del venditore, mentre a chi aveva segnalato era partito «il contenuto è
-- stato rimosso». Lo stesso con un rifornimento: un prodotto rimesso «esaurito»
-- dal venditore torna 'available' da solo quando arriva la merce
-- (trg_auto_republish, 032/071).
--
-- LA CURA. Un guardiano sul database, non sulla pagina: un prodotto che ha una
-- segnalazione ACCOLTA (segnalazioni.tipo = 'prodotto', stato = 'accolta') non
-- diventa 'available' se a scrivere non è lo staff (is_admin) o il server con la
-- chiave di servizio. Il venditore che preme «Attiva» riceve il motivo (23514, il
-- codice delle regole del catalogo: la rotta del venditore lo passa com'è, come
-- per gli allergeni della 195). Un movimento di magazzino (rifornimento, ordine
-- annullato) invece riesce sempre: il prodotto resta fuori vendita, come fa la
-- 195 con gli alimenti senza dichiarazioni.
-- Nessuna colonna nuova: il segno «tolto» è la segnalazione accolta stessa. Se
-- l'amministrazione cambia idea (una contestazione accolta), la segnalazione
-- torna «respinta» e il venditore riattiva da solo; oppure lo staff rimette il
-- prodotto in vendita.
--
-- PERCHÉ «zz_prodotto_…». I trigger BEFORE scattano in ordine alfabetico: questo
-- deve vedere lo stato DOPO trg_auto_republish, che rimette 'available' un
-- prodotto quando torna la merce (stesso motivo del nome della 195).
--
-- Prima di applicarla, per vedere quali prodotti oggi in vendita hanno una
-- segnalazione accolta (restano come sono: il guardiano guarda solo il passaggio
-- ad 'available'):
--   SELECT p.id, p.name, p.status FROM public.products p
--    WHERE p.status = 'available' AND EXISTS (SELECT 1 FROM public.segnalazioni s
--      WHERE s.tipo = 'prodotto' AND s.oggetto_id = p.id AND s.stato = 'accolta');
--
-- Si può rieseguire. NON si applica a mano: lo decide Nicola, come ogni migrazione.
-- RITORNO INDIETRO:
--   DROP TRIGGER IF EXISTS zz_prodotto_tolto_per_segnalazione ON public.products;
--   DROP FUNCTION IF EXISTS public.prodotto_tolto_per_segnalazione_resta_fuori();
-- LA PROVA: tests/sql/rls/riparazione-r02-prodotto-tolto-resta-fuori.test.sql.

CREATE OR REPLACE FUNCTION public.prodotto_tolto_per_segnalazione_resta_fuori()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Solo il passaggio ad 'available': tutto il resto (prezzo, testo, bozza,
  -- esaurito, cancellazione) resta libero come prima.
  IF NEW.status IS DISTINCT FROM 'available' OR OLD.status IS NOT DISTINCT FROM 'available' THEN
    RETURN NEW;
  END IF;
  IF public.is_admin()
     OR coalesce((SELECT auth.jwt() ->> 'role'), '') = 'service_role' THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.segnalazioni s
     WHERE s.tipo = 'prodotto' AND s.oggetto_id = NEW.id AND s.stato = 'accolta'
  ) THEN
    RETURN NEW;
  END IF;

  -- La merce che torna a scaffale: il movimento deve riuscire (altrimenti un
  -- ordine non si annulla), il prodotto resta dov'era.
  IF NEW.stock IS DISTINCT FROM OLD.stock THEN
    NEW.status := OLD.status;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Questo prodotto è stato tolto dalla vetrina dopo una segnalazione accolta: non si rimette in vendita da qui. Se non sei d''accordo con la decisione, scrivici dalla pagina Contatti.'
    USING ERRCODE = '23514';
END
$$;

COMMENT ON FUNCTION public.prodotto_tolto_per_segnalazione_resta_fuori() IS
  'Un prodotto con una segnalazione accolta torna in vendita solo per mano dello staff (881).';

REVOKE ALL ON FUNCTION public.prodotto_tolto_per_segnalazione_resta_fuori() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS zz_prodotto_tolto_per_segnalazione ON public.products;
CREATE TRIGGER zz_prodotto_tolto_per_segnalazione
  BEFORE UPDATE ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.prodotto_tolto_per_segnalazione_resta_fuori();

NOTIFY pgrst, 'reload schema';

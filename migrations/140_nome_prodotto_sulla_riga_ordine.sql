-- Cancellare un prodotto portava via le recensioni e il nome di quello che il cliente aveva comprato.
--
-- IL DIFETTO (radiografia del 27/8/2026, R029). Il tasto «Elimina» del pannello venditore cancella
-- davvero la riga: `app/seller/products/page.tsx` e `app/seller/products/[id]/edit/page.tsx` fanno
-- `.delete()`, non un «nascondi». Provato sul database ricostruito, coi permessi veri del negoziante
-- (`SET ROLE authenticated` più il suo identificativo): prima della cancellazione una recensione da
-- una stella e una riga d'ordine col prodotto; dopo, prodotti 0, recensioni 0, riga d'ordine ancora
-- lì ma con l'aggancio al prodotto diventato NULL.
--
-- Due conseguenze, distinte.
--   ① Le recensioni erano agganciate con ON DELETE CASCADE (`reviews_product_id_fkey`). Chi prende
--      una stella cancella il prodotto e ripubblica pulito: su un marketplace è il modo classico di
--      lavarsi la reputazione, e il voto medio smette di dire la verità al cliente.
--   ② `order_items` non teneva nessuna copia del nome: le sue colonne sono id, order_id, product_id,
--      quantity, unit_price, variant_id, variant_label. Le pagine dell'ordine il nome lo leggevano
--      per aggancio (`order_items ( ..., products ( name, images ) )`). Cancellato il prodotto,
--      l'ordine del cliente resta per sempre con una riga senza nome e senza foto: non sa più cosa ha
--      comprato e non può nemmeno recensirlo.
--
-- LA RIPARAZIONE, in tre pezzi.
--   ① Lo scatto: `order_items.product_name` e `order_items.product_image`, riempite dal database al
--      momento in cui la riga nasce. Le riempie un trigger e non le due strade di cassa (contanti e
--      carta), perché una copia scritta in due posti è la firma del difetto che poi torna: è già
--      successo tre volte con il conto della cassa. Le righe già esistenti si riempiono all'indietro
--      dai prodotti ancora vivi.
--   ② Il freno: un prodotto che è dentro un ordine, o che ha ricevuto una recensione, non si cancella
--      più. Si nasconde (`status = 'draft'`), che è quello che il negoziante vuole davvero fare.
--      Così la classe di errore diventa impossibile, non solo improbabile.
--   ③ Le vie di servizio restano aperte: l'amministratore e il `service_role` cancellano ancora (una
--      segnalazione di contraffazione va evasa), e resta l'interruttore `mycity.allow_product_delete`
--      per le manutenzioni.
--
-- PERCHE' NON CAMBIO LA CHIAVE DELLE RECENSIONI DA CASCADE A SET NULL, come proponeva il referto: una
-- recensione senza prodotto è una riga che non si può più né mostrare né spiegare, e finirebbe nelle
-- medie di nessuno. Bloccare la cancellazione protegge la stessa cosa e non lascia orfani. Se un
-- giorno servisse davvero, la riga da eseguire è:
--   ALTER TABLE public.reviews DROP CONSTRAINT reviews_product_id_fkey,
--     ADD CONSTRAINT reviews_product_id_fkey FOREIGN KEY (product_id)
--     REFERENCES public.products(id) ON DELETE SET NULL;
--
-- REVERSIBILE. `DROP TRIGGER trg_scatta_nome_prodotto ON public.order_items;`,
-- `DROP TRIGGER trg_prodotto_venduto_non_si_cancella ON public.products;` e, se si vuole tornare
-- indietro del tutto, `ALTER TABLE public.order_items DROP COLUMN product_name, DROP COLUMN product_image;`.
--
-- LA PROVA: tests/sql/rls/21-un-prodotto-venduto-non-si-cancella.test.sql. Senza questa migrazione è
-- rossa; con questa è verde, e l'ultimo controllo verifica che un prodotto mai venduto si cancelli
-- ancora — un freno che blocca tutto non è un freno, è un guasto.

-- =========================================================
-- ① LO SCATTO DEL NOME SULLA RIGA D'ORDINE
-- =========================================================
ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS product_name  text,
  ADD COLUMN IF NOT EXISTS product_image text;

COMMENT ON COLUMN public.order_items.product_name IS
  'Nome del prodotto al momento dell''ordine. Copia voluta: l''ordine deve restare leggibile anche se il prodotto cambia nome o sparisce.';
COMMENT ON COLUMN public.order_items.product_image IS
  'Prima foto del prodotto al momento dell''ordine. Stessa ragione del nome.';

CREATE OR REPLACE FUNCTION public.scatta_nome_prodotto_sulla_riga()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Se chi inserisce ha già scritto il nome, quello vale: è il caso di un
  -- prodotto sparito prima che l'ordine arrivasse a destinazione.
  IF NEW.product_id IS NOT NULL AND (NEW.product_name IS NULL OR NEW.product_image IS NULL) THEN
    SELECT coalesce(NEW.product_name, p.name),
           coalesce(NEW.product_image, p.images ->> 0)
      INTO NEW.product_name, NEW.product_image
      FROM public.products p
     WHERE p.id = NEW.product_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_scatta_nome_prodotto ON public.order_items;
CREATE TRIGGER trg_scatta_nome_prodotto
  BEFORE INSERT ON public.order_items
  FOR EACH ROW EXECUTE FUNCTION public.scatta_nome_prodotto_sulla_riga();

-- Le righe già scritte: si riempiono da quello che c'è ancora. Quelle il cui
-- prodotto è già stato cancellato restano vuote — quel nome non ce l'ha più
-- nessuno, e inventarlo sarebbe peggio che dirlo.
UPDATE public.order_items oi
   SET product_name  = coalesce(oi.product_name,  p.name),
       product_image = coalesce(oi.product_image, p.images ->> 0)
  FROM public.products p
 WHERE p.id = oi.product_id
   AND (oi.product_name IS NULL OR oi.product_image IS NULL);

-- =========================================================
-- ② UN PRODOTTO VENDUTO O RECENSITO NON SI CANCELLA
-- =========================================================
CREATE OR REPLACE FUNCTION public.prodotto_venduto_non_si_cancella()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Vie di servizio: moderazione dell'amministratore, lavori del server e
  -- manutenzioni dichiarate. Chi passa di qui sa cosa sta portando via.
  IF public.is_admin()
     OR coalesce((SELECT auth.jwt() ->> 'role'), '') = 'service_role'
     OR coalesce(current_setting('mycity.allow_product_delete', true), '') = '1' THEN
    RETURN OLD;
  END IF;

  IF EXISTS (SELECT 1 FROM public.order_items oi WHERE oi.product_id = OLD.id) THEN
    RAISE EXCEPTION 'products: questo prodotto e'' dentro un ordine: si puo'' nascondere, non cancellare'
      USING ERRCODE = '42501';
  END IF;

  IF EXISTS (SELECT 1 FROM public.reviews r WHERE r.product_id = OLD.id) THEN
    RAISE EXCEPTION 'products: questo prodotto ha delle recensioni: si puo'' nascondere, non cancellare'
      USING ERRCODE = '42501';
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_prodotto_venduto_non_si_cancella ON public.products;
CREATE TRIGGER trg_prodotto_venduto_non_si_cancella
  BEFORE DELETE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.prodotto_venduto_non_si_cancella();

-- Le funzioni trigger non le chiama nessuno da fuori: girano come proprietario
-- quando il trigger scatta, e nient'altro. Stessa regola della migrazione 064.
REVOKE ALL ON FUNCTION public.scatta_nome_prodotto_sulla_riga() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prodotto_venduto_non_si_cancella() FROM PUBLIC, anon, authenticated;

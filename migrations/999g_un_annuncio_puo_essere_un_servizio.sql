-- 999g — Un annuncio può essere un prodotto oppure un servizio (27/11/2026).
--
-- PERCHÉ. Nicola, 27/11 verso le 23:30: «permetti di offrire anche servizi oltre a prodotti ai venditori».
-- MyCity promuove i «servizi e prodotti» delle attività locali: parrucchiere, estetista, sarta, riparazioni,
-- fotografo. Fino a qui il catalogo conosceva solo prodotti con scorta e consegna.
--
-- COSA FA.
--   1. `products.tipo`: 'prodotto' (il valore di partenza, per tutte le righe che ci sono) oppure 'servizio'.
--   2. `products.durata_minuti` (facoltativa, fra 5 e 1440) e `products.dove_servizio` (facoltativa:
--      in_negozio, a_domicilio, online). Un vincolo le vieta su un prodotto.
--   3. Un servizio non entra in nessun ordine: per ora si prenota scrivendo al negozio, non si paga online.
--      La cassa lo rifiuta già (lib/ordini/valida-carrello.ts); il trigger `order_items_niente_servizi` è
--      l'ultima porta, come `order_items_niente_abbonamenti_sdg` della 707.
--   4. I tre abbonamenti di SDG Agenzia diventano 'servizio'. Il loro percorso (pagina Abbonamento) resta
--      quello di prima e nel codice ha la precedenza.
--
-- PERMESSI. Nessuna tabella nuova: `products` tiene le regole che ha (le colonne nuove seguono quelle della
-- tabella). La funzione della guardia non si chiama da fuori: si toglie EXECUTE a tutti.
--
-- PRIMA E DOPO. Il sito regge anche senza questa migrazione: senza la colonna `tipo` ogni annuncio vale
-- «prodotto», e il modulo del negoziante dice che i servizi non sono ancora attivi.
--
-- SI PUÒ RIESEGUIRE. NON si applica a mano: lo decide Nicola, col pulsante «Migrazioni a mano».
-- COME SI TORNA INDIETRO (i servizi già pubblicati tornano prodotti senza scorta):
--   DROP TRIGGER IF EXISTS order_items_niente_servizi ON public.order_items;
--   DROP FUNCTION IF EXISTS public.order_items_niente_servizi();
--   ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_dettagli_solo_sui_servizi;
--   ALTER TABLE public.products DROP COLUMN IF EXISTS dove_servizio;
--   ALTER TABLE public.products DROP COLUMN IF EXISTS durata_minuti;
--   ALTER TABLE public.products DROP COLUMN IF EXISTS tipo;

BEGIN;

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS tipo text NOT NULL DEFAULT 'prodotto';
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS durata_minuti integer;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS dove_servizio text;

ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_tipo_valido;
ALTER TABLE public.products ADD CONSTRAINT products_tipo_valido
  CHECK (tipo IN ('prodotto', 'servizio'));

ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_durata_minuti_valida;
ALTER TABLE public.products ADD CONSTRAINT products_durata_minuti_valida
  CHECK (durata_minuti IS NULL OR durata_minuti BETWEEN 5 AND 1440);

ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_dove_servizio_valido;
ALTER TABLE public.products ADD CONSTRAINT products_dove_servizio_valido
  CHECK (dove_servizio IS NULL OR dove_servizio IN ('in_negozio', 'a_domicilio', 'online'));

-- Durata e «dove si fa» hanno senso solo su un servizio.
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_dettagli_solo_sui_servizi;
ALTER TABLE public.products ADD CONSTRAINT products_dettagli_solo_sui_servizi
  CHECK (tipo = 'servizio' OR (durata_minuti IS NULL AND dove_servizio IS NULL));

COMMENT ON COLUMN public.products.tipo IS
  'prodotto o servizio (999g). Un servizio non si compra col carrello: si prenota scrivendo al negozio.';
COMMENT ON COLUMN public.products.durata_minuti IS 'Solo servizi: quanto dura, in minuti (5-1440). Facoltativa.';
COMMENT ON COLUMN public.products.dove_servizio IS 'Solo servizi: in_negozio, a_domicilio o online. Facoltativa.';

-- I tre abbonamenti di SDG Agenzia sono servizi.
UPDATE public.products SET tipo = 'servizio'
 WHERE seller_id = '11111111-1111-1111-1111-5d9000000001'::uuid AND tipo <> 'servizio';

-- L'ultima porta: un servizio non entra in nessun ordine.
CREATE OR REPLACE FUNCTION public.order_items_niente_servizi()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF NEW.product_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.id = NEW.product_id AND p.tipo = 'servizio'
  ) THEN
    RAISE EXCEPTION 'Un servizio non si compra col carrello: si prenota scrivendo al negozio.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.order_items_niente_servizi() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS order_items_niente_servizi ON public.order_items;
CREATE TRIGGER order_items_niente_servizi
  BEFORE INSERT OR UPDATE OF product_id ON public.order_items
  FOR EACH ROW EXECUTE FUNCTION public.order_items_niente_servizi();

COMMIT;

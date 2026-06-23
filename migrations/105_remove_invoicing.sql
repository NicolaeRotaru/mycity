-- 105_remove_invoicing.sql
-- Rimozione DEFINITIVA della fatturazione dal marketplace (richiesta esplicita).
-- MyCity non emette/gestisce fatture per gli ordini: il flusso B2B/SDI viene
-- eliminato a tutti i livelli (codice + DB). Gli adempimenti fiscali della
-- vendita restano in capo al singolo Venditore (vedi Termini).
--
-- ⚠️ DISTRUTTIVA: elimina tabelle/colonne. Le tabelle non hanno mai prodotto
-- fatture reali (feature mai implementata); business_orders può contenere righe
-- storiche di richieste B2B → vengono rimosse con la tabella. Idempotente.
--
-- NB: questo NON tocca:
--  - profiles.business_vat_number / business_sdi ecc. (identità fiscale del
--    Venditore, usata per KYC/VIES, non per la fatturazione ordini);
--  - gli eventi Stripe invoice.* dell'ABBONAMENTO venditore (billing Stripe).

-- 1) RPC numerazione fattura (mai usata).
DROP FUNCTION IF EXISTS public.next_invoice_number(uuid, integer);

-- 2) Tabella sequenze numerazione fattura.
DROP TABLE IF EXISTS public.invoice_sequences;

-- 3) Tabella dettagli fattura B2B per ordine.
DROP TABLE IF EXISTS public.business_orders;

-- 4) Colonne fattura sugli ordini (+ indice associato, droppato con la colonna).
ALTER TABLE public.orders
  DROP COLUMN IF EXISTS invoice_number,
  DROP COLUMN IF EXISTS invoice_pdf_url;

-- 5) Dato B2B transitorio sui checkout pendenti.
ALTER TABLE public.pending_checkouts
  DROP COLUMN IF EXISTS b2b;

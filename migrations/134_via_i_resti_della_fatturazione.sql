-- =========================================================
-- R035 — I RESTI DELLA FATTURAZIONE CHE NESSUNO AVEVA PORTATO VIA
-- =========================================================
-- 30/8/2026.
--
-- COSA C'ERA. La migrazione 105 ha tolto la fatturazione «a tutti i livelli»:
-- via la funzione di numerazione, via le tabelle `invoice_sequences` e
-- `business_orders`, via le colonne `invoice_number` e `invoice_pdf_url` da
-- `orders`. Tre colonne pero' sono rimaste attaccate alla tabella degli ordini:
--
--   · invoice_sdi_status   (con il vincolo orders_invoice_sdi_status_check)
--   · invoice_sdi_id
--   · invoice_issued_at
--
-- Nessuna riga di codice le scrive o le legge: compaiono soltanto dentro
-- `lib/database.types.ts`, cioe' nei tipi generati leggendo lo schema — ci sono
-- perche' esistono, non perche' servano a qualcuno.
--
-- PERCHE' SI TOLGONO. Una colonna morta su `orders` non e' innocua: e' la
-- tabella che si guarda quando un pagamento non torna, e ogni campo che sembra
-- dire qualcosa sulla fattura di un ordine fa perdere tempo a chi legge — o,
-- peggio, fa credere che una fattura da qualche parte esista. MyCity non emette
-- fatture per gli ordini: gli adempimenti fiscali della vendita restano del
-- singolo venditore (Condizioni d'uso). Il vincolo se ne va insieme alla sua
-- colonna.
--
-- ⚠️ DISTRUTTIVA E IRREVERSIBILE (🔴): prima di applicarla in produzione va
-- fatto il conteggio di prudenza — se qualcuna delle tre colonne contenesse
-- valori veri, quei valori si perdono:
--
--   SELECT count(*) FILTER (WHERE invoice_sdi_status IS NOT NULL) AS stato,
--          count(*) FILTER (WHERE invoice_sdi_id     IS NOT NULL) AS id_sdi,
--          count(*) FILTER (WHERE invoice_issued_at  IS NOT NULL) AS emessa
--   FROM public.orders;
--
-- Se tornano tutti zero — ed e' quello che ci si aspetta, la funzione non e'
-- mai stata implementata — si applica. Dopo, i tipi si rigenerano con
-- `npm run db:types`.
--
-- Idempotente: si puo' rilanciare senza danno.

ALTER TABLE IF EXISTS public.orders
  DROP CONSTRAINT IF EXISTS orders_invoice_sdi_status_check;

ALTER TABLE IF EXISTS public.orders
  DROP COLUMN IF EXISTS invoice_sdi_status,
  DROP COLUMN IF EXISTS invoice_sdi_id,
  DROP COLUMN IF EXISTS invoice_issued_at;

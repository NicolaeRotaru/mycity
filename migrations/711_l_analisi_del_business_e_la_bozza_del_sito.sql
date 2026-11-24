-- 711 — L'analisi del business e la bozza del sito scritta dall'AD (24/11/2026).
--
-- Nicola: «manca un'ultima cosa dentro i servizi, l'analisi del business, la fa n8n e deve esserci
-- dentro una voce dei servizi… ci deve essere anche l'analisi dei social, google, sito». E la bozza
-- del sito fatta con l'IA la scrive «l'AD in un giro» (sul suo piano: il sito non chiama nessuna IA).
--
-- COSA FA.
--  1. analisi_negozi — una riga per negozio con le tre analisi che non stanno nella scheda di n8n:
--     · sito / sito_il: il risultato di Google PageSpeed (gratuito), già in parole semplici; il server
--       lo rifà al massimo una volta al giorno (app/api/seller/analisi-sito);
--     · canali / canali_il: l'analisi di social e scheda Google che manda n8n dai dati pubblici
--       (app/api/agenzia/analisi-canali), con data e fonte di ogni canale;
--     · canali_richiesti_il: quando il titolare ha cambiato i suoi canali, cioè quando n8n deve rifare.
--     L'analisi dell'attività (flusso 18) resta dov'è: nella scheda del cliente (schede_clienti, 708).
--  2. bozze_sito — la bozza del sito scritta dall'AD (app/api/agenzia/bozza-sito): quattro sezioni,
--     senza prezzi, ogni testo da confermare dal titolare. La pagina «Sito web» la mostra al posto di
--     quella fatta coi dati.
--  3. Le descrizioni dei tre abbonamenti di SDG nel marketplace dicono anche l'analisi del business
--     (lib/agenzia/prodotti-sdg.ts, dal listino FASCE; la prova sdg-nel-marketplace.test.ts controlla
--     che coincidano). Nome, prezzo, stato e scorte restano come sono.
--
-- PERMESSI (migrazione 425), tabella per tabella qui sotto: il negozio legge solo la sua riga, scrive
-- solo il server (service_role). Un visitatore non legge niente.
-- DATI DI PERSONE: sono dati dell'attività (canali pubblici, risultati di Google, testi del sito), ma
-- entrano lo stesso in «scarica i miei dati» (app/api/account/export/route.ts).
--
-- ORDINE. Dopo la 707 e la 710 (i prodotti di SDG). Se la 707 non c'è ancora, l'UPDATE del punto 3 non
-- trova righe e non fa niente.
-- Si può rieseguire. NON si applica a mano: lo decide Nicola, col pulsante «Migrazioni a mano».
-- REVERSIBILE:
--   DROP TABLE IF EXISTS public.bozze_sito;
--   DROP TABLE IF EXISTS public.analisi_negozi;
--   e per le descrizioni rieseguire la 710.

BEGIN;

-- 1) Le analisi del negozio ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.analisi_negozi (
  id_attivita uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  sito jsonb CHECK (sito IS NULL OR (jsonb_typeof(sito) = 'object' AND octet_length(sito::text) <= 20000)),
  sito_il timestamptz,
  canali jsonb CHECK (canali IS NULL OR (jsonb_typeof(canali) = 'object' AND octet_length(canali::text) <= 80000)),
  canali_il timestamptz,
  canali_richiesti_il timestamptz,
  aggiornata_il timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS analisi_negozi_da_fare_idx
  ON public.analisi_negozi (canali_richiesti_il)
  WHERE canali_richiesti_il IS NOT NULL;

ALTER TABLE public.analisi_negozi ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS analisi_negozi_il_negozio_legge_la_sua ON public.analisi_negozi;
CREATE POLICY analisi_negozi_il_negozio_legge_la_sua ON public.analisi_negozi
  FOR SELECT TO authenticated
  USING (id_attivita = (SELECT auth.uid()));

REVOKE ALL ON public.analisi_negozi FROM anon, authenticated;
GRANT SELECT ON public.analisi_negozi TO authenticated;
GRANT ALL ON public.analisi_negozi TO service_role;

COMMENT ON TABLE public.analisi_negozi IS
  'L analisi del business di un negozio: il sito (Google PageSpeed, gratuito, una volta al giorno) e i canali (social e scheda Google, da n8n dai dati pubblici). Il negozio legge la sua, scrive solo il server (migrazione 711).';

-- 2) La bozza del sito scritta dall'AD --------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bozze_sito (
  id_attivita uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  bozza jsonb NOT NULL CHECK (jsonb_typeof(bozza) = 'object' AND octet_length(bozza::text) <= 40000),
  origine text NOT NULL DEFAULT 'ad-mycity' CHECK (char_length(origine) <= 40),
  ricevuta_il timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.bozze_sito ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bozze_sito_il_negozio_legge_la_sua ON public.bozze_sito;
CREATE POLICY bozze_sito_il_negozio_legge_la_sua ON public.bozze_sito
  FOR SELECT TO authenticated
  USING (id_attivita = (SELECT auth.uid()));

REVOKE ALL ON public.bozze_sito FROM anon, authenticated;
GRANT SELECT ON public.bozze_sito TO authenticated;
GRANT ALL ON public.bozze_sito TO service_role;

COMMENT ON TABLE public.bozze_sito IS
  'La bozza del sito di un negozio scritta dall AD nel suo giro: quattro sezioni, senza prezzi, ogni testo da confermare dal titolare. Il negozio legge la sua, scrive solo il server (migrazione 711).';

-- 3) I tre abbonamenti di SDG con l'analisi del business --------------------------------------
UPDATE public.products AS p
SET description = v.description
FROM (VALUES
    ('11111111-1111-1111-1111-5d9000000101'::uuid, 'Per essere online e vendere da subito, con un aiuto costante ma leggero.

Cosa comprende:
· Foto e video: Una sessione di foto all’avvio: copertina e prodotti principali.
· Sito web professionale: Un sito di una pagina col tuo nome, collegato alla vetrina.
· Gestione dei social e di Google Maps: 8 post al mese, preparati e pubblicati da noi. Scheda Google Maps creata o sistemata all’avvio.
· Analisi del business: Un’analisi completa all’avvio: la tua attività, i social, la scheda Google e il sito, con cosa migliorare.
· Vetrina: Vetrina su MyCity con ordini, consegna e ritiro in negozio.
· Assistenza: Su WhatsApp, risposta entro 24 ore lavorative.

Si attiva dalla pagina Abbonamento del tuo negozio, non dal carrello. Nessun vincolo di durata: disdici quando vuoi, con 30 giorni di preavviso. Il primo mese costa la metà.
I servizi li realizza SDG Agenzia, il partner di MyCity per foto, video, social e web.'),
    ('11111111-1111-1111-1111-5d9000000102'::uuid, 'Per crescere ogni settimana: più contenuti, più clienti che ti trovano.

Cosa comprende:
· Foto e video: Foto all’avvio e una nuova sessione ogni tre mesi, più un video al mese.
· Sito web professionale: Un sito completo di più pagine, col tuo nome.
· Gestione dei social e di Google Maps: 12 post al mese, 3 a settimana, con 2 video brevi. Scheda Google Maps sistemata, più le risposte alle recensioni scritte da noi.
· Analisi del business: L’analisi completa all’avvio e una nuova ogni mese: cosa è cambiato e cosa fare il mese dopo.
· Vetrina: Vetrina su MyCity con ordini, consegna e ritiro in negozio, in evidenza nella tua categoria una settimana al mese.
· Assistenza: Su WhatsApp, risposta entro 4 ore lavorative.

Si attiva dalla pagina Abbonamento del tuo negozio, non dal carrello. Nessun vincolo di durata: disdici quando vuoi, con 30 giorni di preavviso. Il primo mese costa la metà.
I servizi li realizza SDG Agenzia, il partner di MyCity per foto, video, social e web.'),
    ('11111111-1111-1111-1111-5d9000000103'::uuid, 'Il servizio completo: foto e video ogni mese, un referente tutto tuo.

Cosa comprende:
· Foto e video: Una sessione di foto e video ogni mese.
· Sito web professionale: Un sito completo, aggiornato da noi ogni mese.
· Gestione dei social e di Google Maps: 20 post al mese, 4 video brevi e le storie. Scheda Google Maps curata ogni mese: foto nuove, post e risposte alle recensioni.
· Analisi del business: L’analisi ogni settimana, e un incontro al mese per leggerla insieme.
· Vetrina: Vetrina su MyCity con ordini, consegna e ritiro in negozio, in home page due settimane al mese.
· Assistenza: Un referente tutto tuo e una visita nel locale ogni mese.

Si attiva dalla pagina Abbonamento del tuo negozio, non dal carrello. Nessun vincolo di durata: disdici quando vuoi, con 30 giorni di preavviso. Il primo mese costa la metà.
I servizi li realizza SDG Agenzia, il partner di MyCity per foto, video, social e web.')
) AS v(id, description)
WHERE p.id = v.id
  AND p.seller_id = '11111111-1111-1111-1111-5d9000000001'::uuid;

COMMIT;

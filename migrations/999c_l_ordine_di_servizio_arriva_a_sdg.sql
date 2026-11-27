-- 999c — L'ordine di servizio arriva a SDG quando il titolare conferma l'abbonamento (27/11/2026).
--
-- Nicola, 27/11/2026 17:25: «quando l'imprenditore conferma con le mail l'abbonamento, in quel momento alla
-- pagina del venditore dove il venditore ha creato il link … deve aggiornarsi e portarlo alla pagina con su
-- scritto tutte le cose che deve fare adesso SDG. E in automatico deve arrivare l'ordine del servizio, quindi
-- nella pagina venditore di SDG … con su scritto tutti i dati, quindi che abbonamento ha scelto l'imprenditore,
-- e tutto il piano editoriale già fatto».
--
-- COSA FA.
--  1. preventivi_con_codice impara CHI ha portato il cliente: `lavoro` (la scheda dell'agente in n8n, tabella
--     «Schede per il venditore») e `agente_email` (l'email dell'agente, sempre minuscola). Le scrive il server
--     quando l'agente preme «Sì, aggiungi» (app/api/agente/aggiungi). La tabella resta com'era: nessuna regola
--     per i browser, la legge solo il server (708).
--  2. ordini_sdg — l'ordine di servizio per SDG Agenzia, UNO per attività (chiave unica su seller_id: una
--     seconda accettazione, o due chiamate insieme, non fanno un doppione). Dentro: nome e dati pubblici
--     dell'attività, abbonamento e canone, data della visita del team creativo, l'agente, e il piano editoriale
--     del primo mese. Il piano nasce subito, calcolato dal sito (`piano_origine` = 'sito'); quello completo lo
--     prepara l'AD («Chiedi all'AD», flusso n8n 14) e quando torna prende il suo posto ('ad').
--     Gli abbonamenti di SDG NON entrano in `orders`: lo vieta apposta il trigger
--     order_items_niente_abbonamenti_sdg della 707, che qui non si tocca.
--
-- PERMESSI (migrazione 425). ordini_sdg: la LEGGONO solo l'admin e l'account di SDG Agenzia
-- (11111111-1111-1111-1111-5d9000000001, che oggi non entra mai: SDG_SELLER_ID in lib/products/sdgSeller.ts);
-- la SCRIVE solo il server con la chiave di servizio. Il titolare, anche entrato, non la legge: è il foglio di
-- lavoro di SDG. L'agente la vede solo dal server, solo per le sue attività (app/api/agente/attivita).
-- DATI DI PERSONE: l'email dell'agente; il resto sono dati pubblici del locale. Entra in «scarica i miei dati»
-- del titolare senza l'email dell'agente (app/api/account/export/route.ts).
--
-- Si può rieseguire. NON si applica da sola: la applica Nicola, col pulsante «Migrazioni a mano».
-- Viene dopo la 999b (la data della visita, `visita_il`, dell'altra sessione): qui non la si tocca, la si legge.
-- REVERSIBILE (si perdono gli ordini di servizio):
--   DROP TABLE IF EXISTS public.ordini_sdg;
--   DROP INDEX IF EXISTS public.preventivi_con_codice_agente_email;
--   DROP INDEX IF EXISTS public.preventivi_con_codice_lavoro;
--   ALTER TABLE public.preventivi_con_codice DROP CONSTRAINT IF EXISTS preventivi_con_codice_agente_email_forma;
--   ALTER TABLE public.preventivi_con_codice DROP COLUMN IF EXISTS agente_email;
--   ALTER TABLE public.preventivi_con_codice DROP COLUMN IF EXISTS lavoro;
-- LA PROVA: tests/sql/harness/999c-l-ordine-di-servizio-arriva-a-sdg.sh

BEGIN;

-- 1) Chi ha portato il cliente --------------------------------------------------------------------
ALTER TABLE public.preventivi_con_codice ADD COLUMN IF NOT EXISTS lavoro uuid;
ALTER TABLE public.preventivi_con_codice ADD COLUMN IF NOT EXISTS agente_email text;

ALTER TABLE public.preventivi_con_codice DROP CONSTRAINT IF EXISTS preventivi_con_codice_agente_email_forma;
ALTER TABLE public.preventivi_con_codice
  ADD CONSTRAINT preventivi_con_codice_agente_email_forma
  CHECK (agente_email IS NULL OR (char_length(agente_email) BETWEEN 3 AND 254 AND agente_email = lower(agente_email) AND position('@' IN agente_email) > 1));

CREATE INDEX IF NOT EXISTS preventivi_con_codice_lavoro ON public.preventivi_con_codice (lavoro) WHERE lavoro IS NOT NULL;
CREATE INDEX IF NOT EXISTS preventivi_con_codice_agente_email ON public.preventivi_con_codice (agente_email) WHERE agente_email IS NOT NULL;

COMMENT ON COLUMN public.preventivi_con_codice.lavoro IS
  'La scheda dell agente (lavoro della tabella n8n «Schede per il venditore») da cui è nato il preventivo. La scrive il server al «Sì, aggiungi». Migrazione 999c.';
COMMENT ON COLUMN public.preventivi_con_codice.agente_email IS
  'L email (minuscola) dell agente che ha premuto «Sì, aggiungi» per ultimo, a preventivo aperto. Migrazione 999c.';

-- 2) L'ordine di servizio per SDG -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ordini_sdg (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  nome_attivita text NOT NULL CHECK (char_length(nome_attivita) BETWEEN 1 AND 120),
  dati_attivita jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(dati_attivita) = 'object' AND octet_length(dati_attivita::text) <= 20000),
  fascia text NOT NULL CHECK (fascia IN ('base', 'business', 'premium')),
  canone_centesimi integer CHECK (canone_centesimi IS NULL OR canone_centesimi > 0),
  primo_mese_centesimi integer CHECK (primo_mese_centesimi IS NULL OR primo_mese_centesimi > 0),
  visita_il timestamptz,
  agente_email text CHECK (agente_email IS NULL OR (char_length(agente_email) BETWEEN 3 AND 254 AND agente_email = lower(agente_email))),
  lavoro uuid,
  accettato_il timestamptz,
  piano jsonb NOT NULL
    CHECK (jsonb_typeof(piano) = 'object' AND octet_length(piano::text) <= 200000),
  piano_origine text NOT NULL DEFAULT 'sito' CHECK (piano_origine IN ('sito', 'ad')),
  piano_completo_stato text NOT NULL DEFAULT 'da_collegare'
    CHECK (piano_completo_stato IN ('da_collegare', 'in_corso', 'pronto', 'errore')),
  lavoro_piano uuid,
  piano_completo_errore text CHECK (piano_completo_errore IS NULL OR char_length(piano_completo_errore) <= 400),
  piano_completo_il timestamptz,
  creato_il timestamptz NOT NULL DEFAULT now(),
  aggiornato_il timestamptz NOT NULL DEFAULT now(),
  -- Il piano dell'AD c'è solo quando è pronto; mentre è in corso si sa con quale lavoro è stato chiesto.
  CONSTRAINT ordini_sdg_piano_ad_solo_pronto CHECK (piano_origine <> 'ad' OR piano_completo_stato = 'pronto'),
  CONSTRAINT ordini_sdg_in_corso_col_lavoro CHECK (piano_completo_stato <> 'in_corso' OR lavoro_piano IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS ordini_sdg_creato_il ON public.ordini_sdg (creato_il DESC);
CREATE INDEX IF NOT EXISTS ordini_sdg_in_attesa_del_piano ON public.ordini_sdg (creato_il) WHERE piano_completo_stato = 'in_corso';

ALTER TABLE public.ordini_sdg ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ordini_sdg_legge_admin_o_sdg ON public.ordini_sdg;
CREATE POLICY ordini_sdg_legge_admin_o_sdg ON public.ordini_sdg
  FOR SELECT TO authenticated
  USING (public.is_admin() OR (SELECT auth.uid()) = '11111111-1111-1111-1111-5d9000000001'::uuid);

REVOKE ALL ON public.ordini_sdg FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.ordini_sdg TO authenticated;
GRANT ALL ON public.ordini_sdg TO service_role;

COMMENT ON TABLE public.ordini_sdg IS
  'L ordine di servizio per SDG Agenzia, uno per attività: nasce quando il titolare accetta il preventivo col link (lib/agenzia/ordine-sdg.ts). Leggono admin e account SDG; scrive solo il server. Migrazione 999c.';

COMMIT;

NOTIFY pgrst, 'reload schema';

-- 999h — Il sito e l'analisi nascono con l'ordine di servizio di SDG (28/11/2026).
--
-- Nicola, 28/11/2026 verso le 00:55: «fai in modo che una volta che il cliente accetta viene creato in automatico,
-- in base all'abbonamento, il suo sito web, il piano editoriale, l'analisi di business».
--
-- COSA FA. ordini_sdg (999c) aveva già il piano editoriale coi suoi stati. Qui impara gli altri due lavori, con le
-- stesse colonne del piano:
--   sito / analisi                il lavoro pronto dell'AD (jsonb): la bozza del sito con le pagine della fascia
--                                 (lib/agenzia/sito-dell-ordine-ad.ts), il rapporto all'avvio con le parti della
--                                 fascia (lib/agenzia/analisi-dell-ordine-ad.ts). C'è solo quando lo stato è «pronto».
--   sito_stato / analisi_stato    da_collegare · in_corso · pronto · errore (default «da_collegare»: gli ordini già
--                                 nati, come quello di prova del 27/11, si possono chiedere dal pulsante di SDG).
--   lavoro_sito / lavoro_analisi  il codice del lavoro mandato all'AD (flusso n8n 14), mentre è in corso.
--   sito_errore / analisi_errore  perché non è arrivato.
--   sito_il / analisi_il          quando è arrivato.
-- La bozza del sito NON va online da sola: qui non c'è nessuna colonna che la pubblica.
--
-- 28/11/2026, 01:10 — Nicola: il sito nasce «in base all'abbonamento ma anche al servizio di cui ha bisogno, che lo
-- selezionerà il venditore nel momento in cui seleziona l'abbonamento», e «anche l'analisi». Quindi
-- preventivi_con_codice impara:
--   bisogni_sito   di cosa ha bisogno il sito, scelto dall'agente (elenco chiuso di lib/agenzia/bisogni-del-sito.ts:
--                  farsi_trovare, menu_listino, prenotazioni, vendere_online, eventi, portfolio), almeno uno;
--   nota_agente    la nota libera dell'agente, al massimo 200 caratteri: un'indicazione per l'AD, mai un testo da
--                  pubblicare (il server rifiuta email, telefoni e indirizzi web).
-- Li scrive il server al «Sì, aggiungi» (app/api/agente/aggiungi); all'accettazione passano nell'ordine di SDG,
-- dentro dati_attivita (999c), e da lì nei compiti del sito e dell'analisi. La tabella resta chiusa ai browser (708).
--
-- PERMESSI: quelli della 999c, che qui non si toccano. ordini_sdg la LEGGONO solo l'admin e l'account di SDG
-- Agenzia, la SCRIVE solo il server con la chiave di servizio. Il titolare il SUO sito e la SUA analisi li legge
-- dal server (app/api/seller/lavoro-consegnato), che prende l'id dall'accesso e filtra su seller_id: mai quelli di
-- un altro, e mai l'email dell'agente.
-- DATI DI PERSONE: nessuno di nuovo. Sono testi sul locale, senza nomi di persona, contatti o dati di Google: li
-- scarta il controllo della risposta dell'AD prima di scriverli.
--
-- Si può rieseguire. NON si applica da sola: la applica Nicola, col pulsante «Migrazioni a mano». Viene dopo la 999c.
-- Prima che entri il sito regge: l'ordine nasce come oggi, i due lavori dicono «manca la migrazione 999h».
-- REVERSIBILE (si perdono le bozze del sito e le analisi degli ordini, e i bisogni scelti dagli agenti):
--   ALTER TABLE public.preventivi_con_codice DROP CONSTRAINT IF EXISTS preventivi_con_codice_bisogni_sito_elenco;
--   ALTER TABLE public.preventivi_con_codice DROP COLUMN IF EXISTS bisogni_sito, DROP COLUMN IF EXISTS nota_agente;
--   ALTER TABLE public.ordini_sdg DROP CONSTRAINT IF EXISTS ordini_sdg_sito_solo_pronto;
--   ALTER TABLE public.ordini_sdg DROP CONSTRAINT IF EXISTS ordini_sdg_sito_in_corso_col_lavoro;
--   ALTER TABLE public.ordini_sdg DROP CONSTRAINT IF EXISTS ordini_sdg_analisi_solo_pronta;
--   ALTER TABLE public.ordini_sdg DROP CONSTRAINT IF EXISTS ordini_sdg_analisi_in_corso_col_lavoro;
--   DROP INDEX IF EXISTS public.ordini_sdg_in_attesa_di_sito_o_analisi;
--   ALTER TABLE public.ordini_sdg DROP COLUMN IF EXISTS sito, DROP COLUMN IF EXISTS sito_stato, DROP COLUMN IF EXISTS lavoro_sito,
--     DROP COLUMN IF EXISTS sito_errore, DROP COLUMN IF EXISTS sito_il, DROP COLUMN IF EXISTS analisi, DROP COLUMN IF EXISTS analisi_stato,
--     DROP COLUMN IF EXISTS lavoro_analisi, DROP COLUMN IF EXISTS analisi_errore, DROP COLUMN IF EXISTS analisi_il;
-- LA PROVA: tests/sql/rls/sdg-il-sito-e-l-analisi-dell-ordine-li-leggono-solo-admin-e-sdg.test.sql

BEGIN;

-- 0) Di cosa ha bisogno il sito, sul preventivo ------------------------------------------------------
ALTER TABLE public.preventivi_con_codice ADD COLUMN IF NOT EXISTS bisogni_sito text[];
ALTER TABLE public.preventivi_con_codice ADD COLUMN IF NOT EXISTS nota_agente text
  CHECK (nota_agente IS NULL OR char_length(nota_agente) <= 200);
ALTER TABLE public.preventivi_con_codice DROP CONSTRAINT IF EXISTS preventivi_con_codice_bisogni_sito_elenco;
ALTER TABLE public.preventivi_con_codice
  ADD CONSTRAINT preventivi_con_codice_bisogni_sito_elenco
  CHECK (bisogni_sito IS NULL OR (
    cardinality(bisogni_sito) BETWEEN 1 AND 6
    AND bisogni_sito <@ ARRAY['farsi_trovare', 'menu_listino', 'prenotazioni', 'vendere_online', 'eventi', 'portfolio']::text[]
  ));
COMMENT ON COLUMN public.preventivi_con_codice.bisogni_sito IS
  'Di cosa ha bisogno il sito, scelto dall agente col titolare al «Sì, aggiungi» (elenco chiuso). Passa nell ordine di SDG. Migrazione 999h.';
COMMENT ON COLUMN public.preventivi_con_codice.nota_agente IS
  'La nota libera dell agente per il sito, al massimo 200 caratteri, senza contatti: un indicazione, mai un testo da pubblicare. Migrazione 999h.';

-- 1) Il sito e l'analisi nell'ordine di SDG -------------------------------------------------------

ALTER TABLE public.ordini_sdg
  ADD COLUMN IF NOT EXISTS sito jsonb
    CHECK (sito IS NULL OR (jsonb_typeof(sito) = 'object' AND octet_length(sito::text) <= 60000)),
  ADD COLUMN IF NOT EXISTS sito_stato text NOT NULL DEFAULT 'da_collegare'
    CHECK (sito_stato IN ('da_collegare', 'in_corso', 'pronto', 'errore')),
  ADD COLUMN IF NOT EXISTS lavoro_sito uuid,
  ADD COLUMN IF NOT EXISTS sito_errore text CHECK (sito_errore IS NULL OR char_length(sito_errore) <= 400),
  ADD COLUMN IF NOT EXISTS sito_il timestamptz,
  ADD COLUMN IF NOT EXISTS analisi jsonb
    CHECK (analisi IS NULL OR (jsonb_typeof(analisi) = 'object' AND octet_length(analisi::text) <= 60000)),
  ADD COLUMN IF NOT EXISTS analisi_stato text NOT NULL DEFAULT 'da_collegare'
    CHECK (analisi_stato IN ('da_collegare', 'in_corso', 'pronto', 'errore')),
  ADD COLUMN IF NOT EXISTS lavoro_analisi uuid,
  ADD COLUMN IF NOT EXISTS analisi_errore text CHECK (analisi_errore IS NULL OR char_length(analisi_errore) <= 400),
  ADD COLUMN IF NOT EXISTS analisi_il timestamptz;

-- Il lavoro c'è solo quando è pronto, e un lavoro pronto c'è sempre; mentre è in corso si sa con quale codice.
ALTER TABLE public.ordini_sdg DROP CONSTRAINT IF EXISTS ordini_sdg_sito_solo_pronto;
ALTER TABLE public.ordini_sdg ADD CONSTRAINT ordini_sdg_sito_solo_pronto CHECK ((sito IS NOT NULL) = (sito_stato = 'pronto'));
ALTER TABLE public.ordini_sdg DROP CONSTRAINT IF EXISTS ordini_sdg_sito_in_corso_col_lavoro;
ALTER TABLE public.ordini_sdg ADD CONSTRAINT ordini_sdg_sito_in_corso_col_lavoro CHECK (sito_stato <> 'in_corso' OR lavoro_sito IS NOT NULL);
ALTER TABLE public.ordini_sdg DROP CONSTRAINT IF EXISTS ordini_sdg_analisi_solo_pronta;
ALTER TABLE public.ordini_sdg ADD CONSTRAINT ordini_sdg_analisi_solo_pronta CHECK ((analisi IS NOT NULL) = (analisi_stato = 'pronto'));
ALTER TABLE public.ordini_sdg DROP CONSTRAINT IF EXISTS ordini_sdg_analisi_in_corso_col_lavoro;
ALTER TABLE public.ordini_sdg ADD CONSTRAINT ordini_sdg_analisi_in_corso_col_lavoro CHECK (analisi_stato <> 'in_corso' OR lavoro_analisi IS NOT NULL);

CREATE INDEX IF NOT EXISTS ordini_sdg_in_attesa_di_sito_o_analisi ON public.ordini_sdg (creato_il)
  WHERE sito_stato = 'in_corso' OR analisi_stato = 'in_corso';

COMMENT ON COLUMN public.ordini_sdg.sito IS
  'La bozza del sito scritta dall AD all accettazione, con le pagine della fascia: senza prezzi, contatti o dati di Google, ogni testo da confermare. Non va online da sola. Migrazione 999h.';
COMMENT ON COLUMN public.ordini_sdg.analisi IS
  'Il rapporto del business all avvio scritto dall AD, con le parti della fascia e le regole legali del rapporto (niente dati di Google). Migrazione 999h.';

-- I permessi della 999c valgono per tutta la tabella, colonne nuove comprese: li si ridice, così rieseguirla li rimette.
REVOKE ALL ON public.ordini_sdg FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.ordini_sdg TO authenticated;
GRANT ALL ON public.ordini_sdg TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';

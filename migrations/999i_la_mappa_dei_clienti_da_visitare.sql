-- =============================================================================
-- 999i — La mappa dei clienti da visitare
-- =============================================================================
-- CHE COSA. Nicola, 28/11/2026: «la mappa deve visualizzarsi in 2 modi: 1) sulla mappa, 2) una lista che si può
-- ordinare, e un ordine è la priorità del cliente da contattare». Le attività entro 5 km da Pane Quotidiano che il
-- flusso n8n 16 («Attività da visitare») mette in fila ogni lunedì arrivano qui, TUTTE (circa 650), con la
-- posizione. Gli agenti le vedono in /agente/clienti: un puntino per attività sulla mappa, e la lista ordinabile.
-- Un agente tocca «Ci vado io» e il cliente diventa suo (gli altri lo vedono preso); lo può lasciare; dopo la
-- visita segna lo stato con una parola: visitata, si, no, iscritta. Nessuno assegna niente a mano.
-- «esclusa» (Nicola, 28/11 alle 02:45): riga tolta, non visitata. Non si mostra agli agenti e non conta come visitata.
--
-- UNA SOLA FONTE DI VERITÀ PER LO STATO: questa tabella. Il flusso 16 la rilegge il lunedì (GET della stessa porta)
-- per sapere chi è già proposto, preso o visitato, e per il conto del messaggio. La tabella n8n «Attività da
-- visitare» resta l'archivio delle settimane, ma lo stato non si scrive più a mano lì: alla prima volta che
-- un'attività arriva qui, lo stato scritto nella tabella n8n entra come stato di partenza (stato_iniziale), e poi
-- non conta più.
--
-- CHI SCRIVE COSA:
--   · i dati dell'attività (nome, tipo, posizione, punteggio, perché, dossier…) li scrive solo n8n, con la funzione
--     ricevi_clienti_da_visitare, dalla porta /api/agenzia/clienti-da-visitare (segreto N8N_CLIENTI_DA_VISITARE_SEGRETO);
--   · la prenotazione e lo stato li scrive solo il sito, dalle rotte /api/agente/clienti, per l'agente collegato.
--   La funzione di n8n non tocca mai prenotata_da, stato, stato_da, stato_il.
--
-- Nessuna regola per il browser: anon e authenticated non leggono e non scrivono niente (come agenti, 865).
-- Le rotte usano la chiave di servizio e controllano prima che chi chiede sia un agente attivo o l'admin.
-- Se un agente cancella il suo account, le sue prenotazioni tornano libere (ON DELETE SET NULL); gli stati restano.
--
-- Si puo' rieseguire. NON si applica a mano dall'AD: la applica Nicola col pulsante «Migrazioni a mano».
-- REVERSIBILE: DROP FUNCTION public.ricevi_clienti_da_visitare(jsonb, timestamptz); DROP TABLE public.clienti_da_visitare;
-- LA PROVA: tests/sql/rls/la-mappa-dei-clienti-la-leggono-solo-gli-agenti.test.sql.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.clienti_da_visitare (
  osm           text PRIMARY KEY CHECK (osm ~ '^(node|way|relation)/[0-9]{1,15}$'),
  nome          text NOT NULL CHECK (char_length(nome) BETWEEN 1 AND 200),
  tipo          text CHECK (tipo IS NULL OR char_length(tipo) <= 80),
  segmento      text CHECK (segmento IS NULL OR char_length(segmento) <= 60),
  indirizzo     text CHECK (indirizzo IS NULL OR char_length(indirizzo) <= 200),
  telefono      text CHECK (telefono IS NULL OR char_length(telefono) <= 40),
  sito          text CHECK (sito IS NULL OR char_length(sito) <= 300),
  lat           double precision CHECK (lat IS NULL OR lat BETWEEN -90 AND 90),
  lon           double precision CHECK (lon IS NULL OR lon BETWEEN -180 AND 180),
  distanza_m    integer CHECK (distanza_m IS NULL OR distanza_m BETWEEN 0 AND 100000),
  punteggio     numeric(6,1),
  perche        text CHECK (perche IS NULL OR char_length(perche) <= 400),
  offerta       text CHECK (offerta IS NULL OR char_length(offerta) <= 200),
  mappa         text CHECK (mappa IS NULL OR (char_length(mappa) <= 600 AND mappa LIKE 'https://www.google.com/maps/%')),
  dossier       text CHECK (dossier IS NULL OR char_length(dossier) <= 4000),
  -- Il lunedì in cui il flusso l’ha messa fra le prime 30 (col dossier dell'AD). NULL = mai proposta.
  settimana     date,
  -- È nella fila dell'ultimo giro letto bene. Una che ne esce (chiusa, ora su MyCity) resta, spenta.
  in_fila       boolean NOT NULL DEFAULT true,
  visto_il      timestamptz NOT NULL DEFAULT now(),
  creato_il     timestamptz NOT NULL DEFAULT now(),
  prenotata_da  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  prenotata_il  timestamptz,
  stato         text NOT NULL DEFAULT 'da_visitare' CHECK (stato IN ('da_visitare', 'visitata', 'si', 'no', 'iscritta', 'esclusa')),
  stato_da      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  stato_il      timestamptz
);

CREATE INDEX IF NOT EXISTS clienti_da_visitare_punteggio_idx ON public.clienti_da_visitare (punteggio DESC);
-- Ogni chiave esterna ha il suo indice (prova 14, «le porte di servizio sono chiuse»).
CREATE INDEX IF NOT EXISTS clienti_da_visitare_prenotata_da_idx ON public.clienti_da_visitare (prenotata_da);
CREATE INDEX IF NOT EXISTS clienti_da_visitare_stato_da_idx ON public.clienti_da_visitare (stato_da);

/**
 * Il giro del lunedì: n8n manda la fila intera. Per ogni attività aggiorna i dati che vengono dalla mappa e dal
 * flusso, e niente altro:
 *  · il dossier non si cancella se questa volta non c'è (lo scrive l’AD solo per le prime 30 della settimana);
 *  · la settimana resta la prima in cui è stata proposta;
 *  · stato_iniziale vale solo per un'attività nuova (il passaggio dalla tabella n8n): dopo, lo stato è del sito;
 *  · prenotazione e stato non si toccano mai.
 * Poi spegne (in_fila = false) quelle che in questo giro non c'erano. Restituisce quante righe ha ricevuto.
 * Il giro deve essere vicino ad adesso (la rotta accetta solo ±1 giorno): un giro nel futuro terrebbe accese per
 * sempre righe uscite dalla fila (collaudo del 28/11).
 * La chiama solo il server (chiave di servizio).
 */
CREATE OR REPLACE FUNCTION public.ricevi_clienti_da_visitare(p_righe jsonb, p_giro timestamptz)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE n integer;
BEGIN
  IF jsonb_typeof(p_righe) <> 'array' THEN RAISE EXCEPTION 'p_righe deve essere un elenco'; END IF;
  IF p_giro IS NULL OR p_giro > now() + interval '1 day' THEN RAISE EXCEPTION 'giro nel futuro: %', p_giro; END IF;
  INSERT INTO public.clienti_da_visitare AS t
    (osm, nome, tipo, segmento, indirizzo, telefono, sito, lat, lon, distanza_m, punteggio, perche, offerta, mappa,
     dossier, settimana, in_fila, visto_il, stato)
  SELECT r.osm, r.nome, NULLIF(r.tipo, ''), NULLIF(r.segmento, ''), NULLIF(r.indirizzo, ''), NULLIF(r.telefono, ''),
         NULLIF(r.sito, ''), r.lat, r.lon, r.distanza_m, r.punteggio, NULLIF(r.perche, ''), NULLIF(r.offerta, ''),
         NULLIF(r.mappa, ''), NULLIF(r.dossier, ''), r.settimana, true, p_giro,
         COALESCE(NULLIF(r.stato_iniziale, ''), 'da_visitare')
  FROM jsonb_to_recordset(p_righe) AS r(
    osm text, nome text, tipo text, segmento text, indirizzo text, telefono text, sito text, lat double precision,
    lon double precision, distanza_m integer, punteggio numeric, perche text, offerta text, mappa text, dossier text,
    settimana date, stato_iniziale text)
  ON CONFLICT (osm) DO UPDATE SET
    nome = EXCLUDED.nome, tipo = EXCLUDED.tipo, segmento = EXCLUDED.segmento, indirizzo = EXCLUDED.indirizzo,
    telefono = EXCLUDED.telefono, sito = EXCLUDED.sito,
    lat = COALESCE(EXCLUDED.lat, t.lat), lon = COALESCE(EXCLUDED.lon, t.lon),
    distanza_m = EXCLUDED.distanza_m, punteggio = EXCLUDED.punteggio, perche = EXCLUDED.perche,
    offerta = EXCLUDED.offerta, mappa = EXCLUDED.mappa,
    dossier = COALESCE(EXCLUDED.dossier, t.dossier),
    settimana = COALESCE(t.settimana, EXCLUDED.settimana),
    -- Un giro più vecchio dell'ultimo visto (un reinvio) aggiorna i dati ma non riaccende e non torna indietro.
    in_fila = CASE WHEN EXCLUDED.visto_il >= t.visto_il THEN true ELSE t.in_fila END,
    visto_il = GREATEST(t.visto_il, EXCLUDED.visto_il);
  GET DIAGNOSTICS n = ROW_COUNT;
  UPDATE public.clienti_da_visitare SET in_fila = false WHERE visto_il < p_giro AND in_fila;
  RETURN n;
END;
$$;

ALTER TABLE public.clienti_da_visitare ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.clienti_da_visitare FROM anon, authenticated;
GRANT ALL ON public.clienti_da_visitare TO service_role;

REVOKE ALL ON FUNCTION public.ricevi_clienti_da_visitare(jsonb, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ricevi_clienti_da_visitare(jsonb, timestamptz) TO service_role;

COMMENT ON TABLE public.clienti_da_visitare IS
  'Le attività da visitare (flusso n8n 16, tutta la fila) con la prenotazione dell agente e lo stato dopo la visita. Unica fonte dello stato. Solo dal server (migrazione 999i).';

COMMIT;

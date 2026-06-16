-- 092: Job AI massivi sul catalogo (Message Batches API Anthropic).
--
-- Le operazioni di massa sul catalogo (migliora / ri-descrivi / modera /
-- traduci TUTTI i prodotti) usano la Batch API: asincrona (fino a 24h) e -50%
-- sul token. Serve quindi PERSISTERE lo stato del job tra il submit e il
-- recupero dei risultati. Questa tabella traccia un job per richiesta.
--
-- Flusso: il venditore avvia un job (status 'processing', batch_id Anthropic)
-- → il polling recupera i risultati e li salva in `results` (status 'ready')
-- → il venditore rivede e applica (status 'applied'). Scrittura solo lato
-- server (service role); RLS consente al venditore di LEGGERE i propri job.
--
-- Idempotente.

CREATE TABLE IF NOT EXISTS public.catalog_ai_jobs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Operazione richiesta sull'intero catalogo.
  operation   text NOT NULL CHECK (operation IN ('improve','redescribe','moderate','translate')),
  status      text NOT NULL DEFAULT 'processing'
                CHECK (status IN ('processing','ready','applied','error','canceled')),
  -- ID del batch lato Anthropic (per il polling).
  batch_id    text,
  -- Lingua di destinazione (solo per operation='translate').
  target_lang text,
  -- Numero di prodotti inclusi nel job.
  total       integer NOT NULL DEFAULT 0,
  -- Risultati per prodotto: [{ product_id, patch?, summary?, flagged?, reason? }].
  results     jsonb NOT NULL DEFAULT '[]'::jsonb,
  error       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS catalog_ai_jobs_seller_idx
  ON public.catalog_ai_jobs(seller_id, created_at DESC);

-- RLS: il venditore LEGGE solo i propri job. La scrittura è esclusiva del
-- server (service role, che bypassa la RLS): nessuna policy di insert/update
-- per i client autenticati.
ALTER TABLE public.catalog_ai_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS catalog_ai_jobs_select ON public.catalog_ai_jobs;
CREATE POLICY catalog_ai_jobs_select ON public.catalog_ai_jobs
  FOR SELECT USING (seller_id = auth.uid());

GRANT SELECT ON public.catalog_ai_jobs TO authenticated;

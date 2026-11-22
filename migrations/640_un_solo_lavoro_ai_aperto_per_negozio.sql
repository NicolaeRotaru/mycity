-- =============================================================================
-- 640 — Un solo lavoro AI sul catalogo aperto per negozio (R02-004 · R02-013)
-- =============================================================================
-- La rotta di avvio (app/api/ai/catalog-batch/start/route.ts) controlla «c'è già
-- un lavoro aperto?» con una lettura, e poi inserisce la riga del lavoro nuovo.
-- Due avvii nello stesso istante (doppio tocco, due schede, due telefoni)
-- leggevano tutti e due «nessun lavoro aperto», inserivano tutti e due, e
-- partivano due lotti pagati. La lettura in fila con l'inserimento non basta:
-- serve il database.
--
-- La regola: per ogni negozio al massimo UN lavoro aperto. Aperti sono gli
-- stati che la rotta di avvio considera aperti (STATI_APERTI in
-- start/route.ts): 'submitting' (in invio), 'processing' (in corso), 'ready'
-- (pronto da rivedere). Un lavoro chiuso ('applied', 'canceled', 'error',
-- 'failed') non ferma niente: se ne possono avere quanti si vuole accanto a
-- quello aperto. Il secondo inserimento della gara riceve 23505 e la rotta
-- risponde 409 «hai già un lavoro aperto».
--
-- I DOPPIONI CHE CI SONO GIÀ. Se un negozio ha già più lavori aperti (nati dalla
-- gara), l'indice non si potrebbe creare. Ne resta aperto UNO, scelto per quanto
-- vale (22/11, giro di correzione: prima restava il più recente, anche quando
-- era un invio incerto senza lotto, e si chiudeva un lotto in corso o dei
-- risultati già pagati): prima un 'ready' (risultati pronti da rivedere), poi
-- un 'processing' col suo batch_id (lotto partito), poi il resto; a parità, il
-- più recente. Gli altri si chiudono come 'canceled', col motivo davanti a
-- quello che avevano. Non si cancella niente: batch_id e risultati restano sulla
-- riga, e un lotto già pagato si recupera con l'assistenza. Per vederli prima:
--   SELECT seller_id, count(*) FROM public.catalog_ai_jobs
--    WHERE status IN ('submitting','processing','ready')
--    GROUP BY seller_id HAVING count(*) > 1;
-- Il lucchetto sulla tabella tiene fuori i lavori nuovi fra la chiusura dei
-- doppioni e la nascita dell'indice.
--
-- Se public.catalog_ai_jobs non c'è (un database dove la 099 non è passata),
-- la migrazione non fa niente e non fallisce.
--
-- Prova: tests/sql/rls/riparazione-r02-un-solo-lavoro-aperto.test.sql
-- Per tornare indietro (le righe chiuse restano chiuse):
--   DROP INDEX IF EXISTS public.catalog_ai_jobs_un_lavoro_aperto_per_negozio;
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.catalog_ai_jobs') IS NULL THEN
    RAISE NOTICE '640: public.catalog_ai_jobs non c''è, niente da fare';
    RETURN;
  END IF;

  EXECUTE 'LOCK TABLE public.catalog_ai_jobs IN SHARE ROW EXCLUSIVE MODE';

  EXECUTE $sql$
    WITH in_fila AS (
      SELECT id,
             row_number() OVER (
               PARTITION BY seller_id
               ORDER BY CASE
                          WHEN status = 'ready' THEN 0
                          WHEN status = 'processing' AND batch_id IS NOT NULL THEN 1
                          ELSE 2
                        END,
                        created_at DESC,
                        id DESC
             ) AS posto
        FROM public.catalog_ai_jobs
       WHERE status IN ('submitting', 'processing', 'ready')
    )
    UPDATE public.catalog_ai_jobs AS j
       SET status = 'canceled',
           error = 'chiuso dalla migrazione 640: lo stesso negozio aveva un altro lavoro aperto, tenuto al posto di questo. '
                   || 'Lotto e risultati restano su questa riga: se serve, si recuperano con l''assistenza.'
                   || coalesce(' Motivo di prima: ' || j.error, ''),
           updated_at = now()
      FROM in_fila
     WHERE in_fila.id = j.id
       AND in_fila.posto > 1
  $sql$;

  EXECUTE $sql$
    CREATE UNIQUE INDEX IF NOT EXISTS catalog_ai_jobs_un_lavoro_aperto_per_negozio
      ON public.catalog_ai_jobs (seller_id)
      WHERE status IN ('submitting', 'processing', 'ready')
  $sql$;
END $$;

COMMIT;

-- 999m (R02-003) — Il segno di fine dell'applicazione di un lavoro AI sul catalogo.
--
-- /api/ai/catalog-batch/apply segna il lavoro «applied» quando comincia e lo
-- rimette «ready» se un guasto di passaggio lo lascia ripetibile. Se in mezzo
-- nasce un lavoro nuovo, l'indice della 640 (un solo lavoro aperto per negozio)
-- rifiuta il ritorno a «ready» e il lavoro pagato resta chiuso. Per questo
-- /api/ai/catalog-batch/start aspetta finche' l'ultimo lavoro «applied» non ha
-- il segno di fine ed e' di meno di 120 secondi (R13-001, R02-004).
--
-- La colonna del segno non l'aveva creata nessuna migrazione: l'avvio la
-- leggeva (e ripiegava senza), /apply non la scriveva, e ogni avvio dopo
-- un'applicazione finita aspettava due minuti per niente. Adesso /apply la
-- scrive quando il lavoro resta «applied» per sempre (applicazione finita, o
-- lavoro non piu' rimettibile «ready»). Finche' questa migrazione non e'
-- applicata quella scrittura fallisce senza conseguenze e l'avvio aspetta i
-- 120 secondi come prima. Idempotente.

BEGIN;

ALTER TABLE public.catalog_ai_jobs
  ADD COLUMN IF NOT EXISTS applicazione_finita_il timestamptz;

COMMENT ON COLUMN public.catalog_ai_jobs.applicazione_finita_il IS
  'Quando /apply ha finito di applicare il lavoro (che resta applied). NULL mentre si applica o se non e'' mai stato applicato: l''avvio di un lavoro nuovo aspetta al massimo 120 s da updated_at.';

COMMIT;

NOTIFY pgrst, 'reload schema';

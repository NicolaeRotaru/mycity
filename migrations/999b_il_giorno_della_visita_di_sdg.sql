-- 999b — Il giorno in cui SDG passa dal titolare, scelto nel link del preventivo (27/11/2026).
--
-- Il numero è 999b, non 1000: le migrazioni si applicano in ordine byte per byte (LC_ALL=C), e «1000_» verrebbe prima di «100_».
--
-- Nicola, 27/11/2026 verso le 17:40: nella pagina del link dove il titolare conferma l'abbonamento e
-- l'email «deve esserci anche il calendario in cui deve selezionare il giorno e l'ora in cui deve passare
-- il team creativo», per scrivere il piano editoriale e fare subito foto e video.
--
-- La scelta si salva sul preventivo, nello stesso momento in cui diventa «accettato»
-- (lib/agenzia/preventivo-col-codice.ts). I giorni e le ore li calcola il server (lib/agenzia/visita-sdg.ts).
--  · `visita_il`: l'inizio della visita (istante; si legge sull'ora di Piacenza);
--  · due attività non possono avere la stessa ora: indice unico sulle visite fissate.
-- Lo scrive e lo legge solo il server (service_role), come il resto della tabella (708).
--
-- Finché la 999b non è nel database il sito non si rompe: il preventivo si accetta lo stesso e il giorno
-- scelto arriva a Nicola nell'avviso e al titolare nell'email.
--
-- Si può rieseguire. NON si applica da sola: la applica Nicola, come ogni migrazione.
-- REVERSIBILE (si perdono i giorni fissati):
--   DROP INDEX IF EXISTS public.preventivi_con_codice_una_visita_per_ora;
--   ALTER TABLE public.preventivi_con_codice DROP COLUMN IF EXISTS visita_il;
-- LA PROVA: tests/sql/harness/999b-il-giorno-della-visita-di-sdg.sh

BEGIN;

ALTER TABLE public.preventivi_con_codice
  ADD COLUMN IF NOT EXISTS visita_il timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS preventivi_con_codice_una_visita_per_ora
  ON public.preventivi_con_codice (visita_il)
  WHERE visita_il IS NOT NULL;

COMMENT ON COLUMN public.preventivi_con_codice.visita_il IS
  'Quando il team creativo di SDG passa dal titolare (piano editoriale, foto e video), scelto nel link del preventivo. Una sola attività per ora (migrazione 999b).';

COMMIT;

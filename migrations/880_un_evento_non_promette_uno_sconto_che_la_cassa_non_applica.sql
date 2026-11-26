-- Un evento non promette uno sconto che la cassa non applica.
--
-- IL DIFETTO. La pagina pubblica degli eventi (app/events/page.tsx) mostra «-{discount_percent}%» sulla
-- copertina di ogni evento che ha uno sconto salvato in marketplace_events.discount_percent. Nessun
-- calcolo del prezzo legge quella tabella (lib/ordini/prezzi.ts, carrello, cassa e ordini no): il
-- cliente vedeva «-20%», comprava e pagava il prezzo pieno. Dal 12/11 il modulo /admin/events non
-- chiede piu' lo sconto e salva sempre vuoto, ma il database lo accettava ancora: gli eventi salvati
-- prima restavano col loro «-20%» in vetrina, e una scrittura diretta coi permessi dell'amministratore
-- ne metteva uno nuovo (il vincolo della 034 ammetteva da 0 a 80).
--
-- LA CURA. Gli sconti gia' salvati sugli eventi si tolgono (nessuno li ha mai pagati), e un vincolo
-- CHECK tiene discount_percent sempre vuoto: un evento con uno sconto non si crea e non si modifica.
-- L'errore e' 23514 (check_violation). Il pannello non se ne accorge: scrive gia' NULL.
--
-- PERCHE' UN CHECK E NON UN TRIGGER. Qui non ci sono righe vecchie da lasciare com'erano: lo sconto
-- vecchio e' proprio il difetto. Tolto prima, il vincolo nasce gia' convalidato (la casa vieta i
-- NOT VALID, tests/sql/rls/14-le-porte-di-servizio-sono-chiuse.test.sql) e vale per ogni scrittura.
--
-- Prima di applicarla, per vedere quali eventi perdono il badge:
--   SELECT id, title, status, discount_percent FROM public.marketplace_events WHERE discount_percent IS NOT NULL;
--
-- PER RIACCENDERE uno sconto sugli eventi: prima una regola di prezzo che lo applichi in scheda,
-- carrello, cassa e ordine (lib/ordini/prezzi.ts), poi una migrazione che toglie questo vincolo.
--
-- Si puo' rieseguire. NON si applica a mano: lo decide Nicola, come ogni migrazione.
-- REVERSIBILE (il vincolo; gli sconti tolti non tornano):
--   ALTER TABLE public.marketplace_events DROP CONSTRAINT IF EXISTS marketplace_events_niente_sconto_senza_cassa;
-- LA PROVA: tests/sql/rls/riparazione-r02-niente-sconto-sugli-eventi.test.sql.

UPDATE public.marketplace_events
   SET discount_percent = NULL
 WHERE discount_percent IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'marketplace_events_niente_sconto_senza_cassa'
       AND conrelid = 'public.marketplace_events'::regclass
  ) THEN
    ALTER TABLE public.marketplace_events
      ADD CONSTRAINT marketplace_events_niente_sconto_senza_cassa CHECK (discount_percent IS NULL);
  END IF;
END $$;

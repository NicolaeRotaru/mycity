-- =========================================================
-- IL CONTO DELLA SPESA AI NON ESISTE IN PRODUZIONE, E IL TETTO VALE PER COPIA
-- =========================================================
-- 8/9/2026 (lotto gravi, corsia 11).
--
-- COSA SUCCEDE OGGI, NON IN TEORIA. La migrazione 131 ha creato la casa del
-- conto condiviso della spesa AI: la tabella `ai_spend_daily` e le due funzioni
-- `registra_spesa_ai` / `spesa_ai_di_oggi`. In produzione non c'e' niente di
-- tutto questo:
--
--     select 1 from pg_proc where proname = 'spesa_ai_di_oggi';   -- 0 righe
--
-- Il codice, che quel conto lo cerca a ogni chiamata al modello, si sente
-- rispondere «questa funzione non esiste», ripiega sul contatore in memoria
-- della singola copia della funzione serverless e va avanti. Risultato:
-- `AI_GLOBAL_DAILY_BUDGET_EUR = 20` vuol dire venti euro PER COPIA. Con tre
-- copie in aria il tetto vale sessanta, e la prima notizia arriva con la
-- fattura di fine mese.
--
-- PERCHE' LA 131 NON E' MAI ARRIVATA IN PRODUZIONE, E PERCHE' SERVE QUESTA.
-- Il registro delle migrazioni della produzione (`supabase_migrations.
-- schema_migrations`) e' nato PRIMA della cartella `migrations/`: ha novanta
-- righe con versioni a timestamp, e non conosce nemmeno la 001. Per questo
-- `scripts/applica-migrazioni-mancanti.sh` si ferma di proposito prima di
-- toccare qualsiasi cosa (ci sono CREATE senza IF NOT EXISTS che esploderebbero
-- sulla 001) e rimanda alla procedura di baseline in
-- docs/migrazioni-baseline-produzione.md. La 131 e' rimasta la' dentro insieme
-- alle altre.
--
-- Questo file e' la STESSA casa, riscritta in modo che si possa applicare da
-- sola e due volte di fila senza rompere niente: IF NOT EXISTS sulla tabella,
-- CREATE OR REPLACE sulle funzioni. Cosi' non dipende dal fatto che la 131 sia
-- passata o no — che e' esattamente il dubbio che oggi nessuno sa sciogliere.
--
-- COSA NON RISOLVE. Applicare questo file NON e' un lavoro che si fa da solo:
-- la strada automatica e' ferma per il baseline mancante. Va lanciato a mano
-- contro il database di produzione, ed e' una firma di Nicola (🔴). Finche' non
-- succede, il codice si difende da solo: `lib/ai/decisioneTettoSpesa.ts` divide
-- il tetto per le copie attese quando si accorge che il conto in comune non
-- c'e', e `allarmiTettoSpesaAi` accende la spia. Il freno non e' piu' di carta,
-- ma resta piu' stretto del dovuto finche' questa tabella non esiste.
--
-- PROVATO DAVVERO (8/9/2026, Postgres 16 locale):
--   · su `mycity_lotto`, che ha gia' la 131 applicata → passa e non cambia nulla;
--   · su un database vuoto con le sole tre parti Supabase (anon, authenticated,
--     service_role) → crea tutto e le due funzioni rispondono;
--   · applicato due volte di fila → la seconda e' un no-op;
--   · due sessioni che registrano nello stesso istante → il totale SOMMA.
--
-- La tabella non contiene dati di nessuna persona: solo una data e un numero.
-- Nessuno la legge dal browser — RLS accesa e nessuna policy, cosi' passa solo
-- il service role.
--
-- TUTTO DENTRO UNA TRANSAZIONE, E NON E' UN VEZZO.
-- Fra la riga che CREA `registra_spesa_ai` e la riga che le toglie il permesso
-- a `anon` c'erano ventotto righe di file — la 69 e la 97, nella versione con
-- cui questo file e' nato. Senza BEGIN ogni istruzione si salva da sola: se
-- il collegamento cade li' in mezzo — rete, ctrl-C, timeout del pooler —
-- resta committata una funzione SECURITY DEFINER (gira coi
-- permessi del proprietario) che chiunque, dal browser e senza account, puo'
-- chiamare. E la prima cosa che scrive e' il freno di spesa dell'AI.
--
-- Non e' teorico: provato l'8/9/2026 su Postgres 16, su un database senza la
-- 131 (cioe' com'e' la produzione). Interrotto il file dopo la creazione della
-- funzione, `anon` ha scritto 99.999.999 centesimi nel conto di oggi e ha
-- spento il modello per tutti. Rieseguendo poi il file INTERO il permesso si
-- chiude, ma quei centesimi restano dentro: il danno non torna indietro da
-- solo, va tolto a mano.
--
-- Con BEGIN/COMMIT le due cose diventano una sola: o esiste la funzione GIA'
-- chiusa, o non esiste niente. Nessuna finestra, nemmeno di un millisecondo.
-- Vale anche se chi la lancia dimentica `ON_ERROR_STOP`: a transazione
-- abortita, il COMMIT finale si comporta da ROLLBACK.

BEGIN;

CREATE TABLE IF NOT EXISTS public.ai_spend_daily (
  giorno      date PRIMARY KEY,
  cents       bigint NOT NULL DEFAULT 0 CHECK (cents >= 0),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.ai_spend_daily IS
  'Quanto è uscito verso il fornitore AI in un giorno di calendario (Europe/Rome), sommando tutte le copie della funzione. È il freno di spesa: senza questa riga condivisa il tetto vale per copia, cioè non vale.';

ALTER TABLE public.ai_spend_daily ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_spend_daily FROM PUBLIC, anon, authenticated;

-- Aggiunge la spesa al giorno e restituisce il totale aggiornato. Una sola
-- istruzione: due copie che spendono nello stesso istante sommano invece di
-- sovrascriversi.
CREATE OR REPLACE FUNCTION public.registra_spesa_ai(p_giorno date, p_cents bigint)
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.ai_spend_daily AS a (giorno, cents, updated_at)
  VALUES (p_giorno, GREATEST(p_cents, 0), now())
  ON CONFLICT (giorno) DO UPDATE
    SET cents = a.cents + GREATEST(EXCLUDED.cents, 0),
        updated_at = now()
  RETURNING cents;
$$;

-- Quanto è già uscito oggi. Zero se il giorno non ha ancora una riga.
CREATE OR REPLACE FUNCTION public.spesa_ai_di_oggi(p_giorno date)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT cents FROM public.ai_spend_daily WHERE giorno = p_giorno), 0);
$$;

-- I due rubinetti sono due: PUBLIC (che Postgres apre da solo su ogni funzione
-- nuova) e anon (che i privilegi di default di Supabase aprono). Si chiudono
-- tutti e due, o non si e' chiuso niente — è la lezione della migrazione 151.
REVOKE ALL ON FUNCTION public.registra_spesa_ai(date, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.spesa_ai_di_oggi(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registra_spesa_ai(date, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.spesa_ai_di_oggi(date) TO service_role;

COMMIT;

-- =========================================================
-- RITORNO INDIETRO (rollback)
-- =========================================================
-- SE SI E' FERMATA A META': non c'e' niente da fare. La transazione cade
-- tutta e il database e' rimasto identico a prima. Si rilancia e basta.
--
-- SE E' PASSATA e si vuole tornare indietro davvero, prima si guarda se la
-- casa c'era gia' (cioe' se la 131 era stata applicata in passato):
--
--   SELECT count(*) FROM public.ai_spend_daily;
--
--   · Righe > 0, oppure non si sa → NON si droppa niente. La tabella e' il
--     conto della spesa vera: buttarla vuol dire perdere il freno e ripartire
--     da zero, cioe' spendere due volte il tetto di oggi. Il ritorno indietro
--     onesto qui e' NON tornare indietro.
--   · Tabella vuota e certezza che prima non esisteva (produzione, dove
--     `SELECT 1 FROM pg_proc WHERE proname='spesa_ai_di_oggi'` dava 0 righe):
--     allora si toglie tutto, in questo ordine e in transazione:
--
--       BEGIN;
--       DROP FUNCTION IF EXISTS public.registra_spesa_ai(date, bigint);
--       DROP FUNCTION IF EXISTS public.spesa_ai_di_oggi(date);
--       DROP TABLE IF EXISTS public.ai_spend_daily;
--       COMMIT;
--
--     Il codice regge il ritorno indietro: `lib/ai/decisioneTettoSpesa.ts` si
--     accorge che il conto in comune non c'e' e divide il tetto per le copie
--     attese — piu' stretto del dovuto, ma non rotto.
-- =========================================================

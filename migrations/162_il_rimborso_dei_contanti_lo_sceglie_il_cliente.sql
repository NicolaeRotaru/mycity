-- Chi paga in contanti e restituisce un prodotto riceveva d'ufficio credito MyCity invece dei soldi,
-- senza che nessuno gli chiedesse se lo voleva.
--
-- IL DIFETTO (radiografia dell'11/10/2026, R71). L'articolo 56 del Codice del Consumo vuole il
-- rimborso del recesso con lo stesso mezzo usato per pagare, salvo che il consumatore abbia
-- «espressamente convenuto altrimenti». Quando il negozio approvava un reso su un ordine in contanti,
-- `refundOrder` accreditava il portafoglio MyCity e basta: il modulo di reso non chiedeva niente, e
-- la tabella dei resi non aveva nemmeno dove scrivere una risposta. Il cliente che restituiva un
-- maglione da 40 € pagato al fattorino si trovava 40 € di credito, spendibili solo con un altro
-- ordine in contanti.
--
-- COSA FA QUESTA MIGRAZIONE, in tre mosse.
--
-- ① IL RESO RICORDA LA SCELTA. Due colonne: `refund_method` («BONIFICO» o «CREDITO») e
--    `refund_iban`, il conto su cui fare il bonifico. Vuote vuol dire «nessuna scelta», e nessuna
--    scelta vuol dire bonifico: il credito arriva solo a chi l'ha scelto. `refund_bonifico_cents`
--    dice quanto del rimborso va col bonifico (su un ordine pagato in parte col credito MyCity, la
--    parte del credito torna credito). `refund_bonifico_fatto_at` la scrive chi amministra quando
--    il bonifico e' partito: e' la riga che toglie il reso dalla lista dei bonifici da fare.
--
-- ② LE COLONNE DICONO SOLO COSE VERE. Il modo e' uno dei due; l'IBAN c'e' solo col bonifico ed e'
--    scritto in forma pulita (paese, due cifre di controllo, poi lettere e cifre maiuscole). Il
--    controllo della forma completa — lunghezza del paese e cifre di controllo — lo fa il server
--    prima di scrivere (`lib/rimborsi/scelta-del-cliente.ts`); qui c'e' il paletto che non dipende
--    da nessun codice.
--
-- ③ L'IBAN LO LEGGE SOLO IL SERVER. Un IBAN e' un dato personale, e a pagare il bonifico e' MyCity,
--    non il negozio. Ma la regola di lettura dei resi (`returns_seller_read`, migrazione 024) fa
--    vedere al negozio la riga INTERA: con la sola regola, il negozio leggeva anche il conto del
--    cliente. Le regole di riga non nascondono colonne; i permessi sulle colonne si'. Si toglie
--    quindi il permesso di lettura sulla tabella ai ruoli del browser e lo si ridà colonna per
--    colonna, tutte tranne `refund_iban`. Il server (chiave di servizio) legge come prima.
--
--    Nota per chi aggiunge una colonna ai resi domani: nasce chiusa al browser. Se la pagina del
--    negozio o del cliente la deve leggere, va concessa con un `GRANT SELECT (colonna)` esplicito.
--    E' il verso giusto in cui sbagliare: una colonna che manca si vede subito, una che avanza no.
--
-- COSA NON TOCCA. Le regole di riga: il cliente vede i suoi resi, il negozio i suoi,
-- l'amministratore tutti — solo, senza l'IBAN. Le scritture: restano del solo server (153).
--
-- SE NICOLA NON LA APPLICA: il codice regge da solo. Il modulo di reso apre il reso lo stesso,
-- senza la scelta, e lo dice al cliente; il rimborso di un ordine in contanti va col bonifico,
-- chiedendo l'IBAN al cliente; la lista dei bonifici da fare si vede, senza IBAN e senza il
-- pulsante «fatto». Quello che manca e' la scelta del credito: finche' la 162 non c'e', nessuno
-- riceve credito al posto dei soldi — che e' il verso giusto.
--
-- IDEMPOTENTE: si puo' applicare due volte di fila.
--
-- REVERSIBILE:
--   GRANT SELECT ON public.returns TO authenticated;
--   ALTER TABLE public.returns DROP CONSTRAINT IF EXISTS returns_refund_bonifico_cents_check;
--   ALTER TABLE public.returns DROP CONSTRAINT IF EXISTS returns_refund_iban_check;
--   ALTER TABLE public.returns DROP CONSTRAINT IF EXISTS returns_refund_method_check;
--   ALTER TABLE public.returns DROP COLUMN IF EXISTS refund_bonifico_fatto_at;
--   ALTER TABLE public.returns DROP COLUMN IF EXISTS refund_bonifico_cents;
--   ALTER TABLE public.returns DROP COLUMN IF EXISTS refund_iban;
--   ALTER TABLE public.returns DROP COLUMN IF EXISTS refund_method;
-- (togliere le colonne cancella gli IBAN gia' raccolti: prima si fanno i bonifici in sospeso.)
--
-- LA PROVA: tests/sql/rls/40-l-iban-del-reso-lo-legge-solo-chi-paga.test.sql

BEGIN;

-- ① il reso ricorda la scelta
ALTER TABLE public.returns ADD COLUMN IF NOT EXISTS refund_method text;
ALTER TABLE public.returns ADD COLUMN IF NOT EXISTS refund_iban text;
ALTER TABLE public.returns ADD COLUMN IF NOT EXISTS refund_bonifico_cents integer;
ALTER TABLE public.returns ADD COLUMN IF NOT EXISTS refund_bonifico_fatto_at timestamptz;

COMMENT ON COLUMN public.returns.refund_method IS
  'Come il cliente vuole il rimborso di un ordine pagato in contanti: BONIFICO o CREDITO. NULL = nessuna scelta = bonifico (art. 56 Codice del Consumo: il credito solo se scelto).';
COMMENT ON COLUMN public.returns.refund_iban IS
  'IBAN per il bonifico di rimborso, solo con refund_method = BONIFICO. Dato personale: lo legge solo il server (nessun permesso ai ruoli del browser).';
COMMENT ON COLUMN public.returns.refund_bonifico_cents IS
  'Quanto del rimborso va pagato col bonifico, in centesimi. Su un ordine pagato in parte col credito MyCity la parte del credito torna credito: questo e'' solo il resto.';
COMMENT ON COLUMN public.returns.refund_bonifico_fatto_at IS
  'Quando chi amministra ha fatto il bonifico di rimborso. NULL su un reso rimborsato col bonifico = bonifico ancora da fare.';

-- ② le colonne dicono solo cose vere
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'returns_refund_method_check'
                    AND conrelid = 'public.returns'::regclass) THEN
    ALTER TABLE public.returns
      ADD CONSTRAINT returns_refund_method_check
      CHECK (refund_method IS NULL OR refund_method IN ('BONIFICO', 'CREDITO'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'returns_refund_iban_check'
                    AND conrelid = 'public.returns'::regclass) THEN
    ALTER TABLE public.returns
      ADD CONSTRAINT returns_refund_iban_check
      CHECK (refund_iban IS NULL
             OR (refund_method = 'BONIFICO' AND refund_iban ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'returns_refund_bonifico_cents_check'
                    AND conrelid = 'public.returns'::regclass) THEN
    ALTER TABLE public.returns
      ADD CONSTRAINT returns_refund_bonifico_cents_check
      CHECK (refund_bonifico_cents IS NULL OR refund_bonifico_cents >= 0);
  END IF;
END $$;

-- ③ l'IBAN lo legge solo il server
DO $$
DECLARE
  v_colonne text;
BEGIN
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
    INTO v_colonne
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'returns'
     AND column_name <> 'refund_iban';

  EXECUTE 'REVOKE SELECT ON public.returns FROM anon, authenticated';
  -- Una concessione per colonna data in passato all'IBAN non resterebbe tolta dalla revoca sulla
  -- tabella: si toglie esplicitamente.
  EXECUTE 'REVOKE SELECT (refund_iban) ON public.returns FROM anon, authenticated';
  EXECUTE format('GRANT SELECT (%s) ON public.returns TO authenticated', v_colonne);
END $$;

-- Il controllo in fondo: se una mossa non e' andata a segno, la migrazione si ferma invece di
-- lasciare un IBAN leggibile dal negozio.
DO $$
BEGIN
  IF has_column_privilege('authenticated', 'public.returns', 'refund_iban', 'SELECT') THEN
    RAISE EXCEPTION '162: il browser legge ancora l''IBAN dei resi';
  END IF;
  IF NOT has_column_privilege('authenticated', 'public.returns', 'status', 'SELECT') THEN
    RAISE EXCEPTION '162: il browser non legge piu'' lo stato dei resi';
  END IF;
  IF has_column_privilege('anon', 'public.returns', 'id', 'SELECT') THEN
    RAISE EXCEPTION '162: chi non ha fatto l''accesso legge ancora i resi';
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';

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
-- COSA FA QUESTA MIGRAZIONE, in quattro mosse.
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
--    L'ELENCO E' SCRITTO QUI, A MANO. (Riesame del 16/10.) La prima versione lo calcolava al
--    momento — «tutte le colonne dei resi tranne l'IBAN» — e la promessa qui sopra reggeva solo
--    finche' la 162 non veniva rieseguita: una colonna privata nata dopo, rieseguendo la 162 in un
--    ripasso (come quello dal 003 al 079 del 9 settembre, raccontato nella 161), si apriva al
--    browser. Adesso si concedono solo le colonne di questo elenco che esistono: una colonna nata
--    dopo non c'e', e la revoca sulla tabella toglie anche i permessi per colonna dati dopo —
--    rieseguire la 162 chiude, non apre. Il controllo in fondo ferma la migrazione se il browser
--    legge una colonna fuori dall'elenco.
--
-- ③bis L'IBAN SI TIENE SOLO FINCHE' IL BONIFICO E' DA FARE. (Riesame del 16/10.) Rimborsare e' un
--    obbligo di legge, e per farlo serve il conto: e' l'unica ragione per tenerlo. Fatto il
--    bonifico, l'IBAN si cancella (lo fa chi segna «fatto»: `app/api/admin/rimborsi-da-bonificare`),
--    e qui c'e' il paletto che non dipende da nessun codice — un bonifico segnato fatto con
--    l'IBAN ancora scritto non entra. Se il cliente cancella l'account mentre gli dobbiamo ancora
--    un bonifico, sul reso (e sul bonifico del reclamo) restano solo l'IBAN e il nome
--    dell'intestatario, `refund_intestatario` / `intestatario`, fino al pagamento: la riga ordine
--    a quel punto non porta piu' il nome, e senza un nome il bonifico non si fa. Chi decide cosa
--    resta e' `lib/rimborsi/iban-del-rimborso.ts`; l'intestatario lo legge solo il server, come
--    l'IBAN.
--
-- ④ I BONIFICI DEI RECLAMI HANNO UNA LISTA. (Aggiunto dopo il collaudo del 15/10.) Anche un
--    reclamo chiuso a favore del cliente su un ordine in contanti si rimborsa col bonifico. Il
--    reso ricorda il suo bonifico nelle colonne qui sopra; il reclamo non aveva dove scriverlo, e
--    l'unica traccia era l'avviso nella campanella di chi amministra: perso l'avviso, il cliente
--    aspettava un bonifico che nessuno vedeva. Nasce `bonifici_dei_reclami`, una riga per reclamo
--    rimborsato col bonifico, che la stessa lista dei bonifici da fare legge.
--    Perche' una tabella a parte e non due colonne su `disputes`: la regola di inserimento dei
--    reclami (063) lascia al cliente scrivere la riga intera, stato compreso. Una colonna «bonifico
--    da fare» su quella riga la poteva riempire lui, e la lista l'avrebbe mostrata a chi paga. Qui
--    scrive e legge solo il server: regole di riga accese, nessuna regola, nessun permesso ai
--    ruoli del browser.
--    La riga NON e' legata al reclamo con una chiave esterna. (Secondo giro di collaudo del
--    15/10.) Con `REFERENCES disputes ON DELETE CASCADE` bastava che il cliente cancellasse
--    l'account: `disputes.opener_id` va a `profiles` con ON DELETE CASCADE, il reclamo spariva e con
--    lui il bonifico che gli dovevamo — dalla lista di chi paga, in silenzio. Un debito non si
--    cancella perche' il creditore se ne va: i resi restano (buyer_id va a SET NULL, 122), e cosi'
--    resta questa riga. Il controllo in fondo ferma la migrazione se una chiave che cancella a
--    cascata ricompare.
--    E LA RIGA DICE A CHI PAGARE. (Riesame del 16/10.) Tenere in vita la riga non bastava: col
--    cliente se ne andavano reclamo, profilo e nome sull'ordine, e restava «24 € da fare» senza
--    nessun dato che portasse a lui. Il modulo del reclamo non chiede l'IBAN: lo chiediamo per
--    email e il cliente ce lo manda con un messaggio dalla pagina Contatti; chi paga lo copia qui,
--    in `iban`. Se il cliente cancella l'account prima del pagamento, la cancellazione scrive qui
--    il suo nome, in `intestatario`. Tutti e due si cancellano quando il bonifico e' fatto.
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
--   DROP TABLE IF EXISTS public.bonifici_dei_reclami;   (prima si fanno i bonifici in sospeso)
--   GRANT SELECT ON public.returns TO authenticated;
--   ALTER TABLE public.returns DROP CONSTRAINT IF EXISTS returns_iban_solo_finche_il_bonifico_e_da_fare;
--   ALTER TABLE public.returns DROP COLUMN IF EXISTS refund_intestatario;
--   ALTER TABLE public.returns DROP CONSTRAINT IF EXISTS returns_refund_bonifico_cents_check;
--   ALTER TABLE public.returns DROP CONSTRAINT IF EXISTS returns_refund_iban_check;
--   ALTER TABLE public.returns DROP CONSTRAINT IF EXISTS returns_refund_method_check;
--   ALTER TABLE public.returns DROP COLUMN IF EXISTS refund_bonifico_fatto_at;
--   ALTER TABLE public.returns DROP COLUMN IF EXISTS refund_bonifico_cents;
--   ALTER TABLE public.returns DROP COLUMN IF EXISTS refund_iban;
--   ALTER TABLE public.returns DROP COLUMN IF EXISTS refund_method;
-- (togliere le colonne cancella gli IBAN gia' raccolti: prima si fanno i bonifici in sospeso.)
--
-- LE PROVE: tests/sql/rls/40-l-iban-del-reso-lo-legge-solo-chi-paga.test.sql
--            tests/sql/rls/41-i-bonifici-dei-reclami-li-tocca-solo-il-server.test.sql

BEGIN;

-- ① il reso ricorda la scelta
ALTER TABLE public.returns ADD COLUMN IF NOT EXISTS refund_method text;
ALTER TABLE public.returns ADD COLUMN IF NOT EXISTS refund_iban text;
ALTER TABLE public.returns ADD COLUMN IF NOT EXISTS refund_bonifico_cents integer;
ALTER TABLE public.returns ADD COLUMN IF NOT EXISTS refund_bonifico_fatto_at timestamptz;
ALTER TABLE public.returns ADD COLUMN IF NOT EXISTS refund_intestatario text;

COMMENT ON COLUMN public.returns.refund_method IS
  'Come il cliente vuole il rimborso di un ordine pagato in contanti: BONIFICO o CREDITO. NULL = nessuna scelta = bonifico (art. 56 Codice del Consumo: il credito solo se scelto).';
COMMENT ON COLUMN public.returns.refund_iban IS
  'IBAN per il bonifico di rimborso, solo con refund_method = BONIFICO. Dato personale: lo legge solo il server (nessun permesso ai ruoli del browser).';
COMMENT ON COLUMN public.returns.refund_bonifico_cents IS
  'Quanto del rimborso va pagato col bonifico, in centesimi. Su un ordine pagato in parte col credito MyCity la parte del credito torna credito: questo e'' solo il resto.';
COMMENT ON COLUMN public.returns.refund_bonifico_fatto_at IS
  'Quando chi amministra ha fatto il bonifico di rimborso. NULL su un reso rimborsato col bonifico = bonifico ancora da fare. Scritta questa, IBAN e intestatario si cancellano.';
COMMENT ON COLUMN public.returns.refund_intestatario IS
  'Il nome a cui intestare il bonifico, scritto SOLO quando il cliente cancella l''account con un bonifico ancora da fare (la riga ordine a quel punto non porta piu'' il nome). Si cancella col bonifico fatto. Solo server.';

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

  -- ③bis Fatto il bonifico, il conto non resta. Un database dove la prima versione di questa
  -- migrazione e' gia' passata converge: gli IBAN dei bonifici gia' fatti se ne vanno prima del
  -- paletto (su un database nuovo non c'e' nessuna riga cosi').
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'returns_iban_solo_finche_il_bonifico_e_da_fare'
                    AND conrelid = 'public.returns'::regclass) THEN
    UPDATE public.returns
       SET refund_iban = NULL, refund_intestatario = NULL
     WHERE refund_bonifico_fatto_at IS NOT NULL
       AND (refund_iban IS NOT NULL OR refund_intestatario IS NOT NULL);
    ALTER TABLE public.returns
      ADD CONSTRAINT returns_iban_solo_finche_il_bonifico_e_da_fare
      CHECK (refund_bonifico_fatto_at IS NULL OR (refund_iban IS NULL AND refund_intestatario IS NULL));
  END IF;
END $$;

-- ③ l'IBAN lo legge solo il server
--
-- L'elenco delle colonne che il browser legge e' FISSO: sono le colonne dei resi come sono alla
-- 162, tutte tranne l'IBAN e l'intestatario. Si concedono quelle dell'elenco che esistono (un
-- database un po' indietro non fa fallire la migrazione); una colonna che non e' nell'elenco non
-- si concede mai da qui.
CREATE OR REPLACE FUNCTION pg_temp.colonne_dei_resi_per_il_browser() RETURNS text[]
LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY[
    'id', 'order_id', 'order_item_id', 'buyer_id', 'seller_id', 'reason', 'notes', 'photo_urls',
    'status', 'refund_amount_cents', 'refund_id', 'return_label_url', 'tracking_number',
    'created_at', 'decided_at', 'decided_by', 'refunded_at', 'decision_notes',
    'refund_method', 'refund_bonifico_cents', 'refund_bonifico_fatto_at'
  ]::text[]
$$;

DO $$
DECLARE
  v_colonne text;
BEGIN
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
    INTO v_colonne
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'returns'
     AND column_name = ANY (pg_temp.colonne_dei_resi_per_il_browser());

  -- La revoca sulla tabella toglie anche ogni permesso per colonna dato prima o dopo: si riparte
  -- da zero, e si ridà solo l'elenco.
  EXECUTE 'REVOKE SELECT ON public.returns FROM anon, authenticated';
  EXECUTE 'REVOKE SELECT (refund_iban, refund_intestatario) ON public.returns FROM anon, authenticated';
  EXECUTE format('GRANT SELECT (%s) ON public.returns TO authenticated', v_colonne);
END $$;

-- ④ i bonifici dei reclami: li scrive e li legge solo il server
CREATE TABLE IF NOT EXISTS public.bonifici_dei_reclami (
  dispute_id     uuid PRIMARY KEY,
  order_id       uuid NOT NULL,
  importo_cents  integer NOT NULL CHECK (importo_cents > 0),
  registrato_at  timestamptz NOT NULL DEFAULT now(),
  fatto_at       timestamptz,
  iban           text,
  intestatario   text
);

COMMENT ON TABLE public.bonifici_dei_reclami IS
  'Rimborsi di reclami su ordini in contanti da pagare col bonifico, a mano, da chi amministra. fatto_at NULL = bonifico ancora da fare. Solo server.';

-- Un database dove questa migrazione e' gia' passata nella prima versione (con la chiave verso
-- `disputes`, senza IBAN ne' intestatario) converge qui: la chiave che cancellava a cascata se ne
-- va, e le due colonne arrivano.
ALTER TABLE public.bonifici_dei_reclami DROP CONSTRAINT IF EXISTS bonifici_dei_reclami_dispute_id_fkey;
ALTER TABLE public.bonifici_dei_reclami ADD COLUMN IF NOT EXISTS iban text;
ALTER TABLE public.bonifici_dei_reclami ADD COLUMN IF NOT EXISTS intestatario text;

COMMENT ON COLUMN public.bonifici_dei_reclami.iban IS
  'L''IBAN che il cliente ha mandato dalla pagina Contatti, copiato qui da chi paga. Si cancella col bonifico fatto.';
COMMENT ON COLUMN public.bonifici_dei_reclami.intestatario IS
  'Il nome a cui intestare il bonifico, scritto SOLO quando il cliente cancella l''account prima del pagamento. Si cancella col bonifico fatto.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'bonifici_dei_reclami_iban_check'
                    AND conrelid = 'public.bonifici_dei_reclami'::regclass) THEN
    ALTER TABLE public.bonifici_dei_reclami
      ADD CONSTRAINT bonifici_dei_reclami_iban_check
      CHECK (iban IS NULL OR iban ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'bonifici_dei_reclami_iban_solo_finche_e_da_fare'
                    AND conrelid = 'public.bonifici_dei_reclami'::regclass) THEN
    ALTER TABLE public.bonifici_dei_reclami
      ADD CONSTRAINT bonifici_dei_reclami_iban_solo_finche_e_da_fare
      CHECK (fatto_at IS NULL OR (iban IS NULL AND intestatario IS NULL));
  END IF;
END $$;

ALTER TABLE public.bonifici_dei_reclami ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bonifici_dei_reclami FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.bonifici_dei_reclami TO service_role;

-- Il controllo in fondo: se una mossa non e' andata a segno, la migrazione si ferma invece di
-- lasciare un IBAN leggibile dal negozio.
DO $$
DECLARE
  v_fuori text;
BEGIN
  IF has_column_privilege('authenticated', 'public.returns', 'refund_iban', 'SELECT') THEN
    RAISE EXCEPTION '162: il browser legge ancora l''IBAN dei resi';
  END IF;
  IF has_column_privilege('authenticated', 'public.returns', 'refund_intestatario', 'SELECT') THEN
    RAISE EXCEPTION '162: il browser legge il nome dell''intestatario del bonifico';
  END IF;
  -- Nessuna colonna fuori dall'elenco fisso: e' la promessa «una colonna nuova nasce chiusa»,
  -- misurata invece che scritta.
  SELECT string_agg(column_name, ', ')
    INTO v_fuori
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'returns'
     AND column_name <> ALL (pg_temp.colonne_dei_resi_per_il_browser())
     AND has_column_privilege('authenticated', 'public.returns', column_name, 'SELECT');
  IF v_fuori IS NOT NULL THEN
    RAISE EXCEPTION '162: il browser legge colonne dei resi fuori dall''elenco: %', v_fuori;
  END IF;
  IF NOT has_column_privilege('authenticated', 'public.returns', 'status', 'SELECT') THEN
    RAISE EXCEPTION '162: il browser non legge piu'' lo stato dei resi';
  END IF;
  IF has_column_privilege('anon', 'public.returns', 'id', 'SELECT') THEN
    RAISE EXCEPTION '162: chi non ha fatto l''accesso legge ancora i resi';
  END IF;
  IF has_table_privilege('authenticated', 'public.bonifici_dei_reclami', 'INSERT')
     OR has_table_privilege('authenticated', 'public.bonifici_dei_reclami', 'SELECT') THEN
    RAISE EXCEPTION '162: il browser tocca ancora i bonifici dei reclami';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint
              WHERE conrelid = 'public.bonifici_dei_reclami'::regclass
                AND contype = 'f' AND confdeltype = 'c') THEN
    RAISE EXCEPTION '162: un bonifico da fare sparirebbe insieme al reclamo o al cliente';
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';

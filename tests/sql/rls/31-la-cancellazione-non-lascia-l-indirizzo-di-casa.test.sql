-- =============================================================================
-- Cancellato l'account, dentro l'ordine non resta l'indirizzo di casa
-- =============================================================================
-- Gira dopo tests/sql/harness/apply.sh. Transazione con ROLLBACK finale.
--
-- 3/9/2026 — IL DATO PIU' IDENTIFICANTE CHE ABBIAMO SOPRAVVIVEVA ALLA CANCELLAZIONE.
--
-- `orders` non era nell'elenco unico delle tabelle da ripulire
-- (lib/account/cancellazione.ts). La sua chiave verso la persona e' ON DELETE
-- SET NULL: cancellato l'account la riga resta e `user_id` diventa NULL. Nome,
-- cellulare, via col numero civico, CAP, coordinate della porta di casa e le
-- note per il fattorino — «citofono Rossi, secondo piano» — restavano tutti
-- scritti in chiaro, e senza piu' il filo che li riportava alla persona:
-- irrintracciabili anche per chi li avesse voluti togliere il giorno dopo.
-- Intanto le impostazioni promettevano «ordini anonimizzati».
--
-- La prova unitaria (tests/unit/la-cancellazione-non-lascia-l-indirizzo-di-casa.test.ts)
-- guarda il codice. Questa guarda il DATABASE VERO, e risponde alle tre domande
-- che il codice da solo non puo' chiudere:
--
--   ① le colonne che il codice azzera esistono davvero con quel nome? (una
--      colonna sbagliata fa respingere TUTTO l'aggiornamento, e allora non si
--      pulisce piu' niente: e' gia' successo con le recensioni al fattorino);
--   ② il guardiano degli ordini (migrations/061) lascia passare la pulizia
--      fatta con la chiave di servizio, o la respinge come fa con i client?
--   ③ cancellato l'utente la riga dei conti resta davvero (SET NULL) invece di
--      sparire (CASCADE)?
--
-- E in piu' il cancello che chiude la malattia: ogni colonna `delivery_*` della
-- tabella dev'essere CLASSIFICATA — o si azzera alla cancellazione, o e'
-- dichiarata qui come non personale, col suo perche'. Una colonna nuova nata
-- domani diventa rossa il giorno stesso.
-- =============================================================================

BEGIN;

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;

-- I campi che dicono CHI E' la persona: la cancellazione li azzera.
CREATE TEMP TABLE consegna_azzerata (colonna text) ON COMMIT DROP;
INSERT INTO consegna_azzerata VALUES
  ('delivery_full_name'), ('delivery_phone'), ('delivery_address'),
  ('delivery_zip'), ('delivery_notes'), ('delivery_lat'), ('delivery_lng');

-- I campi della consegna che RESTANO, con il motivo di ognuno.
CREATE TEMP TABLE consegna_che_resta (colonna text, perche text) ON COMMIT DROP;
INSERT INTO consegna_che_resta VALUES
  ('delivery_city',           'la citta e Piacenza per tutti: dice dove abbiamo consegnato, non chi'),
  ('delivery_status',         'a che punto e arrivato l ordine: serve ai conti del negozio'),
  ('delivery_slot',           'la fascia oraria scelta: un orario, non una persona'),
  ('delivery_fee_cents',      'quanto e costata la consegna: e una riga di soldi'),
  ('delivery_photo_url',      'la azzera cancellaProveDiConsegna DOPO aver tolto il file dallo storage'),
  ('delivery_signature_url',  'come sopra: prima il file, poi la colonna che lo ritrova');

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('eeeeeeee-0000-0000-0000-00000000000e', 'maria.rossi@test.it', '{"role":"buyer"}'),
  ('ffffffff-0000-0000-0000-00000000000f', 'pane.quotidiano@test.it', '{"role":"seller"}');

-- L'ordine di Maria, con tutto quello che il fattorino usa per suonare.
INSERT INTO public.orders (
  id, user_id, seller_id, total_price, payment_status, delivery_status,
  delivery_full_name, delivery_phone, delivery_address, delivery_city,
  delivery_zip, delivery_notes, delivery_lat, delivery_lng
) VALUES (
  '00000000-1111-4111-8111-000000000001',
  'eeeeeeee-0000-0000-0000-00000000000e',
  'ffffffff-0000-0000-0000-00000000000f',
  24.50, 'PAID', 'DELIVERED',
  'Maria Rossi', '+39 333 1234567', 'Via Roma 12', 'Piacenza',
  '29121', 'citofono Rossi, secondo piano', 45.0526, 9.6929
);

-- =============================================================================
-- ① e ② La pulizia, esattamente come la fa il sito: chiave di servizio
-- =============================================================================
-- `getAdminSupabase` parla al database con la chiave di servizio, e il
-- guardiano di migrations/061 la riconosce da qui. Se un giorno quel permesso
-- cambiasse, questa UPDATE verrebbe respinta e il controllo diventerebbe rosso
-- invece di lasciarci credere di aver ripulito.
DO $$
DECLARE errore text;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  BEGIN
    UPDATE public.orders
       SET delivery_full_name = NULL,
           delivery_phone     = NULL,
           delivery_address   = NULL,
           delivery_zip       = NULL,
           delivery_notes     = NULL,
           delivery_lat       = NULL,
           delivery_lng       = NULL
     WHERE user_id = 'eeeeeeee-0000-0000-0000-00000000000e';
    INSERT INTO esiti VALUES ('la pulizia degli ordini passa, con le colonne che il codice usa', true, 'sette colonne azzerate');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS errore = MESSAGE_TEXT;
    INSERT INTO esiti VALUES ('la pulizia degli ordini passa, con le colonne che il codice usa', false,
      'respinta: ' || errore || ' — la cancellazione crede di aver ripulito e non ha ripulito niente');
  END;
END $$;

-- =============================================================================
-- ③ Cancellato l'utente: la riga dei conti resta, e non dice piu chi era
-- =============================================================================
-- Anche la chiusura dell'account passa dalla chiave di servizio: staccare il
-- legame (`user_id` = NULL) e' una modifica a un campo protetto, e senza quel
-- permesso la cancellazione non riesce proprio — e' il difetto riparato oggi
-- stesso (tests/unit/chi-cancella-l-account-non-resta-col-profilo-svuotato).
DELETE FROM auth.users WHERE id = 'eeeeeeee-0000-0000-0000-00000000000e';
DO $$ BEGIN PERFORM set_config('request.jwt.claims', '', true); END $$;

DO $$
DECLARE o record; rimasti text;
BEGIN
  SELECT * INTO o FROM public.orders WHERE id = '00000000-1111-4111-8111-000000000001';

  INSERT INTO esiti VALUES ('la riga dell ordine sopravvive alla cancellazione',
    o.id IS NOT NULL,
    'e una scrittura contabile: si tiene dieci anni (art. 2220 c.c.)');

  INSERT INTO esiti VALUES ('il legame con la persona e staccato (SET NULL, non CASCADE)',
    o.user_id IS NULL AND o.id IS NOT NULL,
    'per questo la pulizia DEVE avvenire prima: dopo, quei dati non li ritrova piu nessuno');

  SELECT string_agg(x, ', ') INTO rimasti FROM (
    SELECT 'nome'        AS x WHERE o.delivery_full_name IS NOT NULL
    UNION ALL SELECT 'telefono'    WHERE o.delivery_phone   IS NOT NULL
    UNION ALL SELECT 'indirizzo'   WHERE o.delivery_address IS NOT NULL
    UNION ALL SELECT 'CAP'         WHERE o.delivery_zip     IS NOT NULL
    UNION ALL SELECT 'note'        WHERE o.delivery_notes   IS NOT NULL
    UNION ALL SELECT 'coordinate'  WHERE o.delivery_lat IS NOT NULL OR o.delivery_lng IS NOT NULL
  ) q;

  INSERT INTO esiti VALUES ('dentro l ordine non resta chi era la persona',
    rimasti IS NULL,
    coalesce('restano: ' || rimasti, 'nome, telefono, via, CAP, note e coordinate: tutti vuoti'));

  INSERT INTO esiti VALUES ('la riga dei conti e ancora leggibile',
    o.total_price = 24.50 AND o.seller_id IS NOT NULL AND o.delivery_city = 'Piacenza',
    'importo, negozio e citta: al negozio serve il venduto, a noi la contabilita');
END $$;

-- =============================================================================
-- Il cancello: ogni campo della consegna e classificato
-- =============================================================================
DO $$
DECLARE non_classificate text;
BEGIN
  SELECT string_agg(c.column_name, ', ') INTO non_classificate
    FROM information_schema.columns c
   WHERE c.table_schema = 'public'
     AND c.table_name   = 'orders'
     AND c.column_name LIKE 'delivery\_%'
     AND c.column_name NOT IN (SELECT colonna FROM consegna_azzerata)
     AND c.column_name NOT IN (SELECT colonna FROM consegna_che_resta);

  INSERT INTO esiti VALUES ('ogni campo della consegna e classificato: si azzera o resta, col perche',
    non_classificate IS NULL,
    coalesce('nessuno ha detto che farne: ' || non_classificate,
             'tutte classificate'));
END $$;

-- =============================================================================
-- Verdetto
-- =============================================================================
DO $$
DECLARE r record; rossi int;
BEGIN
  FOR r IN SELECT * FROM esiti ORDER BY nome LOOP
    RAISE INFO '%  %  — %', CASE WHEN r.ok THEN 'ok  ' ELSE 'ROTTO' END, r.nome, r.dettaglio;
  END LOOP;
  SELECT count(*) INTO rossi FROM esiti WHERE ok IS NOT TRUE;
  IF rossi > 0 THEN
    RAISE EXCEPTION '% controlli su % sono rossi', rossi, (SELECT count(*) FROM esiti);
  END IF;
  RAISE INFO 'tutti verdi: % controlli', (SELECT count(*) FROM esiti);
END $$;

ROLLBACK;

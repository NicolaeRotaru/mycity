-- =============================================================================
-- La posta dell'ordine parte dai TRE percorsi veri, non solo dal trigger
-- =============================================================================
-- Gira contro un database ricostruito dalle migrazioni vere:
--   tests/sql/harness/apply.sh mycity_test
--   tests/sql/harness/run.sh   mycity_test
--
-- PERCHE' ESISTE, VISTO CHE C'E' GIA' IL FILE 30.
--
-- Il 30 prova il trigger della migrazione 150: cambia lo stato di un ordine e
-- guarda la coda. Lo fa pero' da padrone del database e col lasciapassare
-- `mycity.allow_order_write` acceso per tutta la transazione — cioe' per una
-- strada che in produzione non percorre nessuno.
--
-- In produzione lo stato di un ordine cambia in tre modi, e sono tre soltanto:
--   ① il BROWSER del negoziante scrive `delivery_status = 'READY'` sulla
--      tabella, come utente `authenticated`, passando dal guardiano
--      `enforce_order_update_rules` (migrazione 114) senza nessun lasciapassare;
--   ② il negoziante chiude un ritiro in negozio con `confirm_pickup_by_seller`
--      (migrazione 124);
--   ③ il fattorino chiude una consegna con `verify_delivery_code` (125).
--
-- Il trigger e' agganciato ad `AFTER UPDATE OF delivery_status`: si accende solo
-- se la colonna sta nell'elenco scritto dalla UPDATE. Basta che una di quelle
-- tre strade domani cambi modo di scrivere lo stato — un campo diverso, una
-- colonna derivata da un trigger BEFORE, un'altra tabella — e la posta smette di
-- partire mentre il file 30 resta verde. Il cliente non riceve piu' niente e
-- nessuna prova diventa rossa: e' esattamente il modo in cui questa funzione era
-- gia' morta una volta.
--
-- E c'e' la seconda cosa che questo file dice a voce alta: il controllo ⓪. Se il
-- trigger non c'e', qui si legge «la migrazione 150 non e' applicata su questo
-- database» invece di cinque righe rosse da interpretare. Su una copia della
-- produzione e' la differenza fra sapere e indovinare.
--
-- ATTENZIONE ALL'ORDINE DEI PASSI, non e' casuale: le due RPC accendono da sole
-- `mycity.allow_order_write` con `set_config(..., true)`, che vale fino alla
-- fine della transazione. Il passo ① (il browser, che il lasciapassare NON ce
-- l'ha) va percorso prima delle RPC, altrimenti si prova una strada finta.
--
-- Tutto in transazione con ROLLBACK: non lascia dati.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';
SET LOCAL mycity.allow_order_write   = '1';

CREATE TEMP TABLE esiti (nome text, verde boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('cc000000-0000-0000-0000-000000000001', 'fornaio-33@test.it',   '{"role":"seller"}'),
  ('cc000000-0000-0000-0000-000000000002', 'cliente-33@test.it',   '{"role":"buyer"}'),
  ('cc000000-0000-0000-0000-000000000003', 'fattorino-33@test.it', '{"role":"rider"}');

UPDATE public.profiles
   SET is_approved = true, approval_status = 'approved',
       store_name = 'Pane Quotidiano', store_address = 'Via Roma 1, Piacenza'
 WHERE id = 'cc000000-0000-0000-0000-000000000001';
UPDATE public.profiles SET is_approved = true, approval_status = 'approved'
 WHERE id = 'cc000000-0000-0000-0000-000000000003';

-- Un ritiro in negozio, accettato: lo portera' a «pronto» il negoziante dal suo
-- browser, e poi lo chiudera' col codice del cliente.
INSERT INTO public.orders (
  id, user_id, seller_id, total_price, gross_total_cents, payment_method, payment_status,
  delivery_status, pickup_in_store, payout_status, seller_payout_cents,
  delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip
) VALUES (
  'cc000000-0000-0000-0000-0000000000a1', 'cc000000-0000-0000-0000-000000000002',
  'cc000000-0000-0000-0000-000000000001', 20.00, 2000, 'card', 'PAID',
  'ACCEPTED', true, 'HELD', 1800,
  'Maria Rossi', '3331234567', 'Via Verdi 10', 'Piacenza', '29121'
);

-- Una consegna a domicilio gia' in strada: la chiude il fattorino col codice.
INSERT INTO public.orders (
  id, user_id, seller_id, total_price, gross_total_cents, payment_method, payment_status,
  delivery_status, pickup_in_store, payout_status, seller_payout_cents, rider_id,
  delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip
) VALUES (
  'cc000000-0000-0000-0000-0000000000a2', 'cc000000-0000-0000-0000-000000000002',
  'cc000000-0000-0000-0000-000000000001', 30.00, 3000, 'card', 'PAID',
  'OUT_FOR_DELIVERY', false, 'HELD', 2700, 'cc000000-0000-0000-0000-000000000003',
  'Maria Rossi', '3331234567', 'Via Verdi 10', 'Piacenza', '29121'
);

-- I codici li crea un trigger suo, casuali: qui si fissano per poterli digitare.
UPDATE public.order_delivery_codes SET code = '111111'
 WHERE order_id = 'cc000000-0000-0000-0000-0000000000a1';
UPDATE public.order_delivery_codes SET code = '222222'
 WHERE order_id = 'cc000000-0000-0000-0000-0000000000a2';

-- ── ⓪ Il gancio c'e'? ─────────────────────────────────────────────────────
-- Se questa riga e' rossa non c'e' niente da capire nelle altre: su questo
-- database la migrazione 150 non e' mai stata applicata.
INSERT INTO esiti
SELECT 'la migrazione 150 e'' applicata: il trigger sugli ordini esiste',
       count(*) = 1,
       format('trigger trovati %s (atteso 1) — se 0, applica migrations/150', count(*))
  FROM pg_trigger WHERE tgname = 'trg_enqueue_order_status_email';

-- ── ① Il negoziante dal suo browser, coi suoi permessi e basta ────────────
-- Niente lasciapassare: si spegne qui, cosi' la UPDATE passa dal guardiano
-- vero. E' la strada esatta di app/seller/orders/[id]/page.tsx.
SET LOCAL mycity.allow_order_write = '';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"cc000000-0000-0000-0000-000000000001","role":"authenticated"}';

UPDATE public.orders SET delivery_status = 'READY', ready_at = now()
 WHERE id = 'cc000000-0000-0000-0000-0000000000a1';

RESET ROLE;

-- La coda si legge da qui: `email_queue` ha le regole di riga forzate e nessuna
-- policy, quindi un `authenticated` la vedrebbe vuota anche se e' piena.
DO $$
DECLARE riga jsonb; quante int; stato text;
BEGIN
  SELECT delivery_status INTO stato
    FROM public.orders WHERE id = 'cc000000-0000-0000-0000-0000000000a1';

  SELECT count(*), (array_agg(q.metadata))[1] INTO quante, riga
    FROM public.email_queue q
   WHERE q.template = 'order_ready'
     AND q.metadata->>'orderId' = 'cc000000-0000-0000-0000-0000000000a1';

  INSERT INTO esiti VALUES (
    'il negoziante mette «pronto» dal browser e la posta va in coda',
    stato = 'READY'
      AND quante = 1
      AND riga->>'storeName'  = 'Pane Quotidiano'
      AND riga->>'pickupCode' = '111111',
    format('stato %s · righe in coda %s (attesa 1) · dati %s',
           stato, quante, coalesce(riga::text, 'nessuno'))
  );
END $$;

-- ── ② Il ritiro chiuso dal negoziante: confirm_pickup_by_seller ───────────
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"cc000000-0000-0000-0000-000000000001","role":"authenticated"}';

INSERT INTO esiti
SELECT 'il negoziante chiude il ritiro col codice del cliente',
       (r ->> 'ok')::boolean IS TRUE,
       'risposta: ' || r::text
  FROM (SELECT public.confirm_pickup_by_seller('cc000000-0000-0000-0000-0000000000a1', '111111') AS r) t;

RESET ROLE;

INSERT INTO esiti
SELECT 'il ritiro chiuso dalla RPC mette in coda «ordine consegnato»',
       count(*) = 1,
       format('righe in coda %s (attesa 1)', count(*))
  FROM public.email_queue q
 WHERE q.template = 'order_delivered'
   AND q.metadata->>'orderId' = 'cc000000-0000-0000-0000-0000000000a1';

-- ── ③ La consegna chiusa dal fattorino: verify_delivery_code ──────────────
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"cc000000-0000-0000-0000-000000000003","role":"authenticated"}';

INSERT INTO esiti
SELECT 'il fattorino chiude la consegna col codice alla porta',
       (r ->> 'ok')::boolean IS TRUE,
       'risposta: ' || r::text
  FROM (SELECT public.verify_delivery_code('cc000000-0000-0000-0000-0000000000a2', '222222') AS r) t;

RESET ROLE;

INSERT INTO esiti
SELECT 'la consegna chiusa dalla RPC mette in coda «ordine consegnato»',
       count(*) = 1,
       format('righe in coda %s (attesa 1)', count(*))
  FROM public.email_queue q
 WHERE q.template = 'order_delivered'
   AND q.metadata->>'orderId' = 'cc000000-0000-0000-0000-0000000000a2';

-- ── Verdetto ──────────────────────────────────────────────────────────────
SELECT nome, CASE WHEN verde THEN 'ok' ELSE 'ROTTO' END AS esito, dettaglio
  FROM esiti ORDER BY nome;

DO $$
DECLARE rossi int; elenco text;
BEGIN
  SELECT count(*), coalesce(string_agg(format('%s → %s', e.nome, e.dettaglio), E'\n  '), '')
    INTO rossi, elenco
  FROM esiti e WHERE e.verde IS NOT TRUE;

  IF rossi > 0 THEN
    RAISE EXCEPTION E'% controllo/i rosso/i sui percorsi veri della posta d ordine:\n  %', rossi, elenco;
  END IF;
  RAISE NOTICE 'i tre percorsi veri accodano la posta: % controlli verdi', (SELECT count(*) FROM esiti);
END $$;

ROLLBACK;

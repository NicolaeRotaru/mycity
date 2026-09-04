-- =============================================================================
-- «Ordine pronto» e «ordine consegnato» finiscono davvero nella coda della posta
-- =============================================================================
-- Gira contro un database ricostruito dalle migrazioni vere:
--   tests/sql/harness/apply.sh mycity_test
--   tests/sql/harness/run.sh   mycity_test
--
-- PERCHE' ESISTE QUESTO FILE.
--
-- I due messaggi erano scritti e impaginati in `lib/email/templates.ts` e non li
-- chiamava nessuno: il cliente riceveva la conferma d'ordine e poi piu' niente.
-- Non c'era un punto sul server dove agganciarli — il passaggio a «pronto» lo
-- scrive il browser del negoziante direttamente sulla tabella, e quello a
-- «consegnato» due funzioni dentro il database. La migrazione 150 ha messo il
-- gancio nell'unico posto che li vede tutti: un trigger sul cambio di stato.
--
-- Il gancio pero' e' scritto «best-effort»: qualsiasi errore dentro il trigger
-- viene inghiottito (`EXCEPTION WHEN OTHERS THEN NULL`), perche' una email persa
-- non deve mai bloccare l'avanzamento di un ordine. Giusto — ma vuol dire che
-- se domani si rompe, si rompe IN SILENZIO: nessun errore, nessun log, solo
-- clienti che non sanno piu' che la spesa e' pronta. E' per quello che serve
-- una prova che guardi la coda, non il testo della migrazione.
--
-- COSA CONTROLLA. Fa cambiare stato a ordini veri e guarda `email_queue`:
--   ① ritiro in negozio + READY  → una riga «order_ready» col codice del banco
--   ② consegna a domicilio + READY → «order_ready» SENZA il codice (quello si
--     dice alla porta, non si anticipa per posta)
--   ③ DELIVERED → «order_delivered»
--   ④ uno stato di mezzo (ACCEPTED) → niente in coda
--   ⑤ `claim_pending_emails` restituisce anche `metadata`: senza, il giro che
--     spedisce non saprebbe il numero d'ordine e il messaggio partirebbe vuoto
--
-- Tutto in transazione con ROLLBACK: non lascia dati.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';
SET LOCAL mycity.allow_order_write   = '1';

CREATE TEMP TABLE esiti (nome text, verde boolean, dettaglio text) ON COMMIT DROP;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('ee000000-0000-0000-0000-000000000001', 'fornaio@test.it', '{"role":"seller"}'),
  ('ee000000-0000-0000-0000-000000000002', 'cliente@test.it', '{"role":"buyer"}');

UPDATE public.profiles
   SET is_approved = true, approval_status = 'approved',
       store_name = 'Pane Quotidiano', store_address = 'Via Roma 1, Piacenza'
 WHERE id = 'ee000000-0000-0000-0000-000000000001';

INSERT INTO public.orders (
  id, user_id, seller_id, total_price, payment_method, payment_status,
  delivery_status, pickup_in_store
) VALUES
  ('ee000000-0000-0000-0000-0000000000a1', 'ee000000-0000-0000-0000-000000000002',
   'ee000000-0000-0000-0000-000000000001', 24.50, 'card', 'PAID', 'NEW', true),
  ('ee000000-0000-0000-0000-0000000000a2', 'ee000000-0000-0000-0000-000000000002',
   'ee000000-0000-0000-0000-000000000001', 31.00, 'card', 'PAID', 'NEW', false),
  ('ee000000-0000-0000-0000-0000000000a3', 'ee000000-0000-0000-0000-000000000002',
   'ee000000-0000-0000-0000-000000000001', 12.00, 'card', 'PAID', 'NEW', false);

-- Il codice che il cliente mostra al bancone (lo crea gia' un trigger suo:
-- qui lo si fissa a un valore noto per poterlo riconoscere nel messaggio).
INSERT INTO public.order_delivery_codes (order_id, code)
VALUES ('ee000000-0000-0000-0000-0000000000a1', '424242')
ON CONFLICT (order_id) DO UPDATE SET code = '424242';

-- ── ① Ritiro in negozio: «pronto» porta negozio, indirizzo e codice ───────
DO $$
DECLARE riga jsonb; quante int;
BEGIN
  UPDATE public.orders SET delivery_status = 'READY'
   WHERE id = 'ee000000-0000-0000-0000-0000000000a1';

  SELECT count(*), (array_agg(q.metadata))[1] INTO quante, riga
    FROM public.email_queue q
   WHERE q.template = 'order_ready'
     AND q.metadata->>'orderId' = 'ee000000-0000-0000-0000-0000000000a1';

  INSERT INTO esiti VALUES (
    'ritiro in negozio: «ordine pronto» va in coda col codice del banco',
    quante = 1
      AND riga->>'storeName'    = 'Pane Quotidiano'
      AND riga->>'storeAddress' = 'Via Roma 1, Piacenza'
      AND riga->>'pickupCode'   = '424242'
      AND (riga->>'pickupInStore')::boolean IS TRUE
      AND (riga->>'totalEuro')::numeric = 24.50,
    format('righe in coda %s (attesa 1), dati %s', quante, coalesce(riga::text, 'nessuno'))
  );
END $$;

-- ── ② Consegna a domicilio: la chiave della porta NON si manda per email ──
DO $$
DECLARE riga jsonb; quante int;
BEGIN
  UPDATE public.orders SET delivery_status = 'READY'
   WHERE id = 'ee000000-0000-0000-0000-0000000000a2';

  SELECT count(*), (array_agg(q.metadata))[1] INTO quante, riga
    FROM public.email_queue q
   WHERE q.template = 'order_ready'
     AND q.metadata->>'orderId' = 'ee000000-0000-0000-0000-0000000000a2';

  INSERT INTO esiti VALUES (
    'consegna a domicilio: «ordine pronto» va in coda senza il codice',
    quante = 1
      AND riga ? 'pickupCode'   IS FALSE
      AND riga ? 'storeAddress' IS FALSE
      AND (riga->>'pickupInStore')::boolean IS FALSE,
    format('righe in coda %s (attesa 1), dati %s', quante, coalesce(riga::text, 'nessuno'))
  );
END $$;

-- ── ③ «Consegnato» ha il suo messaggio ────────────────────────────────────
DO $$
DECLARE quante int;
BEGIN
  UPDATE public.orders SET delivery_status = 'DELIVERED'
   WHERE id = 'ee000000-0000-0000-0000-0000000000a2';

  SELECT count(*) INTO quante
    FROM public.email_queue q
   WHERE q.template = 'order_delivered'
     AND q.metadata->>'orderId' = 'ee000000-0000-0000-0000-0000000000a2';

  INSERT INTO esiti VALUES (
    'il passaggio a «consegnato» mette in coda il suo messaggio',
    quante = 1,
    format('righe in coda %s (attesa 1)', quante)
  );
END $$;

-- ── ④ Gli stati di mezzo non mandano niente ───────────────────────────────
DO $$
DECLARE quante int;
BEGIN
  UPDATE public.orders SET delivery_status = 'ACCEPTED'
   WHERE id = 'ee000000-0000-0000-0000-0000000000a3';

  SELECT count(*) INTO quante
    FROM public.email_queue q
   WHERE q.metadata->>'orderId' = 'ee000000-0000-0000-0000-0000000000a3';

  INSERT INTO esiti VALUES (
    'un ordine solo accettato non manda nessuna posta',
    quante = 0,
    format('righe in coda %s (attesa 0)', quante)
  );
END $$;

-- ── ⑤ Il giro che spedisce riceve anche i dati della riga ─────────────────
-- Senza `metadata` in uscita da `claim_pending_emails` il messaggio partirebbe
-- senza numero d'ordine: la coda si svuota e il cliente riceve un foglio vuoto.
DO $$
DECLARE con_dati int;
BEGIN
  SELECT count(*) INTO con_dati
    FROM public.claim_pending_emails(50) c
   WHERE c.template IN ('order_ready', 'order_delivered')
     AND c.metadata->>'orderId' IS NOT NULL;

  INSERT INTO esiti VALUES (
    'la coda consegna al giro anche i dati della riga, non solo il nome del messaggio',
    con_dati = 3,
    format('righe con i dati %s (attese 3)', con_dati)
  );
END $$;

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
    RAISE EXCEPTION E'% controllo/i rosso/i sulla posta dell ordine:\n  %', rossi, elenco;
  END IF;
  RAISE NOTICE 'la posta dell ordine parte davvero: % controlli verdi', (SELECT count(*) FROM esiti);
END $$;

ROLLBACK;

-- =============================================================================
-- R33-014 — Il giro notturno non prende in carico la cancellazione di un negozio
--           che ha ancora un ordine aperto o soldi da incassare
-- =============================================================================
-- Gira contro un database ricostruito dalle migrazioni vere:
--   tests/sql/harness/apply.sh mycity_test
--   tests/sql/harness/run.sh   mycity_test
--
-- Quattro negozi e un cliente hanno chiesto la cancellazione 8 giorni fa.
-- `process_expired_deletions()` restituiva tutti: anche il negozio con un ordine
-- pagato ancora da consegnare e quello col bonifico ancora trattenuto. Con la 572
-- restano fuori (rinviati) solo quei due; un carrello mai pagato non ferma niente,
-- e gli ordini fatti come cliente nemmeno.
-- Tutto in transazione, ROLLBACK.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';
SET LOCAL mycity.allow_order_write   = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('d3300000-0000-0000-0000-000000000001', 'libero-r33@test.it',     '{"role":"seller"}'),
  ('d3300000-0000-0000-0000-000000000002', 'aperto-r33@test.it',     '{"role":"seller"}'),
  ('d3300000-0000-0000-0000-000000000003', 'bonifico-r33@test.it',   '{"role":"seller"}'),
  ('d3300000-0000-0000-0000-000000000004', 'carrello-r33@test.it',   '{"role":"seller"}'),
  ('d3300000-0000-0000-0000-000000000005', 'cliente-r33@test.it',    '{"role":"buyer"}'),
  ('d3300000-0000-0000-0000-000000000006', 'contanti-r33@test.it',   '{"role":"seller"}');

UPDATE public.profiles
   SET is_approved = true, approval_status = 'approved', store_name = 'Negozio R33',
       store_address = 'Via Roma 1, Piacenza'
 WHERE id IN ('d3300000-0000-0000-0000-000000000001', 'd3300000-0000-0000-0000-000000000002',
              'd3300000-0000-0000-0000-000000000003', 'd3300000-0000-0000-0000-000000000004',
              'd3300000-0000-0000-0000-000000000006');

INSERT INTO public.orders (
  id, user_id, seller_id, total_price, gross_total_cents, payment_method, payment_status,
  delivery_status, delivered_at, pickup_in_store, payout_status, seller_payout_cents,
  delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip
) VALUES
-- 2: un ordine pagato con la carta, accettato e non ancora consegnato.
('d3300000-0000-0000-0000-0000000000a2', 'd3300000-0000-0000-0000-000000000005', 'd3300000-0000-0000-0000-000000000002',
 30.00, 3000, 'card', 'PAID', 'ACCEPTED', NULL, false, 'PENDING', 2700,
 'Maria Rossi', '3331234567', 'Via Verdi 10', 'Piacenza', '29121'),
-- 3: consegnato, ma il bonifico al negozio è ancora trattenuto.
('d3300000-0000-0000-0000-0000000000a3', 'd3300000-0000-0000-0000-000000000005', 'd3300000-0000-0000-0000-000000000003',
 30.00, 3000, 'card', 'PAID', 'DELIVERED', now() - interval '2 days', false, 'HELD', 2700,
 'Maria Rossi', '3331234567', 'Via Verdi 10', 'Piacenza', '29121'),
-- 4: un carrello mai pagato, e un ordine consegnato col bonifico già partito.
('d3300000-0000-0000-0000-0000000000a4', 'd3300000-0000-0000-0000-000000000005', 'd3300000-0000-0000-0000-000000000004',
 30.00, 3000, 'card', 'PENDING', 'NEW', NULL, false, 'PENDING', 2700,
 'Maria Rossi', '3331234567', 'Via Verdi 10', 'Piacenza', '29121'),
('d3300000-0000-0000-0000-0000000000b4', 'd3300000-0000-0000-0000-000000000005', 'd3300000-0000-0000-0000-000000000004',
 30.00, 3000, 'card', 'PAID', 'DELIVERED', now() - interval '20 days', false, 'TRANSFERRED', 2700,
 'Maria Rossi', '3331234567', 'Via Verdi 10', 'Piacenza', '29121'),
-- 6: in contanti, consegnato, ma i contanti non sono ancora stati versati dal fattorino.
('d3300000-0000-0000-0000-0000000000a6', 'd3300000-0000-0000-0000-000000000005', 'd3300000-0000-0000-0000-000000000006',
 30.00, 3000, 'cod', 'PAID', 'DELIVERED', now() - interval '1 day', false, 'AWAITING_REMITTANCE', 2700,
 'Maria Rossi', '3331234567', 'Via Verdi 10', 'Piacenza', '29121');

SET LOCAL mycity.allow_order_write = '';

UPDATE public.profiles SET deletion_requested_at = now() - interval '8 days'
 WHERE id IN ('d3300000-0000-0000-0000-000000000001', 'd3300000-0000-0000-0000-000000000002',
              'd3300000-0000-0000-0000-000000000003', 'd3300000-0000-0000-0000-000000000004',
              'd3300000-0000-0000-0000-000000000005', 'd3300000-0000-0000-0000-000000000006');

CREATE TEMP TABLE presi ON COMMIT DROP AS
  SELECT user_id FROM public.process_expired_deletions()
   WHERE user_id::text LIKE 'd3300000-%';

INSERT INTO esiti SELECT 'il negozio senza ordini aperti si cancella',
  EXISTS (SELECT 1 FROM presi WHERE user_id = 'd3300000-0000-0000-0000-000000000001'), 'preso: negozio libero';
INSERT INTO esiti SELECT 'il negozio con un ordine pagato da consegnare aspetta',
  NOT EXISTS (SELECT 1 FROM presi WHERE user_id = 'd3300000-0000-0000-0000-000000000002'), 'preso col suo ordine aperto';
INSERT INTO esiti SELECT 'il negozio col bonifico ancora trattenuto aspetta',
  NOT EXISTS (SELECT 1 FROM presi WHERE user_id = 'd3300000-0000-0000-0000-000000000003'), 'preso coi soldi da incassare';
INSERT INTO esiti SELECT 'il negozio coi contanti non ancora versati aspetta',
  NOT EXISTS (SELECT 1 FROM presi WHERE user_id = 'd3300000-0000-0000-0000-000000000006'), 'preso coi contanti da ricevere';
INSERT INTO esiti SELECT 'un carrello mai pagato e un bonifico partito non fermano la cancellazione',
  EXISTS (SELECT 1 FROM presi WHERE user_id = 'd3300000-0000-0000-0000-000000000004'), 'rinviato senza motivo';
INSERT INTO esiti SELECT 'gli ordini fatti come cliente non fermano la sua cancellazione',
  EXISTS (SELECT 1 FROM presi WHERE user_id = 'd3300000-0000-0000-0000-000000000005'), 'cliente rinviato';
INSERT INTO esiti SELECT 'la richiesta rinviata resta in piedi per la notte dopo',
  (SELECT deletion_requested_at IS NOT NULL FROM public.profiles WHERE id = 'd3300000-0000-0000-0000-000000000002'),
  'richiesta tolta';

-- La funzione resta chiusa a chi non è il server.
INSERT INTO esiti SELECT 'solo il server la può chiamare',
  NOT has_function_privilege('authenticated', 'public.process_expired_deletions()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.process_expired_deletions()', 'EXECUTE'),
  'aperta a anon o authenticated';

-- ── Verdetto ──────────────────────────────────────────────────────────────
SELECT nome, CASE WHEN ok THEN 'ok' ELSE 'ROTTO' END AS esito, dettaglio
  FROM esiti ORDER BY nome;

DO $$
DECLARE rossi int; elenco text;
BEGIN
  SELECT count(*), coalesce(string_agg(format('%s → %s', e.nome, e.dettaglio), E'\n  '), '')
    INTO rossi, elenco
  FROM esiti e WHERE e.ok IS NOT TRUE;

  IF rossi > 0 THEN
    RAISE EXCEPTION E'% controllo/i rosso/i sulla cancellazione con ordini aperti:\n  %', rossi, elenco;
  END IF;
  RAISE NOTICE 'la cancellazione aspetta gli ordini aperti del negozio: % controlli verdi', (SELECT count(*) FROM esiti);
END $$;

ROLLBACK;

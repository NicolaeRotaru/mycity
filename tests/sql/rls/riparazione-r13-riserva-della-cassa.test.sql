-- =============================================================================
-- R13-002 — La merce della cassa in contanti ha una riserva scritta (migrazione 371)
-- =============================================================================
--   tests/sql/harness/apply.sh mycity_test && tests/sql/harness/run.sh mycity_test
--
-- La rotta dei contanti scala merce e credito prima di scrivere l'ordine. Se la
-- funzione muore in mezzo, oggi nessuno sa piu' cosa rimettere. Qui si prova la
-- strada intera dal database, come la percorre la rotta:
--   ① la riga nasce con la merce, e solo se la merce e' stata presa davvero;
--   ② morta prima dell'ordine: chi viene dopo (passati 15 minuti, non prima)
--      rimette la merce e il credito, una volta sola, anche se la rotta aveva
--      gia' restituito il credito; e se glielo si chiede per certi prodotti,
--      solo le righe che li tengono;
--   ③ morta fra l'ordine e gli articoli: torna la merce, il credito resta
--      sull'ordine (lo restituisce il suo annullo);
--   ④ ordine intero: la merce resta venduta;
--   ⑤ lo storno della rotta chiude la riga: niente doppia merce dopo;
--   ⑥ lo stesso identificativo ripreso da un secondo invio della stessa chiave:
--      la merce del primo, morto, torna; quella del secondo resta venduta;
--   ⑦ due righe aperte sullo stesso ordine: non si tocca niente, si conta;
--   ⑧ l'annullo di un ordine senza articoli rimette la sua merce, una volta;
--   ⑨ «ordine» solo se gli articoli ci sono;
--   ⑩ chi chiama le funzioni come prima ottiene quello di prima;
--   ⑪ nessun client le esegue, nessuno legge la tabella.
-- Senza la 371 la prova non gira. ROLLBACK finale.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';
SET LOCAL mycity.allow_order_write = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('71000000-0000-0000-0000-000000000001', 'forno-r13@test.it',   '{"role":"seller"}'),
  ('71000000-0000-0000-0000-000000000002', 'maria-r13@test.it',   '{"role":"buyer"}');
UPDATE public.profiles
   SET is_approved = true, approval_status = 'approved', store_name = 'Forno di prova'
 WHERE id = '71000000-0000-0000-0000-000000000001';

INSERT INTO public.products (id, seller_id, name, description, price, stock, status) VALUES
  ('71000000-0000-0000-0000-0000000000a1', '71000000-0000-0000-0000-000000000001', 'Pane', 'Pane di prova', 4, 10, 'available'),
  ('71000000-0000-0000-0000-0000000000a2', '71000000-0000-0000-0000-000000000001', 'Focaccia', 'Focaccia di prova', 5, 10, 'available');

-- Maria ha 10 € di credito MyCity.
DO $$ BEGIN PERFORM public.wallet_credit('71000000-0000-0000-0000-000000000002', 1000, 'gift_card_redeem', 'r13-buono'); END $$;

CREATE TEMP TABLE r13 (cosa text PRIMARY KEY, valore text) ON COMMIT DROP;
CREATE FUNCTION pg_temp.scorta(p uuid) RETURNS int LANGUAGE sql AS $$ SELECT stock FROM public.products WHERE id = p $$;
CREATE FUNCTION pg_temp.saldo() RETURNS int LANGUAGE sql AS $$
  SELECT wallet_balance_cents FROM public.profiles WHERE id = '71000000-0000-0000-0000-000000000002' $$;
CREATE FUNCTION pg_temp.stato(p uuid) RETURNS text LANGUAGE sql AS $$
  SELECT coalesce((SELECT stato FROM interno.riserve_della_cassa WHERE id = p), 'nessuna riga') $$;
-- La riga come la scrive la rotta: l'ordine deciso prima e il riferimento della spesa di credito.
CREATE FUNCTION pg_temp.riga(p_id uuid, p_ordine uuid, p_rif text)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('id', p_id, 'ordine_id', p_ordine, 'rif_credito', p_rif) $$;
CREATE FUNCTION pg_temp.merce(p uuid, q int) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_array(jsonb_build_object('product_id', p, 'variant_id', NULL, 'qty', q)) $$;
-- Il tempo passa: la riga e' di 20 minuti fa (la funzione che l'ha scritta e' morta di sicuro).
CREATE FUNCTION pg_temp.invecchia(p uuid) RETURNS void LANGUAGE sql AS $$
  UPDATE interno.riserve_della_cassa SET created_at = now() - interval '20 minutes' WHERE id = p $$;
CREATE FUNCTION pg_temp.ordine(p_id uuid, p_credito int) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.orders (id, user_id, seller_id, total_price, wallet_applied_cents, payment_method, payment_status,
                             delivery_status, payout_status, seller_payout_cents, rider_fee_cents,
                             delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip)
  VALUES (p_id, '71000000-0000-0000-0000-000000000002', '71000000-0000-0000-0000-000000000001', 8, p_credito, 'cod', 'PENDING',
          'NEW', 'AWAITING_REMITTANCE', 720, 300, 'Maria Rossi', '3331234567', 'Via Emilia 1', 'Piacenza', '29121') $$;
CREATE FUNCTION pg_temp.articolo(p_ordine uuid, p uuid, q int) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.order_items (order_id, product_id, quantity, unit_price) VALUES (p_ordine, p, q, 4) $$;

-- ── ① La riga nasce con la merce, e solo se la merce c'e' ────────────────────
DO $$
DECLARE prima int := pg_temp.scorta('71000000-0000-0000-0000-0000000000a1'); fallita boolean := false;
BEGIN
  PERFORM public.reserve_stock(pg_temp.merce('71000000-0000-0000-0000-0000000000a1', 2),
                               pg_temp.riga('71000000-0000-0000-0000-00000000b001', '71000000-0000-0000-0000-00000000c001', 'r13-spesa-1'));
  INSERT INTO esiti VALUES ('la riserva scala la merce e scrive la riga, con la merce e l ordine previsto',
    pg_temp.scorta('71000000-0000-0000-0000-0000000000a1') = prima - 2
      AND EXISTS (SELECT 1 FROM interno.riserve_della_cassa
                   WHERE id = '71000000-0000-0000-0000-00000000b001' AND stato = 'aperta'
                     AND ordine_id = '71000000-0000-0000-0000-00000000c001'
                     AND merce = pg_temp.merce('71000000-0000-0000-0000-0000000000a1', 2)),
    format('scorta %s (attesa %s), riga %s', pg_temp.scorta('71000000-0000-0000-0000-0000000000a1'), prima - 2,
           pg_temp.stato('71000000-0000-0000-0000-00000000b001')));

  BEGIN
    PERFORM public.reserve_stock(pg_temp.merce('71000000-0000-0000-0000-0000000000a1', 99),
                                 pg_temp.riga('71000000-0000-0000-0000-00000000b0ff', '71000000-0000-0000-0000-00000000c0ff', 'r13-spesa-x'));
  EXCEPTION WHEN check_violation THEN fallita := true;
  END;
  INSERT INTO esiti VALUES ('merce finita: nessuna riga, perche nessuna merce e stata presa',
    fallita AND pg_temp.stato('71000000-0000-0000-0000-00000000b0ff') = 'nessuna riga'
      AND pg_temp.scorta('71000000-0000-0000-0000-0000000000a1') = prima - 2,
    format('rifiutata %s, riga %s', fallita, pg_temp.stato('71000000-0000-0000-0000-00000000b0ff')));
END $$;

-- ── ② Morta prima dell'ordine: merce e credito tornano, dopo 15 minuti, una volta ──
DO $$
DECLARE scorta_prima int := pg_temp.scorta('71000000-0000-0000-0000-0000000000a1') + 2;  -- prima della riga ①
        saldo_prima int := pg_temp.saldo(); esito jsonb;
BEGIN
  -- La rotta ha preso anche il credito, poi e' morta.
  PERFORM public.wallet_debit('71000000-0000-0000-0000-000000000002', 300, 'order_cod', 'r13-spesa-1');

  esito := public.libera_riserve_della_cassa();
  UPDATE interno.riserve_della_cassa SET created_at = now() - interval '5 minutes' WHERE id = '71000000-0000-0000-0000-00000000b001';
  PERFORM public.libera_riserve_della_cassa(NULL, 1);
  INSERT INTO esiti VALUES ('una riga di pochi minuti non si tocca (chi l ha scritta puo essere vivo), nemmeno chiedendo 1 minuto',
    pg_temp.stato('71000000-0000-0000-0000-00000000b001') = 'aperta'
      AND pg_temp.scorta('71000000-0000-0000-0000-0000000000a1') = scorta_prima - 2
      AND pg_temp.saldo() = saldo_prima - 300,
    format('riga %s, esito %s', pg_temp.stato('71000000-0000-0000-0000-00000000b001'), esito));

  PERFORM pg_temp.invecchia('71000000-0000-0000-0000-00000000b001');
  PERFORM public.libera_riserve_della_cassa(ARRAY['71000000-0000-0000-0000-0000000000a2'::uuid]);
  INSERT INTO esiti VALUES ('la pulizia chiesta per la focaccia non tocca la riga del pane',
    pg_temp.stato('71000000-0000-0000-0000-00000000b001') = 'aperta',
    pg_temp.stato('71000000-0000-0000-0000-00000000b001'));

  esito := public.libera_riserve_della_cassa(ARRAY['71000000-0000-0000-0000-0000000000a1'::uuid]);
  PERFORM public.libera_riserve_della_cassa();
  INSERT INTO esiti VALUES ('dopo 15 minuti tornano la merce e il credito, una volta sola',
    pg_temp.stato('71000000-0000-0000-0000-00000000b001') = 'liberata'
      AND pg_temp.scorta('71000000-0000-0000-0000-0000000000a1') = scorta_prima
      AND pg_temp.saldo() = saldo_prima,
    format('riga %s, scorta %s (attesa %s), saldo %s (atteso %s), esito %s',
           pg_temp.stato('71000000-0000-0000-0000-00000000b001'), pg_temp.scorta('71000000-0000-0000-0000-0000000000a1'),
           scorta_prima, pg_temp.saldo(), saldo_prima, esito));
END $$;

-- ②b La rotta aveva restituito il credito ma non la merce: torna la merce, il credito non due volte.
DO $$
DECLARE scorta_prima int := pg_temp.scorta('71000000-0000-0000-0000-0000000000a2'); saldo_prima int := pg_temp.saldo();
BEGIN
  PERFORM public.reserve_stock(pg_temp.merce('71000000-0000-0000-0000-0000000000a2', 1),
                               pg_temp.riga('71000000-0000-0000-0000-00000000b002', '71000000-0000-0000-0000-00000000c002', 'r13-spesa-2'));
  PERFORM public.wallet_debit('71000000-0000-0000-0000-000000000002', 250, 'order_cod', 'r13-spesa-2');
  PERFORM public.wallet_credit('71000000-0000-0000-0000-000000000002', 250, 'order_cod_refund', 'r13-spesa-2');
  PERFORM pg_temp.invecchia('71000000-0000-0000-0000-00000000b002');
  PERFORM public.libera_riserve_della_cassa();
  INSERT INTO esiti VALUES ('credito gia restituito dalla rotta: torna la merce, il credito non si raddoppia',
    pg_temp.stato('71000000-0000-0000-0000-00000000b002') = 'liberata'
      AND pg_temp.scorta('71000000-0000-0000-0000-0000000000a2') = scorta_prima
      AND pg_temp.saldo() = saldo_prima,
    format('scorta %s (attesa %s), saldo %s (atteso %s)', pg_temp.scorta('71000000-0000-0000-0000-0000000000a2'), scorta_prima,
           pg_temp.saldo(), saldo_prima));
END $$;

-- ── ③ Morta fra l'ordine e gli articoli ────────────────────────────────────
DO $$
DECLARE scorta_prima int := pg_temp.scorta('71000000-0000-0000-0000-0000000000a2'); saldo_prima int := pg_temp.saldo();
BEGIN
  PERFORM public.reserve_stock(pg_temp.merce('71000000-0000-0000-0000-0000000000a2', 3),
                               pg_temp.riga('71000000-0000-0000-0000-00000000b003', '71000000-0000-0000-0000-00000000c003', 'r13-spesa-3'));
  PERFORM public.wallet_debit('71000000-0000-0000-0000-000000000002', 200, 'order_cod', 'r13-spesa-3');
  PERFORM pg_temp.ordine('71000000-0000-0000-0000-00000000c003', 200);
  PERFORM pg_temp.invecchia('71000000-0000-0000-0000-00000000b003');
  PERFORM public.libera_riserve_della_cassa();
  INSERT INTO esiti VALUES ('ordine senza articoli: la merce torna, il credito resta scritto sull ordine',
    pg_temp.stato('71000000-0000-0000-0000-00000000b003') = 'a_meta'
      AND pg_temp.scorta('71000000-0000-0000-0000-0000000000a2') = scorta_prima
      AND pg_temp.saldo() = saldo_prima - 200,
    format('riga %s, scorta %s (attesa %s), saldo %s (atteso %s)', pg_temp.stato('71000000-0000-0000-0000-00000000b003'),
           pg_temp.scorta('71000000-0000-0000-0000-0000000000a2'), scorta_prima, pg_temp.saldo(), saldo_prima - 200));

  -- Poi l'ordine si annulla (il giro degli ordini fermi): la merce non torna una seconda volta.
  PERFORM public.restore_stock_for_order('71000000-0000-0000-0000-00000000c003');
  INSERT INTO esiti VALUES ('l annullo dopo la pulizia non rimette la merce una seconda volta',
    pg_temp.scorta('71000000-0000-0000-0000-0000000000a2') = scorta_prima,
    format('scorta %s (attesa %s)', pg_temp.scorta('71000000-0000-0000-0000-0000000000a2'), scorta_prima));
END $$;

-- ── ④ Ordine intero: la merce resta venduta ────────────────────────────────
DO $$
DECLARE scorta_prima int := pg_temp.scorta('71000000-0000-0000-0000-0000000000a1');
BEGIN
  PERFORM public.reserve_stock(pg_temp.merce('71000000-0000-0000-0000-0000000000a1', 1),
                               pg_temp.riga('71000000-0000-0000-0000-00000000b004', '71000000-0000-0000-0000-00000000c004', 'r13-spesa-4'));
  PERFORM pg_temp.ordine('71000000-0000-0000-0000-00000000c004', 0);
  PERFORM pg_temp.articolo('71000000-0000-0000-0000-00000000c004', '71000000-0000-0000-0000-0000000000a1', 1);
  PERFORM pg_temp.invecchia('71000000-0000-0000-0000-00000000b004');
  PERFORM public.libera_riserve_della_cassa();
  INSERT INTO esiti VALUES ('ordine intero morto prima di chiudere la riga: la riga si chiude, la merce resta venduta',
    pg_temp.stato('71000000-0000-0000-0000-00000000b004') = 'ordine'
      AND pg_temp.scorta('71000000-0000-0000-0000-0000000000a1') = scorta_prima - 1,
    format('riga %s, scorta %s (attesa %s)', pg_temp.stato('71000000-0000-0000-0000-00000000b004'),
           pg_temp.scorta('71000000-0000-0000-0000-0000000000a1'), scorta_prima - 1));
END $$;

-- ── ⑤ Lo storno della rotta chiude la riga ─────────────────────────────────
DO $$
DECLARE scorta_prima int := pg_temp.scorta('71000000-0000-0000-0000-0000000000a1');
BEGIN
  PERFORM public.reserve_stock(pg_temp.merce('71000000-0000-0000-0000-0000000000a1', 1),
                               pg_temp.riga('71000000-0000-0000-0000-00000000b005', '71000000-0000-0000-0000-00000000c005', 'r13-spesa-5'));
  PERFORM public.restore_stock(pg_temp.merce('71000000-0000-0000-0000-0000000000a1', 1), '71000000-0000-0000-0000-00000000b005'::uuid);
  PERFORM public.restore_stock(pg_temp.merce('71000000-0000-0000-0000-0000000000a1', 1), '71000000-0000-0000-0000-00000000b005'::uuid);
  PERFORM pg_temp.invecchia('71000000-0000-0000-0000-00000000b005');
  PERFORM public.libera_riserve_della_cassa();
  INSERT INTO esiti VALUES ('lo storno con la riga rimette la merce una volta sola, e la pulizia dopo non la rimette',
    pg_temp.stato('71000000-0000-0000-0000-00000000b005') = 'rimessa'
      AND pg_temp.scorta('71000000-0000-0000-0000-0000000000a1') = scorta_prima,
    format('riga %s, scorta %s (attesa %s)', pg_temp.stato('71000000-0000-0000-0000-00000000b005'),
           pg_temp.scorta('71000000-0000-0000-0000-0000000000a1'), scorta_prima));
END $$;

-- ── ⑥ Lo stesso identificativo ripreso da un secondo invio della stessa chiave ──
DO $$
DECLARE scorta_prima int := pg_temp.scorta('71000000-0000-0000-0000-0000000000a2'); saldo_prima int := pg_temp.saldo(); chiuse int;
BEGIN
  -- Il primo invio prende merce e credito e muore prima dell'ordine.
  PERFORM public.reserve_stock(pg_temp.merce('71000000-0000-0000-0000-0000000000a2', 1),
                               pg_temp.riga('71000000-0000-0000-0000-00000000b061', '71000000-0000-0000-0000-00000000c006', 'r13-spesa-61'));
  PERFORM public.wallet_debit('71000000-0000-0000-0000-000000000002', 100, 'order_cod', 'r13-spesa-61');
  -- Un minuto dopo il secondo riprende la chiave: stesso ordine previsto, lo scrive intero e chiude la sua riga.
  PERFORM public.reserve_stock(pg_temp.merce('71000000-0000-0000-0000-0000000000a2', 1),
                               pg_temp.riga('71000000-0000-0000-0000-00000000b062', '71000000-0000-0000-0000-00000000c006', 'r13-spesa-62'));
  PERFORM public.wallet_debit('71000000-0000-0000-0000-000000000002', 100, 'order_cod', 'r13-spesa-62');
  PERFORM pg_temp.ordine('71000000-0000-0000-0000-00000000c006', 100);
  PERFORM pg_temp.articolo('71000000-0000-0000-0000-00000000c006', '71000000-0000-0000-0000-0000000000a2', 1);
  chiuse := public.chiudi_riserve_della_cassa(ARRAY['71000000-0000-0000-0000-00000000b062'::uuid]);
  PERFORM pg_temp.invecchia('71000000-0000-0000-0000-00000000b061');
  PERFORM pg_temp.invecchia('71000000-0000-0000-0000-00000000b062');
  PERFORM public.libera_riserve_della_cassa();
  INSERT INTO esiti VALUES ('chiave ripresa: torna la merce e il credito del primo invio, quella del secondo resta venduta',
    chiuse = 1
      AND pg_temp.stato('71000000-0000-0000-0000-00000000b061') = 'liberata'
      AND pg_temp.stato('71000000-0000-0000-0000-00000000b062') = 'ordine'
      AND pg_temp.scorta('71000000-0000-0000-0000-0000000000a2') = scorta_prima - 1
      AND pg_temp.saldo() = saldo_prima - 100,
    format('chiuse %s, righe %s/%s, scorta %s (attesa %s), saldo %s (atteso %s)', chiuse,
           pg_temp.stato('71000000-0000-0000-0000-00000000b061'), pg_temp.stato('71000000-0000-0000-0000-00000000b062'),
           pg_temp.scorta('71000000-0000-0000-0000-0000000000a2'), scorta_prima - 1, pg_temp.saldo(), saldo_prima - 100));
END $$;

-- ── ⑦ Due righe aperte sullo stesso ordine: non si sa di chi e' la merce ────
DO $$
DECLARE scorta_prima int := pg_temp.scorta('71000000-0000-0000-0000-0000000000a1'); esito jsonb;
BEGIN
  PERFORM public.reserve_stock(pg_temp.merce('71000000-0000-0000-0000-0000000000a1', 1),
                               pg_temp.riga('71000000-0000-0000-0000-00000000b071', '71000000-0000-0000-0000-00000000c007', 'r13-spesa-71'));
  PERFORM public.reserve_stock(pg_temp.merce('71000000-0000-0000-0000-0000000000a1', 1),
                               pg_temp.riga('71000000-0000-0000-0000-00000000b072', '71000000-0000-0000-0000-00000000c007', 'r13-spesa-72'));
  PERFORM pg_temp.ordine('71000000-0000-0000-0000-00000000c007', 0);
  PERFORM pg_temp.articolo('71000000-0000-0000-0000-00000000c007', '71000000-0000-0000-0000-0000000000a1', 1);
  PERFORM pg_temp.invecchia('71000000-0000-0000-0000-00000000b071');
  PERFORM pg_temp.invecchia('71000000-0000-0000-0000-00000000b072');
  esito := public.libera_riserve_della_cassa();
  INSERT INTO esiti VALUES ('due righe aperte sullo stesso ordine: nessuna merce rimessa, contate fra le incerte',
    pg_temp.stato('71000000-0000-0000-0000-00000000b071') = 'aperta'
      AND pg_temp.stato('71000000-0000-0000-0000-00000000b072') = 'aperta'
      AND pg_temp.scorta('71000000-0000-0000-0000-0000000000a1') = scorta_prima - 2
      AND (esito->>'incerte')::int = 2,
    format('scorta %s (attesa %s), esito %s', pg_temp.scorta('71000000-0000-0000-0000-0000000000a1'), scorta_prima - 2, esito));
  -- Fuori dai casi dopo: le due righe si chiudono a mano, come farebbe chi controlla.
  UPDATE interno.riserve_della_cassa SET stato = 'ordine' WHERE ordine_id = '71000000-0000-0000-0000-00000000c007';
END $$;

-- ── ⑧ L'annullo di un ordine senza articoli rimette la sua merce ───────────
DO $$
DECLARE scorta_prima int := pg_temp.scorta('71000000-0000-0000-0000-0000000000a1');
BEGIN
  PERFORM public.reserve_stock(pg_temp.merce('71000000-0000-0000-0000-0000000000a1', 2),
                               pg_temp.riga('71000000-0000-0000-0000-00000000b008', '71000000-0000-0000-0000-00000000c008', 'r13-spesa-8'));
  PERFORM pg_temp.ordine('71000000-0000-0000-0000-00000000c008', 0);
  PERFORM public.restore_stock_for_order('71000000-0000-0000-0000-00000000c008');
  PERFORM public.restore_stock_for_order('71000000-0000-0000-0000-00000000c008');
  INSERT INTO esiti VALUES ('annullare l ordine rimasto a meta rimette la sua merce, una volta sola',
    pg_temp.stato('71000000-0000-0000-0000-00000000b008') = 'a_meta'
      AND pg_temp.scorta('71000000-0000-0000-0000-0000000000a1') = scorta_prima,
    format('riga %s, scorta %s (attesa %s)', pg_temp.stato('71000000-0000-0000-0000-00000000b008'),
           pg_temp.scorta('71000000-0000-0000-0000-0000000000a1'), scorta_prima));
  PERFORM pg_temp.invecchia('71000000-0000-0000-0000-00000000b008');
  PERFORM public.libera_riserve_della_cassa();
  INSERT INTO esiti VALUES ('dopo l annullo la pulizia non rimette la stessa merce',
    pg_temp.scorta('71000000-0000-0000-0000-0000000000a1') = scorta_prima,
    format('scorta %s (attesa %s)', pg_temp.scorta('71000000-0000-0000-0000-0000000000a1'), scorta_prima));
END $$;

-- ── ⑨ «Ordine» solo se gli articoli ci sono ────────────────────────────────
DO $$
DECLARE chiuse int;
BEGIN
  PERFORM public.reserve_stock(pg_temp.merce('71000000-0000-0000-0000-0000000000a1', 1),
                               pg_temp.riga('71000000-0000-0000-0000-00000000b009', '71000000-0000-0000-0000-00000000c009', 'r13-spesa-9'));
  PERFORM pg_temp.ordine('71000000-0000-0000-0000-00000000c009', 0);
  chiuse := public.chiudi_riserve_della_cassa(ARRAY['71000000-0000-0000-0000-00000000b009'::uuid]);
  INSERT INTO esiti VALUES ('una riga non si chiude come «ordine» se l ordine non ha articoli',
    chiuse = 0 AND pg_temp.stato('71000000-0000-0000-0000-00000000b009') = 'aperta',
    format('chiuse %s, riga %s', chiuse, pg_temp.stato('71000000-0000-0000-0000-00000000b009')));
END $$;

-- ── ⑩ Chi chiama come prima ottiene quello di prima ────────────────────────
DO $$
DECLARE scorta_prima int := pg_temp.scorta('71000000-0000-0000-0000-0000000000a2'); righe_prima int;
BEGIN
  SELECT count(*) INTO righe_prima FROM interno.riserve_della_cassa;
  PERFORM public.reserve_stock(pg_temp.merce('71000000-0000-0000-0000-0000000000a2', 2));
  PERFORM public.restore_stock(pg_temp.merce('71000000-0000-0000-0000-0000000000a2', 1));
  INSERT INTO esiti VALUES ('la carta e i giri chiamano reserve_stock e restore_stock come prima: nessuna riga',
    pg_temp.scorta('71000000-0000-0000-0000-0000000000a2') = scorta_prima - 1
      AND (SELECT count(*) FROM interno.riserve_della_cassa) = righe_prima,
    format('scorta %s (attesa %s)', pg_temp.scorta('71000000-0000-0000-0000-0000000000a2'), scorta_prima - 1));
END $$;

-- ── ⑪ Nessun client le esegue, nessuno legge la tabella ────────────────────
INSERT INTO esiti
SELECT 'le funzioni della riserva sono solo del server',
       count(*) = 0,
       coalesce('aperte: ' || string_agg(p.oid::regprocedure::text || ' a ' || ruolo, ', '), 'tutte chiuse')
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(ruolo)
 WHERE n.nspname = 'public'
   AND p.proname IN ('reserve_stock', 'restore_stock', 'chiudi_riserve_della_cassa', 'libera_riserve_della_cassa', 'restore_stock_for_order')
   AND has_function_privilege(ruolo, p.oid, 'EXECUTE');

INSERT INTO esiti
SELECT 'la tabella delle riserve non la raggiunge nessun client',
       NOT has_schema_privilege('anon', 'interno', 'USAGE')
   AND NOT has_schema_privilege('authenticated', 'interno', 'USAGE')
   AND NOT has_table_privilege('anon', 'interno.riserve_della_cassa', 'SELECT')
   AND NOT has_table_privilege('authenticated', 'interno.riserve_della_cassa', 'SELECT'),
       'anon/authenticated';

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

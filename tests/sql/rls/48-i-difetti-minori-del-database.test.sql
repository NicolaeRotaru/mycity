-- =============================================================================
-- I difetti minori del database (migrazione 215, sessione S04, 5/11/2026)
-- =============================================================================
-- Gira contro un database ricostruito dalle migrazioni vere:
--   tests/sql/harness/apply.sh mycity_test
--   tests/sql/harness/run.sh   mycity_test
-- Ogni controllo porta fra parentesi il numero della scheda che chiude.
-- Senza la 215 i controlli sono ROSSI (provato togliendo la migrazione).
-- Tutto in transazione, ROLLBACK.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';
SET LOCAL mycity.allow_order_write   = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated;

-- Il premio invito al lancio è spento (168): qui si accende per provarlo.
CREATE OR REPLACE FUNCTION public.punti_fedelta_accesi() RETURNS boolean LANGUAGE sql AS 'SELECT true';

INSERT INTO auth.users (id, email, raw_user_meta_data, email_confirmed_at) VALUES
  ('d4800000-0000-0000-0000-000000000001', 'forno-48@test.it',     '{"role":"seller"}', now()),
  ('d4800000-0000-0000-0000-000000000002', 'rider-on-48@test.it',  '{"role":"rider"}',  now()),
  ('d4800000-0000-0000-0000-000000000003', 'maria-48@test.it',     '{"role":"buyer","full_name":"Maria Rossi"}', now()),
  ('d4800000-0000-0000-0000-000000000004', 'capo-48@test.it',      '{"role":"admin"}',  now()),
  ('d4800000-0000-0000-0000-000000000005', 'rider-off-48@test.it', '{"role":"rider"}',  now()),
  ('d4800000-0000-0000-0000-000000000006', 'giulia-48@test.it',    '{"role":"buyer"}',  now()),
  ('d4800000-0000-0000-0000-000000000007', 'nonconf-48@test.it',   '{"role":"buyer"}',  NULL);

UPDATE public.profiles
   SET is_approved = true, approval_status = 'approved', store_name = 'Pane Quotidiano',
       store_address = 'Via Roma 1, Piacenza'
 WHERE id = 'd4800000-0000-0000-0000-000000000001';
UPDATE public.profiles SET is_approved = true, approval_status = 'approved', rider_is_online = true
 WHERE id = 'd4800000-0000-0000-0000-000000000002';
UPDATE public.profiles SET is_approved = true, approval_status = 'approved', rider_is_online = false
 WHERE id = 'd4800000-0000-0000-0000-000000000005';
UPDATE public.profiles SET role = 'admin' WHERE id = 'd4800000-0000-0000-0000-000000000004';

-- ── ㉗ Il nome scritto alla registrazione (183) ─────────────────────────────
INSERT INTO esiti
SELECT 'il nome scritto alla registrazione arriva nel profilo (183)',
       full_name = 'Maria Rossi', coalesce(full_name, '(vuoto)')
  FROM public.profiles WHERE id = 'd4800000-0000-0000-0000-000000000003';

-- ── ㉚ Benvenuto solo a email confermata (542) ─────────────────────────────
INSERT INTO esiti
SELECT 'chi non ha confermato l email non riceve il benvenuto (542)',
       count(*) = 0, count(*) || ' email in coda'
  FROM public.email_queue WHERE user_id = 'd4800000-0000-0000-0000-000000000007';
UPDATE auth.users SET email_confirmed_at = now() WHERE id = 'd4800000-0000-0000-0000-000000000007';
INSERT INTO esiti
SELECT 'alla conferma dell email il benvenuto entra in coda, una volta (542)',
       count(*) FILTER (WHERE template = 'welcome') = 1, string_agg(template, ',')
  FROM public.email_queue WHERE user_id = 'd4800000-0000-0000-0000-000000000007';
INSERT INTO esiti
SELECT 'chi nasce già confermato riceve il benvenuto (542)',
       count(*) FILTER (WHERE template = 'welcome') = 1, count(*) || ' email'
  FROM public.email_queue WHERE user_id = 'd4800000-0000-0000-0000-000000000003';

-- Ordini: uno da consegnare (A), uno da ritirare in negozio (B), uno consegnato
-- e pagato (C), uno consegnato e rimborsato (D), uno annullato vecchio (E).
INSERT INTO public.orders (
  id, user_id, seller_id, rider_id, total_price, gross_total_cents, payment_method, payment_status,
  delivery_status, pickup_in_store, payout_status, seller_payout_cents, rider_fee_cents,
  delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip,
  wallet_applied_cents, refunded_amount_cents, delivered_at, canceled_at
) VALUES
  ('d4800000-0000-0000-0000-0000000000a1', 'd4800000-0000-0000-0000-000000000003', 'd4800000-0000-0000-0000-000000000001', NULL,
   20, 2000, 'card', 'PAID', 'NEW', false, 'HELD', 1800, 300, 'Maria Rossi', '333', 'Via Verdi 1', 'Piacenza', '29121', 0, 0, NULL, NULL),
  ('d4800000-0000-0000-0000-0000000000b1', 'd4800000-0000-0000-0000-000000000003', 'd4800000-0000-0000-0000-000000000001', NULL,
   12, 1200, 'card', 'PAID', 'NEW', true, 'HELD', 1080, 0, 'Maria Rossi', '333', 'Via Verdi 1', 'Piacenza', '29121', 0, 0, NULL, NULL),
  ('d4800000-0000-0000-0000-0000000000c1', 'd4800000-0000-0000-0000-000000000006', 'd4800000-0000-0000-0000-000000000001', NULL,
   30, 3500, 'cod', 'PAID', 'DELIVERED', false, 'TRANSFERRED', 3000, 300, 'Giulia', '333', 'Via Po 2', 'Piacenza', '29121', 500, 0, now() - interval '1 day', NULL),
  ('d4800000-0000-0000-0000-0000000000d1', 'd4800000-0000-0000-0000-000000000006', 'd4800000-0000-0000-0000-000000000001', NULL,
   40, 4000, 'card', 'REFUNDED', 'DELIVERED', false, 'REFUNDED', 3600, 300, 'Giulia', '333', 'Via Po 2', 'Piacenza', '29121', 0, 4000, now() - interval '1 day', NULL),
  ('d4800000-0000-0000-0000-0000000000e1', 'd4800000-0000-0000-0000-000000000006', 'd4800000-0000-0000-0000-000000000001', 'd4800000-0000-0000-0000-000000000002',
   10, 1000, 'cod', 'PENDING', 'CANCELED', false, NULL, 900, 300, 'Giulia', '333 999', 'Via Po 2', 'Piacenza', '29121', 0, 0, NULL, now() - interval '30 days');

-- ── ⑧ Il «Ci manchi» non parte a chi ha ordinato (544) ──────────────────────
INSERT INTO esiti
SELECT 'il win-back dei 60 giorni si cancella quando il cliente ordina (544)',
       count(*) FILTER (WHERE cancelled_at IS NULL) = 0, count(*) || ' win-back, ' ||
       count(*) FILTER (WHERE cancelled_at IS NULL) || ' ancora attivi'
  FROM public.email_queue WHERE user_id = 'd4800000-0000-0000-0000-000000000003' AND template = 'winback_60d';

-- ── ② Avvisi ai fattorini (169, 473) ────────────────────────────────────────
UPDATE public.orders SET delivery_status = 'ACCEPTED' WHERE id IN ('d4800000-0000-0000-0000-0000000000a1', 'd4800000-0000-0000-0000-0000000000b1');
UPDATE public.orders SET delivery_status = 'READY'    WHERE id IN ('d4800000-0000-0000-0000-0000000000a1', 'd4800000-0000-0000-0000-0000000000b1');
INSERT INTO esiti
SELECT 'il fattorino in servizio riceve «preparazione» e «pronto» una volta sola, non per il ritiro in negozio (169)',
       count(*) = 2, count(*) || ' avvisi'
  FROM public.notifications WHERE user_id = 'd4800000-0000-0000-0000-000000000002' AND link = '/rider';
INSERT INTO esiti
SELECT 'il fattorino offline non riceve gli avvisi delle consegne (473)',
       count(*) = 0, count(*) || ' avvisi'
  FROM public.notifications WHERE user_id = 'd4800000-0000-0000-0000-000000000005' AND link = '/rider';

-- ── ⑲ ㉛ «Ordine pronto» nella campanella (2090, 982) ──────────────────────
INSERT INTO esiti
SELECT 'ordine pronto da consegnare: «un rider passa a prenderlo», senza faccina (2090, 982)',
       bool_and(body LIKE '%un rider passa a prenderlo%' AND title = 'Ordine pronto'), string_agg(title || ' | ' || body, ' / ')
  FROM public.notifications WHERE user_id = 'd4800000-0000-0000-0000-000000000003'
   AND link = '/orders/d4800000-0000-0000-0000-0000000000a1' AND title LIKE '%pronto%';
INSERT INTO esiti
SELECT 'ordine pronto da ritirare: si passa in negozio, nessun rider (2090)',
       bool_and(body LIKE '%passare a ritirarlo in negozio%' AND body NOT LIKE '%rider%'), string_agg(body, ' / ')
  FROM public.notifications WHERE user_id = 'd4800000-0000-0000-0000-000000000003'
   AND link = '/orders/d4800000-0000-0000-0000-0000000000b1' AND title LIKE '%pronto%';
INSERT INTO esiti
SELECT 'nessuna funzione del database scrive nella campanella un titolo che comincia con una faccina (982)',
       count(*) = 0, coalesce(string_agg(p.proname, ', '), 'nessuna')
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.prosrc ILIKE '%notifications%'
   AND p.prosrc ~ '''[\U0001F300-\U0001FAFF☀-➿]';

-- ── ⑪ Il rider lascia l'ordine (145) ─────────────────────────────────────────
UPDATE public.orders SET delivery_status = 'ASSIGNED', rider_id = 'd4800000-0000-0000-0000-000000000002'
 WHERE id = 'd4800000-0000-0000-0000-0000000000a1';
SET LOCAL mycity.allow_order_write = '';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"d4800000-0000-0000-0000-000000000002","role":"authenticated"}';
DO $$
DECLARE esito jsonb;
BEGIN
  esito := public.rider_release_order('d4800000-0000-0000-0000-0000000000a1');
  INSERT INTO esiti VALUES ('il rider puo lasciare l ordine (145)', (esito->>'ok')::boolean, esito::text);
END $$;
RESET ROLE;
RESET request.jwt.claims;
SET LOCAL mycity.allow_order_write = '1';
INSERT INTO esiti
SELECT 'dopo il rilascio il negozio lo sa (145)', count(*) = 1, count(*) || ' avvisi'
  FROM public.notifications WHERE user_id = 'd4800000-0000-0000-0000-000000000001' AND title = 'Il rider ha lasciato l''ordine';
INSERT INTO esiti
SELECT 'dopo il rilascio il cliente non riceve un secondo «ordine pronto» (145)', count(*) = 1, count(*) || ' avvisi «pronto»'
  FROM public.notifications WHERE user_id = 'd4800000-0000-0000-0000-000000000003'
   AND link = '/orders/d4800000-0000-0000-0000-0000000000a1' AND title LIKE '%pronto%';
INSERT INTO esiti
SELECT 'dopo il rilascio nessuna seconda email «ordine pronto» (145)', count(*) = 1, count(*) || ' email'
  FROM public.email_queue WHERE user_id = 'd4800000-0000-0000-0000-000000000003' AND template = 'order_ready'
   AND metadata->>'orderId' = 'd4800000-0000-0000-0000-0000000000a1';
INSERT INTO esiti
SELECT 'chi ha lasciato l ordine non se lo vede riproporre (145)', count(*) = 1, count(*) || ' avvisi «pronto»'
  FROM public.notifications WHERE user_id = 'd4800000-0000-0000-0000-000000000002' AND title LIKE 'Ordine pronto%';

-- ── ① Le notifiche si segnano lette, non si riscrivono (2063) ───────────────
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"d4800000-0000-0000-0000-000000000003","role":"authenticated"}';
DO $$
DECLARE riscritta boolean := false; letta int;
BEGIN
  UPDATE public.notifications SET is_read = true WHERE user_id = 'd4800000-0000-0000-0000-000000000003';
  GET DIAGNOSTICS letta = ROW_COUNT;
  BEGIN
    UPDATE public.notifications SET body = 'ti abbiamo promesso 1000 euro' WHERE user_id = 'd4800000-0000-0000-0000-000000000003';
    riscritta := true;
  EXCEPTION WHEN insufficient_privilege THEN riscritta := false;
  END;
  INSERT INTO esiti VALUES ('il cliente segna le sue notifiche come lette (2063)', letta > 0, letta || ' segnate');
  INSERT INTO esiti VALUES ('il cliente non riscrive il testo di una notifica (2063)', NOT riscritta,
    CASE WHEN riscritta THEN 'riscritta' ELSE 'rifiutata' END);
END $$;
RESET ROLE;
RESET request.jwt.claims;

-- ── ⑮ vuole_notifica solo al server (686) ─────────────────────────────────────
INSERT INTO esiti
SELECT 'vuole_notifica non la chiama un utente del browser (686)',
       NOT has_function_privilege('authenticated', 'public.vuole_notifica(uuid, text)', 'EXECUTE')
       AND NOT has_function_privilege('anon', 'public.vuole_notifica(uuid, text)', 'EXECUTE'), '';

-- ── ⑰ Abbonamenti (697) ─────────────────────────────────────────────────────
INSERT INTO esiti
SELECT 'un cliente non inserisce un abbonamento col prezzo che vuole (697)',
       NOT has_table_privilege('authenticated', 'public.subscription_orders', 'INSERT'), '';

-- ── ㉔ Scritture dell'anonimo (699) ─────────────────────────────────────────────
INSERT INTO esiti
SELECT 'l anonimo non ha scritture fuori da visite, contatti e segnalazioni (699)',
       count(*) = 0, coalesce(string_agg(table_name || ':' || privilege_type, ', '), 'nessuna')
  FROM information_schema.role_table_grants
 WHERE grantee = 'anon' AND table_schema = 'public' AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE')
   AND NOT (privilege_type = 'INSERT' AND table_name IN ('product_views', 'contact_messages', 'segnalazioni'));
INSERT INTO esiti
SELECT 'l anonimo scrive ancora visite, contatti e segnalazioni (699)',
       has_table_privilege('anon', 'public.product_views', 'INSERT')
       AND has_table_privilege('anon', 'public.contact_messages', 'INSERT')
       AND has_table_privilege('anon', 'public.segnalazioni', 'INSERT'), '';

-- ── ③ Indice doppio (678) ────────────────────────────────────────────────────
INSERT INTO esiti
SELECT 'order_items ha un solo indice su order_id (678)', count(*) = 1, string_agg(indexname, ', ')
  FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'order_items'
   AND indexdef ~ 'USING btree \(order_id\)$';

-- ── ④ Chi ha approvato si cancella; il reclamo resta (95, 1704) ─────────────
UPDATE public.profiles SET approved_by = 'd4800000-0000-0000-0000-000000000004'
 WHERE id = 'd4800000-0000-0000-0000-000000000001';
INSERT INTO public.disputes (order_id, opener_id, against_id, reason, description, status)
VALUES ('d4800000-0000-0000-0000-0000000000c1', 'd4800000-0000-0000-0000-000000000006',
        'd4800000-0000-0000-0000-000000000001', 'other', 'pane bruciato', 'resolved_buyer');
DO $$
DECLARE cancellato boolean;
BEGIN
  BEGIN
    DELETE FROM auth.users WHERE id = 'd4800000-0000-0000-0000-000000000004';
    cancellato := true;
  EXCEPTION WHEN foreign_key_violation THEN cancellato := false;
  END;
  INSERT INTO esiti VALUES ('l amministratore che ha approvato un negozio si puo cancellare (95)', cancellato, '');
END $$;
DO $$
DECLARE restano int;
BEGIN
  -- Giulia cancella l'account: i suoi ordini restano col negozio, il reclamo deve restare.
  UPDATE public.orders SET user_id = NULL WHERE user_id = 'd4800000-0000-0000-0000-000000000006';
  BEGIN
    DELETE FROM auth.users WHERE id = 'd4800000-0000-0000-0000-000000000006';
  EXCEPTION WHEN OTHERS THEN
    RAISE INFO 'cancellazione di prova non riuscita: %', SQLERRM;
  END;
  SELECT count(*) INTO restano FROM public.disputes WHERE order_id = 'd4800000-0000-0000-0000-0000000000c1';
  INSERT INTO esiti VALUES ('un reclamo chiuso resta quando chi l ha aperto cancella l account (1704)', restano = 1, restano || ' reclami');
END $$;

-- ── ⑩ Il reclamo nasce aperto (1660) ─────────────────────────────────────────
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"d4800000-0000-0000-0000-000000000003","role":"authenticated"}';
DO $$
DECLARE passato boolean; aperto boolean;
BEGIN
  BEGIN
    INSERT INTO public.disputes (order_id, opener_id, reason, description, status, refund_cents)
    VALUES ('d4800000-0000-0000-0000-0000000000b1', 'd4800000-0000-0000-0000-000000000003', 'other', 'finto', 'resolved_buyer', 99999);
    passato := true;
  EXCEPTION WHEN insufficient_privilege THEN passato := false;
  END;
  BEGIN
    INSERT INTO public.disputes (order_id, opener_id, reason, description, status)
    VALUES ('d4800000-0000-0000-0000-0000000000b1', 'd4800000-0000-0000-0000-000000000003', 'other', 'vero', 'open');
    aperto := true;
  EXCEPTION WHEN insufficient_privilege THEN aperto := false;
  END;
  INSERT INTO esiti VALUES ('il cliente non scrive un reclamo già chiuso con un rimborso (1660)', NOT passato, '');
  INSERT INTO esiti VALUES ('il cliente apre ancora un reclamo vero (1660)', aperto, '');
END $$;
RESET ROLE;
RESET request.jwt.claims;

-- ── ⑤ La domanda non si riscrive (454) ─────────────────────────────────────────
INSERT INTO public.products (id, seller_id, name, description, price, stock, status)
VALUES ('d4800000-0000-0000-0000-0000000000f1', 'd4800000-0000-0000-0000-000000000001', 'Focaccia', 'Focaccia', 3, 10, 'available');
INSERT INTO public.product_questions (id, product_id, author_id, question, is_public)
VALUES ('d4800000-0000-0000-0000-0000000000f2', 'd4800000-0000-0000-0000-0000000000f1', 'd4800000-0000-0000-0000-000000000003', 'È senza lattosio?', true);
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"d4800000-0000-0000-0000-000000000001","role":"authenticated"}';
DO $$
DECLARE risposto boolean; riscritto boolean;
BEGIN
  UPDATE public.product_questions SET answer = 'Sì', answered_by = 'd4800000-0000-0000-0000-000000000001', answered_at = now()
   WHERE id = 'd4800000-0000-0000-0000-0000000000f2';
  risposto := FOUND;
  BEGIN
    UPDATE public.product_questions SET question = 'Fa schifo?' WHERE id = 'd4800000-0000-0000-0000-0000000000f2';
    riscritto := FOUND;
  EXCEPTION WHEN insufficient_privilege THEN riscritto := false;
  END;
  INSERT INTO esiti VALUES ('il negozio risponde alla domanda (454)', risposto, '');
  INSERT INTO esiti VALUES ('il negozio non riscrive la domanda del cliente (454)', NOT riscritto, '');
END $$;
RESET ROLE;
RESET request.jwt.claims;

-- ── ⑳ «Prezzo abbassato» (181) ───────────────────────────────────────────────
INSERT INTO public.favorites (user_id, product_id) VALUES ('d4800000-0000-0000-0000-000000000003', 'd4800000-0000-0000-0000-0000000000f1');
UPDATE public.products SET price = 2.40 WHERE id = 'd4800000-0000-0000-0000-0000000000f1';
UPDATE public.products SET price = 3.00 WHERE id = 'd4800000-0000-0000-0000-0000000000f1';
UPDATE public.products SET price = 2.10 WHERE id = 'd4800000-0000-0000-0000-0000000000f1';
INSERT INTO esiti
SELECT 'abbassa-rialza-riabbassa: un avviso solo, col prezzo all italiana (181)',
       count(*) = 1 AND bool_and(body LIKE '%€ 3,00 a € 2,40%'), string_agg(body, ' / ')
  FROM public.notifications WHERE user_id = 'd4800000-0000-0000-0000-000000000003' AND title LIKE '%Prezzo abbassato%';
UPDATE public.products SET status = 'draft', price = 9 WHERE id = 'd4800000-0000-0000-0000-0000000000f1';
DELETE FROM public.notifications WHERE title LIKE '%Prezzo abbassato%';
UPDATE public.products SET price = 5 WHERE id = 'd4800000-0000-0000-0000-0000000000f1';
INSERT INTO esiti
SELECT 'un prodotto non in vendita non manda «prezzo abbassato» (181)', count(*) = 0, count(*) || ' avvisi'
  FROM public.notifications WHERE title LIKE '%Prezzo abbassato%';

-- ── ㉑ L'anteprima della chat (94) ──────────────────────────────────────────────
INSERT INTO public.conversations (id, buyer_id, seller_id)
VALUES ('d4800000-0000-0000-0000-0000000000c9', 'd4800000-0000-0000-0000-000000000003', 'd4800000-0000-0000-0000-000000000001');
INSERT INTO public.messages (conversation_id, sender_id, body)
VALUES ('d4800000-0000-0000-0000-0000000000c9', 'd4800000-0000-0000-0000-000000000001', 'Buongiorno!');
INSERT INTO public.messages (conversation_id, sender_id, body, created_at)
VALUES ('d4800000-0000-0000-0000-0000000000c9', 'd4800000-0000-0000-0000-000000000003', 'Abito in via Verdi 1, citofono Rossi', now() + interval '1 minute');
DELETE FROM public.messages WHERE sender_id = 'd4800000-0000-0000-0000-000000000003';
INSERT INTO esiti
SELECT 'l anteprima della chat non tiene il messaggio cancellato (94)',
       coalesce(last_message_preview, '') NOT LIKE '%via Verdi%', coalesce(last_message_preview, '(vuota)')
  FROM public.conversations WHERE id = 'd4800000-0000-0000-0000-0000000000c9';

-- ── ㉒ Il fattorino e gli ordini annullati (103) ───────────────────────────────
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"d4800000-0000-0000-0000-000000000002","role":"authenticated"}';
INSERT INTO esiti
SELECT 'il fattorino non legge un ordine annullato un mese fa (103)', count(*) = 0, count(*) || ' righe'
  FROM public.orders WHERE id = 'd4800000-0000-0000-0000-0000000000e1';
RESET ROLE;
RESET request.jwt.claims;

-- ── ㉓ «Venduti» (786) ─────────────────────────────────────────────────────────
INSERT INTO public.order_items (order_id, product_id, quantity, unit_price)
VALUES ('d4800000-0000-0000-0000-0000000000c1', 'd4800000-0000-0000-0000-0000000000f1', 2, 3),
       ('d4800000-0000-0000-0000-0000000000d1', 'd4800000-0000-0000-0000-0000000000f1', 5, 3);
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"d4800000-0000-0000-0000-000000000001","role":"authenticated"}';
INSERT INTO esiti
SELECT 'un ordine rimborsato non conta tra i venduti (786)', coalesce(sum(venduti), 0) = 2, coalesce(sum(venduti), 0) || ' venduti'
  FROM public.venduti_per_prodotto(ARRAY['d4800000-0000-0000-0000-0000000000f1']::uuid[]);
RESET ROLE;
RESET request.jwt.claims;

-- ── ⑯ «Ricavi totali» (654) ────────────────────────────────────────────────────
-- C: 30 € in contanti + 5 € di credito = 35 €; D: 40 € rimborsati per intero = 0.
-- L'amministratore della prova è stato cancellato sopra: ne serve uno vivo.
INSERT INTO auth.users (id, email, raw_user_meta_data, email_confirmed_at)
VALUES ('d4800000-0000-0000-0000-000000000008', 'capo2-48@test.it', '{"role":"admin"}', now());
UPDATE public.profiles SET role = 'admin' WHERE id = 'd4800000-0000-0000-0000-000000000008';
CREATE TEMP TABLE kpi_prima AS
SELECT coalesce(sum(greatest(0, round(coalesce(total_price, 0) * 100) + greatest(0, coalesce(wallet_applied_cents, 0))
                         - coalesce(refunded_amount_cents, 0))), 0)::bigint AS atteso
  FROM public.orders WHERE delivery_status = 'DELIVERED';
GRANT ALL ON kpi_prima TO authenticated;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"d4800000-0000-0000-0000-000000000008","role":"authenticated"}';
INSERT INTO esiti
SELECT 'i ricavi dell admin tolgono i rimborsi e contano il credito usato (654)',
       (public.admin_kpi()->>'incassato_cents')::bigint = (SELECT atteso FROM kpi_prima),
       (public.admin_kpi()->>'incassato_cents') || ' contro ' || (SELECT atteso FROM kpi_prima);
RESET ROLE;
RESET request.jwt.claims;
INSERT INTO esiti
SELECT 'i due ordini della prova pesano 35 € e 0 € (654)',
       (SELECT atteso FROM kpi_prima) >= 3500
       AND NOT EXISTS (SELECT 1 FROM public.orders WHERE id = 'd4800000-0000-0000-0000-0000000000d1'
                        AND round(total_price * 100) + wallet_applied_cents - refunded_amount_cents > 0), '';

-- ── ⑨ Il giro notturno (756) ───────────────────────────────────────────────────
UPDATE public.profiles SET deletion_requested_at = now() - interval '10 days'
 WHERE id IN ('d4800000-0000-0000-0000-000000000001', 'd4800000-0000-0000-0000-000000000005');
INSERT INTO esiti
SELECT 'il giro notturno non cancella un negozio con ordini aperti (756)',
       NOT EXISTS (SELECT 1 FROM public.process_expired_deletions() d WHERE d.user_id = 'd4800000-0000-0000-0000-000000000001'), '';
INSERT INTO esiti
SELECT 'il giro notturno cancella chi non ha conti aperti (756)',
       EXISTS (SELECT 1 FROM public.process_expired_deletions() d WHERE d.user_id = 'd4800000-0000-0000-0000-000000000005'), '';

-- ── ⑭ Il premio invito (2573, 2574) ────────────────────────────────────────────
INSERT INTO auth.users (id, email, raw_user_meta_data, email_confirmed_at) VALUES
  ('d4800000-0000-0000-0000-000000000009', 'vecchio-48@test.it', '{"role":"buyer"}', now()),
  ('d4800000-0000-0000-0000-00000000000a', 'amico-48@test.it',   '{"role":"buyer"}', now());
INSERT INTO public.orders (id, user_id, seller_id, total_price, gross_total_cents, payment_method, payment_status,
  delivery_status, pickup_in_store, delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip, delivered_at)
VALUES
  ('d4800000-0000-0000-0000-000000000101', 'd4800000-0000-0000-0000-000000000009', 'd4800000-0000-0000-0000-000000000001',
   10, 1000, 'card', 'PAID', 'DELIVERED', false, 'V', '3', 'Via', 'Piacenza', '29121', now() - interval '20 days'),
  ('d4800000-0000-0000-0000-000000000102', 'd4800000-0000-0000-0000-000000000009', 'd4800000-0000-0000-0000-000000000001',
   10, 1000, 'card', 'PAID', 'OUT_FOR_DELIVERY', false, 'V', '3', 'Via', 'Piacenza', '29121', NULL);
INSERT INTO public.referrals (referrer_id, referred_id, rewarded, reward_amount)
VALUES ('d4800000-0000-0000-0000-00000000000a', 'd4800000-0000-0000-0000-000000000009', false, 5);
UPDATE public.orders SET delivery_status = 'DELIVERED', delivered_at = now() WHERE id = 'd4800000-0000-0000-0000-000000000102';
INSERT INTO esiti
SELECT 'un cliente che aveva già ordinato non fa pagare il premio invito (2573)',
       bool_and(NOT rewarded), string_agg(rewarded::text, ',')
  FROM public.referrals WHERE referred_id = 'd4800000-0000-0000-0000-000000000009';
INSERT INTO esiti
SELECT 'un guasto nel premio invito lascia traccia (2574)',
       pg_get_functiondef('public.reward_referrer_on_delivery'::regproc) ~ 'RAISE WARNING'
       AND pg_get_functiondef('public.reward_referrer_on_delivery'::regproc) !~ 'WHEN OTHERS THEN\s+NULL', '';

-- ── ㉕ La coda delle email lascia traccia (758) ─────────────────────────────────
INSERT INTO esiti
SELECT 'la coda delle email «pronto/consegnato» non ingoia i guasti in silenzio (758)',
       pg_get_functiondef('public.enqueue_order_status_email'::regproc) !~ 'WHEN OTHERS THEN\s+NULL'
       AND pg_get_functiondef('public.notify_buyer_on_order_status'::regproc) !~ 'WHEN OTHERS THEN\s+NULL', '';

-- ── ⑫ ㉘ I lucchetti (203, 201) ─────────────────────────────────────────────────
-- La corsa fra due transazioni non si riproduce in una prova sola: si controlla
-- che il lucchetto ci sia, nel punto giusto.
INSERT INTO esiti
SELECT 'la somma delle taglie si legge dopo il lucchetto sul prodotto (203)',
       position('FOR UPDATE' IN d) > 0 AND position('FOR UPDATE' IN d) < position('sum(stock)' IN d), ''
  FROM pg_get_functiondef('public.sync_product_variant_rollup'::regproc) d;
INSERT INTO esiti
SELECT 'la consegna blocca la riga dell ordine e non scrive sopra un annullo (201)',
       d ~ 'FROM public\.orders WHERE id = p_order_id\s+FOR UPDATE'
       AND d ~ 'AND delivery_status IN \(''PICKED_UP'', ''OUT_FOR_DELIVERY''\)', ''
  FROM pg_get_functiondef('public.verify_delivery_code'::regproc) d;

-- ── ⑦ Carrelli in ordine (2412) ─────────────────────────────────────────────────
INSERT INTO esiti
SELECT 'i carrelli da recuperare escono dal più vecchio (2412)',
       pg_get_functiondef('public.list_abandoned_carts_to_recover'::regproc) ~* 'ORDER BY ac\.last_activity', '';

-- ── ⑱ Il riassunto delle visite (258) ───────────────────────────────────────────
INSERT INTO public.product_views_daily (product_id, giorno, visite)
VALUES ('d4800000-0000-0000-0000-0000000000f1', DATE '2026-08-08', 4);
INSERT INTO public.product_views (product_id, viewed_at)
VALUES ('d4800000-0000-0000-0000-0000000000f1', TIMESTAMPTZ '2026-08-08 10:00:00+02'),
       ('d4800000-0000-0000-0000-0000000000f1', TIMESTAMPTZ '2026-08-08 23:30:00+02');
SELECT * FROM public.consolida_visite_prodotto(1);
INSERT INTO esiti
SELECT 'il riassunto notturno somma al conto già scritto e conta il giorno di Piacenza (258)',
       visite = 6, visite || ' visite l 8/8'
  FROM public.product_views_daily WHERE product_id = 'd4800000-0000-0000-0000-0000000000f1' AND giorno = DATE '2026-08-08';

-- ── ㉙ La serie dei giorni (260) ─────────────────────────────────────────────────
INSERT INTO esiti
SELECT 'la serie dei giorni conta il giorno di Piacenza (260)',
       pg_get_functiondef('public.touch_loyalty_streak'::regproc) ~ 'Europe/Rome'
       AND pg_get_functiondef('public.touch_loyalty_streak'::regproc) !~ 'CURRENT_DATE', '';

-- ── ⑬ Paletti sui soldi (696) ───────────────────────────────────────────────────
DO $$
DECLARE passato boolean;
BEGIN
  BEGIN
    UPDATE public.orders SET wallet_applied_cents = -500 WHERE id = 'd4800000-0000-0000-0000-0000000000c1';
    passato := true;
  EXCEPTION WHEN check_violation THEN passato := false;
  END;
  INSERT INTO esiti VALUES ('un credito applicato negativo non si scrive (696)', NOT passato, '');
  BEGIN
    UPDATE public.orders SET delivery_fee_cents = -100 WHERE id = 'd4800000-0000-0000-0000-0000000000c1';
    passato := true;
  EXCEPTION WHEN check_violation THEN passato := false;
  END;
  INSERT INTO esiti VALUES ('un costo di consegna negativo non si scrive (696)', NOT passato, '');
END $$;

-- ── ㉖ Il magazzino dei documenti (1622) ─────────────────────────────────────────
INSERT INTO esiti
SELECT 'il magazzino dei documenti d identità ha un tetto di peso e di tipi (1622)',
       file_size_limit IS NOT NULL AND allowed_mime_types IS NOT NULL
       AND NOT ('image/svg+xml' = ANY (allowed_mime_types)) AND NOT ('text/html' = ANY (allowed_mime_types)),
       coalesce(file_size_limit::text, 'nessun tetto')
  FROM storage.buckets WHERE id = 'kyc-docs';

-- ── ㉜ I documenti non tolti tornano in coda (2518) ─────────────────────────────
DELETE FROM public.kyc_file_da_togliere;
SELECT public.kyc_file_da_togliere_rimetti('d4800000-0000-0000-0000-000000000003', ARRAY['x/kyc_selfie-1.jpg']);
INSERT INTO esiti
SELECT 'i percorsi rimessi tornano nella coda che la notte dopo riprende (2518)',
       count(*) = 1, count(*) || ' righe'
  FROM public.kyc_file_da_togliere_prendi() WHERE percorsi = ARRAY['x/kyc_selfie-1.jpg'];
INSERT INTO esiti
SELECT 'la coda dei documenti la rimette solo il server (2518)',
       NOT has_function_privilege('authenticated', 'public.kyc_file_da_togliere_rimetti(uuid, text[])', 'EXECUTE')
       AND NOT has_function_privilege('anon', 'public.kyc_file_da_togliere_rimetti(uuid, text[])', 'EXECUTE'), '';

-- ── Verdetto ──────────────────────────────────────────────────────────────────
DO $$
DECLARE r record; rossi int;
BEGIN
  FOR r IN SELECT * FROM esiti ORDER BY nome LOOP
    RAISE INFO '%  %  — %', CASE WHEN r.ok THEN 'ok  ' ELSE 'ROTTO' END, r.nome, r.dettaglio;
  END LOOP;
  SELECT count(*) INTO rossi FROM esiti WHERE ok IS NOT TRUE;
  IF rossi > 0 THEN
    RAISE EXCEPTION '% controlli rossi in questo file', rossi;
  END IF;
END $$;

ROLLBACK;

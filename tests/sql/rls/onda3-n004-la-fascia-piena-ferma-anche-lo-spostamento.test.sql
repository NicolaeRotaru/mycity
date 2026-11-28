-- =============================================================================
-- N-004 (onda 3) — La fascia piena ferma anche l'ordine che ci entra con uno spostamento
-- =============================================================================
-- Gira contro un database ricostruito dalle migrazioni vere:
--   tests/sql/harness/apply.sh mycity_test
--   psql -d mycity_test -f tests/sql/rls/onda3-n004-la-fascia-piena-ferma-anche-lo-spostamento.test.sql
--
-- Il tetto di 5 giri per fascia (999s) scattava solo quando l'ordine NASCE. Il freno della
-- veloce (lib/ordini/veloce-non-confermata.ts) sposta con un UPDATE l'ordine «Adesso» che il negozio
-- non ha confermato in 10 minuti nella prima fascia possibile: in una fascia piena entrava il sesto
-- giro e nessuno lo fermava. Adesso il grilletto scatta anche BEFORE UPDATE OF delivery_slot:
--   ① cinque porte in contanti nella fascia «Domani · 9:00–11:00»: piena;
--   ② la veloce di Fabio, in contanti, spostata nella fascia piena: si ferma (23514 `fascia_piena`)
--      e resta «Adesso»;
--   ③ spostata nella fascia accanto (11:00–13:00, non si sovrappone): passa;
--   ④ il secondo negozio del carrello di Anna, stessa porta, spostato nella fascia piena: passa;
--   ⑤ la veloce di Gina pagata con la carta, spostata nella fascia piena: passa (come la sua nascita);
--   ⑥ un ordine già nella fascia (ora sovraffollata dalla carta) a cui si riscrive la STESSA fascia,
--      o si cambiano altre colonne: passa, la fascia non cambia;
--   ⑦ chi si sposta non conta se stesso: la sua riga di prima (stessa porta) non lo fa passare
--      verso una fascia di prima («Domani · 9:00–12:00») che tocca quella piena: si ferma.
-- Senza la riparazione ② e ⑦ dicono «spostato» e la prova è ROSSA.
-- Tutto in transazione, ROLLBACK. (Le due sessioni insieme: onda3-n004-due-spostamenti-insieme…)
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';
SET LOCAL mycity.allow_order_write   = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated;

INSERT INTO auth.users (id, email, raw_user_meta_data, email_confirmed_at) VALUES
  ('a0040000-0000-0000-0000-000000000001', 'forno-n004@test.it',  '{"role":"seller"}', now()),
  ('a0040000-0000-0000-0000-000000000002', 'fiori-n004@test.it',  '{"role":"seller"}', now()),
  ('a0040000-0000-0000-0000-000000000021', 'anna-n004@test.it',   '{"role":"buyer"}',  now()),
  ('a0040000-0000-0000-0000-000000000022', 'bruno-n004@test.it',  '{"role":"buyer"}',  now()),
  ('a0040000-0000-0000-0000-000000000023', 'carla-n004@test.it',  '{"role":"buyer"}',  now()),
  ('a0040000-0000-0000-0000-000000000024', 'dario-n004@test.it',  '{"role":"buyer"}',  now()),
  ('a0040000-0000-0000-0000-000000000025', 'elena-n004@test.it',  '{"role":"buyer"}',  now()),
  ('a0040000-0000-0000-0000-000000000026', 'fabio-n004@test.it',  '{"role":"buyer"}',  now()),
  ('a0040000-0000-0000-0000-000000000027', 'gina-n004@test.it',   '{"role":"buyer"}',  now()),
  ('a0040000-0000-0000-0000-000000000028', 'ugo-n004@test.it',    '{"role":"buyer"}',  now());

UPDATE public.profiles
   SET is_approved = true, approval_status = 'approved', store_name = 'Negozio N004', store_address = 'Via Roma 1, Piacenza'
 WHERE id IN ('a0040000-0000-0000-0000-000000000001', 'a0040000-0000-0000-0000-000000000002');

-- Un ordine come lo scrive la rotta, nato con la fascia data (NULL = la veloce, scritta dopo).
CREATE FUNCTION pg_temp.nuovo_ordine(p_id uuid, p_cliente uuid, p_negozio uuid, p_fascia text, p_pagamento text,
  p_indirizzo text DEFAULT 'Via Verdi 1')
RETURNS void
LANGUAGE sql AS $$
  INSERT INTO public.orders (id, user_id, seller_id, total_price, gross_total_cents, payment_method, payment_status,
    delivery_status, pickup_in_store, delivery_slot, delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip)
  VALUES (p_id, p_cliente, p_negozio, 10, 1000, p_pagamento,
    CASE WHEN p_pagamento = 'card' THEN 'PAID' ELSE 'PENDING' END,
    'NEW', false, p_fascia, 'Cliente N004', '3', p_indirizzo, 'Piacenza', '29121');
$$;

-- Lo spostamento come lo scrive il freno: condizionato sulla fascia di prima. Risponde se si è
-- spostato, o il codice e il segno del rifiuto.
CREATE FUNCTION pg_temp.sposta(p_id uuid, p_da text, p_a text)
RETURNS text
LANGUAGE plpgsql AS $$
DECLARE stato text; segno text; righe int;
BEGIN
  UPDATE public.orders SET delivery_slot = p_a WHERE id = p_id AND delivery_slot IS NOT DISTINCT FROM p_da;
  GET DIAGNOSTICS righe = ROW_COUNT;
  RETURN CASE WHEN righe = 1 THEN 'spostato' ELSE 'nessuna riga' END;
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS stato = RETURNED_SQLSTATE, segno = PG_EXCEPTION_HINT;
  RETURN 'fermo ' || stato || ' ' || coalesce(segno, '');
END;
$$;

CREATE TEMP TABLE prove (passo text, esito text) ON COMMIT DROP;

-- ① Cinque porte in contanti nella stessa fascia: la fascia è piena.
SELECT pg_temp.nuovo_ordine('a0040000-0000-0000-0000-0000000000a1', 'a0040000-0000-0000-0000-000000000021',
  'a0040000-0000-0000-0000-000000000001', 'Domani · 9:00–11:00', 'cod');
SELECT pg_temp.nuovo_ordine('a0040000-0000-0000-0000-0000000000b1', 'a0040000-0000-0000-0000-000000000022',
  'a0040000-0000-0000-0000-000000000001', 'Domani · 9:00–11:00', 'cod', 'Via Bianchi 2');
SELECT pg_temp.nuovo_ordine('a0040000-0000-0000-0000-0000000000c1', 'a0040000-0000-0000-0000-000000000023',
  'a0040000-0000-0000-0000-000000000001', 'Domani · 9:00–11:00', 'cod', 'Via Neri 3');
SELECT pg_temp.nuovo_ordine('a0040000-0000-0000-0000-0000000000d1', 'a0040000-0000-0000-0000-000000000024',
  'a0040000-0000-0000-0000-000000000001', 'Domani · 9:00–11:00', 'cod', 'Via Gialli 4');
SELECT pg_temp.nuovo_ordine('a0040000-0000-0000-0000-0000000000e1', 'a0040000-0000-0000-0000-000000000025',
  'a0040000-0000-0000-0000-000000000001', 'Domani · 9:00–11:00', 'cod', 'Via Rosa 5');

-- Le veloci: nascono senza fascia e diventano «Adesso» (la regola del fattorino libero, migrazione
-- 840, guarda solo la nascita: qui non serve un fattorino acceso).
SELECT pg_temp.nuovo_ordine('a0040000-0000-0000-0000-0000000000f1', 'a0040000-0000-0000-0000-000000000026',
  'a0040000-0000-0000-0000-000000000001', NULL, 'cod', 'Via Blu 6');
SELECT pg_temp.nuovo_ordine('a0040000-0000-0000-0000-0000000000a2', 'a0040000-0000-0000-0000-000000000021',
  'a0040000-0000-0000-0000-000000000002', NULL, 'cod', '  via  verdi 1 ');
SELECT pg_temp.nuovo_ordine('a0040000-0000-0000-0000-00000000009a', 'a0040000-0000-0000-0000-000000000027',
  'a0040000-0000-0000-0000-000000000001', NULL, 'card', 'Via Viola 7');
INSERT INTO prove SELECT 'veloci', string_agg(pg_temp.sposta(id, NULL, 'Adesso · arrivo in 30-60 min'), ', ')
  FROM (VALUES ('a0040000-0000-0000-0000-0000000000f1'::uuid), ('a0040000-0000-0000-0000-0000000000a2'::uuid),
               ('a0040000-0000-0000-0000-00000000009a'::uuid)) AS v(id);

-- ② Il freno sposta la veloce di Fabio nella fascia piena.
INSERT INTO prove SELECT '2', pg_temp.sposta('a0040000-0000-0000-0000-0000000000f1',
  'Adesso · arrivo in 30-60 min', 'Domani · 9:00–11:00');
-- ③ Nella fascia accanto c'è posto.
INSERT INTO prove SELECT '3', pg_temp.sposta('a0040000-0000-0000-0000-0000000000f1',
  'Adesso · arrivo in 30-60 min', 'Domani · 11:00–13:00');
-- ④ Il secondo negozio del carrello di Anna: la sua porta è già nella fascia.
INSERT INTO prove SELECT '4', pg_temp.sposta('a0040000-0000-0000-0000-0000000000a2',
  'Adesso · arrivo in 30-60 min', 'Domani · 9:00–11:00');
-- ⑤ La veloce di Gina, pagata con la carta.
INSERT INTO prove SELECT '5', pg_temp.sposta('a0040000-0000-0000-0000-00000000009a',
  'Adesso · arrivo in 30-60 min', 'Domani · 9:00–11:00');
-- ⑥ La fascia ha adesso sei porte (la carta non si ferma). A Bruno si riscrive la stessa fascia, e
-- gli si cambia un'altra colonna: niente giro nuovo, niente rifiuto.
INSERT INTO prove SELECT '6a', pg_temp.sposta('a0040000-0000-0000-0000-0000000000b1',
  'Domani · 9:00–11:00', 'Domani · 9:00–11:00');
DO $$
DECLARE esito text := 'aggiornato';
BEGIN
  BEGIN
    UPDATE public.orders SET delivery_phone = '4', delivery_slot = delivery_slot
     WHERE id = 'a0040000-0000-0000-0000-0000000000c1';
  EXCEPTION WHEN OTHERS THEN esito := 'fermo ' || SQLSTATE;
  END;
  INSERT INTO prove VALUES ('6b', esito);
END $$;
-- ⑦ Ugo nasce in contanti nella 11:00–13:00 (c'è posto), poi il suo ordine passa all'etichetta di
-- prima «Domani · 9:00–12:00», che tocca anche la 9:00–11:00 piena. La sua riga di prima è la sua
-- stessa porta: se contasse, lo farebbe passare come «già nella fascia».
SELECT pg_temp.nuovo_ordine('a0040000-0000-0000-0000-00000000008a', 'a0040000-0000-0000-0000-000000000028',
  'a0040000-0000-0000-0000-000000000001', 'Domani · 11:00–13:00', 'cod', 'Via Grigi 8');
INSERT INTO prove SELECT '7', pg_temp.sposta('a0040000-0000-0000-0000-00000000008a',
  'Domani · 11:00–13:00', 'Domani · 9:00–12:00');

INSERT INTO esiti SELECT 'le veloci diventano «Adesso»', esito = 'spostato, spostato, spostato', esito
  FROM prove WHERE passo = 'veloci';
INSERT INTO esiti SELECT '② la veloce in contanti spostata nella fascia piena si ferma, col segno per l app',
  esito = 'fermo 23514 fascia_piena', esito FROM prove WHERE passo = '2';
INSERT INTO esiti SELECT '② e dopo il rifiuto non era entrata nella fascia piena',
  delivery_slot IS DISTINCT FROM 'Domani · 9:00–11:00', coalesce(delivery_slot, '(vuota)')
  FROM public.orders WHERE id = 'a0040000-0000-0000-0000-0000000000f1';
INSERT INTO esiti SELECT '③ nella fascia accanto c è posto', esito = 'spostato', esito FROM prove WHERE passo = '3';
INSERT INTO esiti SELECT '④ la stessa porta del carrello passa', esito = 'spostato', esito FROM prove WHERE passo = '4';
INSERT INTO esiti SELECT '⑤ lo spostamento con la carta non si ferma, come la nascita', esito = 'spostato', esito
  FROM prove WHERE passo = '5';
INSERT INTO esiti SELECT '⑥ la stessa fascia riscritta non chiede un giro', esito = 'spostato', esito FROM prove WHERE passo = '6a';
INSERT INTO esiti SELECT '⑥ altre colonne di un ordine già nella fascia: passa', esito = 'aggiornato', esito
  FROM prove WHERE passo = '6b';
INSERT INTO esiti SELECT '⑦ chi si sposta non conta se stesso: verso una fascia che tocca la piena si ferma',
  esito = 'fermo 23514 fascia_piena', esito FROM prove WHERE passo = '7';
INSERT INTO esiti SELECT 'il grilletto scatta anche sullo spostamento',
  EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgname = 'orders_fascia_piena_ferma_i_contanti'
           AND t.tgrelid = 'public.orders'::regclass AND (t.tgtype & 16) <> 0),
  'BEFORE UPDATE OF delivery_slot';
INSERT INTO esiti SELECT 'otto passi provati', count(*) = 8, count(*) || ' passi' FROM prove;

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

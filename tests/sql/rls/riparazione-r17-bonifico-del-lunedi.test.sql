-- =============================================================================
-- R17-002 — Il bonifico del lunedì si segna, tutto o niente, per l'importo versato (migrazione 410)
-- =============================================================================
-- Gira contro un database ricostruito dalle migrazioni vere:
--   tests/sql/harness/apply.sh mycity_test
--   psql -X -v ON_ERROR_STOP=1 -d mycity_test -f tests/sql/rls/riparazione-r17-bonifico-del-lunedi.test.sql
--
-- Pane Quotidiano ha ordini in contanti con la rimessa confermata (HELD). Nicola,
-- amministratore, il lunedì fa il bonifico e lo segna. Si controlla che:
--   ① il negozio, un cliente e un anonimo non possano segnarlo;
--   ② con un reso aperto nel frattempo su uno degli ordini non si segni niente
--      (il caso del collaudo K04: letti 36 €, versati 36 €, segnabili 18 €);
--   ③ con un importo diverso dalla somma dei netti non si segni niente, anche
--      se gli ordini sono tutti segnabili (uno storno arrivato nel frattempo);
--   ④ contestazione in banca, reclamo sull'ordine, reclamo aperto in tabella,
--      rimborso pieno, carta, altro negozio, contanti non rimessi: mai segnati;
--   ⑤ con l'importo giusto i contanti diventano PAID_MANUALLY, con data,
--      riferimento e una riga nel registro;
--   ⑥ richiamata una seconda volta non segna una seconda volta.
-- Tutto in transazione con ROLLBACK: non lascia dati.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';
SET LOCAL mycity.allow_order_write   = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('e1700000-0000-0000-0000-000000000001', 'forno-r17@test.it',   '{"role":"seller"}'),
  ('e1700000-0000-0000-0000-000000000002', 'altro-r17@test.it',   '{"role":"seller"}'),
  ('e1700000-0000-0000-0000-000000000003', 'cliente-r17@test.it', '{"role":"buyer"}'),
  ('e1700000-0000-0000-0000-000000000004', 'nicola-r17@test.it',  '{"role":"admin"}');
UPDATE public.profiles SET is_approved = true, approval_status = 'approved'
 WHERE id IN ('e1700000-0000-0000-0000-000000000001', 'e1700000-0000-0000-0000-000000000002',
              'e1700000-0000-0000-0000-000000000003');
UPDATE public.profiles SET store_name = 'Pane Quotidiano' WHERE id = 'e1700000-0000-0000-0000-000000000001';
UPDATE public.profiles SET role = 'admin' WHERE id = 'e1700000-0000-0000-0000-000000000004';

-- Gli ordini: 20 € in contanti, 18 € netti al negozio, consegnati e rimessi (HELD), salvo dove detto.
INSERT INTO public.orders (
  id, user_id, seller_id, total_price, gross_total_cents, payment_method, payment_status,
  delivery_status, delivered_at, pickup_in_store, payout_status, seller_payout_cents,
  dispute_status, internal_dispute_status,
  delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip
)
SELECT v.id::uuid, 'e1700000-0000-0000-0000-000000000003', v.negozio::uuid, 20, 2000, v.metodo, v.pagamento,
       'DELIVERED', now() - interval '3 days', false, v.bonifico, 1800,
       v.banca, v.reclamo,
       'Maria', '333', 'Via A 1', 'Piacenza', '29121'
  FROM (VALUES
    -- puliti: sono il bonifico di lunedì
    ('e1700000-0000-0000-0000-0000000000a1', 'e1700000-0000-0000-0000-000000000001', 'cod',  'PAID',     'HELD',                NULL,   NULL),
    ('e1700000-0000-0000-0000-0000000000a2', 'e1700000-0000-0000-0000-000000000001', 'cod',  'PAID',     'HELD',                NULL,   NULL),
    -- pulito all'inizio: il reso si apre mentre Nicola è in banca
    ('e1700000-0000-0000-0000-0000000000a3', 'e1700000-0000-0000-0000-000000000001', 'cod',  'PAID',     'HELD',                NULL,   NULL),
    -- reclamo sull'ordine, contestazione in banca, rimborso pieno, reclamo aperto in tabella
    ('e1700000-0000-0000-0000-0000000000a4', 'e1700000-0000-0000-0000-000000000001', 'cod',  'PAID',     'HELD',                NULL,   'OPEN'),
    ('e1700000-0000-0000-0000-0000000000a5', 'e1700000-0000-0000-0000-000000000001', 'cod',  'PAID',     'HELD',                'needs_response', NULL),
    ('e1700000-0000-0000-0000-0000000000a6', 'e1700000-0000-0000-0000-000000000001', 'cod',  'REFUNDED', 'HELD',                NULL,   NULL),
    ('e1700000-0000-0000-0000-0000000000a7', 'e1700000-0000-0000-0000-000000000001', 'cod',  'PAID',     'HELD',                NULL,   NULL),
    -- contanti ancora dal fattorino, una carta, un altro negozio
    ('e1700000-0000-0000-0000-0000000000a8', 'e1700000-0000-0000-0000-000000000001', 'cod',  'PENDING',  'AWAITING_REMITTANCE', NULL,   NULL),
    ('e1700000-0000-0000-0000-0000000000c1', 'e1700000-0000-0000-0000-000000000001', 'card', 'PAID',     'HELD',                NULL,   NULL),
    ('e1700000-0000-0000-0000-0000000000b1', 'e1700000-0000-0000-0000-000000000002', 'cod',  'PAID',     'HELD',                NULL,   NULL)
  ) AS v(id, negozio, metodo, pagamento, bonifico, banca, reclamo);

INSERT INTO public.disputes (order_id, opener_id, against_id, reason, description, status) VALUES
  ('e1700000-0000-0000-0000-0000000000a7', 'e1700000-0000-0000-0000-000000000003',
   'e1700000-0000-0000-0000-000000000001', 'other', 'pane raffermo', 'open');

SET LOCAL mycity.allow_order_write = '';

-- Una chiamata, come la fa chi è nei claims: l'esito, o il codice dell'errore.
CREATE FUNCTION pg_temp.segna(p_chi text, p_ruolo text, p_ordini text[], p_cents int, p_rif text) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE r jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims',
    CASE WHEN p_chi IS NULL THEN '{"role":"anon"}' ELSE json_build_object('sub', p_chi, 'role', 'authenticated')::text END, true);
  EXECUTE format('SET LOCAL ROLE %I', p_ruolo);
  BEGIN
    r := public.segna_bonifico_manuale('e1700000-0000-0000-0000-000000000001', p_ordini::uuid[], p_cents, p_rif);
  EXCEPTION WHEN insufficient_privilege THEN
    r := jsonb_build_object('errore', SQLSTATE);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  RETURN r;
END $$;

CREATE FUNCTION pg_temp.stato(p_id text) RETURNS text
LANGUAGE sql AS $$
  SELECT coalesce(payout_status, '∅') || '·' || coalesce(payout_manual_ref, '∅') FROM public.orders WHERE id = p_id::uuid
$$;

-- ① Nessuno fuori dagli amministratori.
INSERT INTO esiti
SELECT 'il negozio non segna da solo il suo bonifico', r ->> 'errore' = '42501' AND pg_temp.stato('e1700000-0000-0000-0000-0000000000a1') = 'HELD·∅', r::text
  FROM (SELECT pg_temp.segna('e1700000-0000-0000-0000-000000000001', 'authenticated',
          ARRAY['e1700000-0000-0000-0000-0000000000a1'], 1800, 'TRN-410') AS r) t;
INSERT INTO esiti
SELECT 'un cliente non lo segna', r ->> 'errore' = '42501' AND pg_temp.stato('e1700000-0000-0000-0000-0000000000a1') = 'HELD·∅', r::text
  FROM (SELECT pg_temp.segna('e1700000-0000-0000-0000-000000000003', 'authenticated',
          ARRAY['e1700000-0000-0000-0000-0000000000a1'], 1800, 'TRN-410') AS r) t;
INSERT INTO esiti
SELECT 'un anonimo non lo segna', r ->> 'errore' = '42501' AND pg_temp.stato('e1700000-0000-0000-0000-0000000000a1') = 'HELD·∅', r::text
  FROM (SELECT pg_temp.segna(NULL, 'anon',
          ARRAY['e1700000-0000-0000-0000-0000000000a1'], 1800, 'TRN-410') AS r) t;
INSERT INTO esiti
SELECT 'un anonimo non ha nemmeno il permesso di chiamarla; chi ha un accesso sì (il controllo vero è dentro)',
       NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND has_function_privilege('authenticated', p.oid, 'EXECUTE'),
       p.oid::regprocedure::text
  FROM pg_proc p
 WHERE p.oid = (SELECT max(oid) FROM pg_proc WHERE proname = 'segna_bonifico_manuale' AND pronamespace = 'public'::regnamespace);

-- ② Collaudo K04: Nicola legge 36 € (a1 + a3), versa 36 €, e intanto su a3 si apre un reso.
INSERT INTO public.returns (order_id, buyer_id, seller_id, reason, status) VALUES
  ('e1700000-0000-0000-0000-0000000000a3', 'e1700000-0000-0000-0000-000000000003',
   'e1700000-0000-0000-0000-000000000001', 'DAMAGED', 'REQUESTED');
INSERT INTO esiti
SELECT 'reso aperto nel frattempo su uno dei due: non segna niente e dice quale',
       r ->> 'ok' = 'false' AND r ->> 'reason' = 'ORDINI_CAMBIATI'
       AND r -> 'non_segnabili' = '["e1700000-0000-0000-0000-0000000000a3"]'::jsonb
       AND pg_temp.stato('e1700000-0000-0000-0000-0000000000a1') = 'HELD·∅'
       AND pg_temp.stato('e1700000-0000-0000-0000-0000000000a3') = 'HELD·∅',
       r::text
  FROM (SELECT pg_temp.segna('e1700000-0000-0000-0000-000000000004', 'authenticated',
          ARRAY['e1700000-0000-0000-0000-0000000000a1', 'e1700000-0000-0000-0000-0000000000a3'], 3600, 'TRN-410') AS r) t;
-- Il pannello aggiornato chiede solo a1, ma Nicola ha versato 36 €.
INSERT INTO esiti
SELECT 'versati 36 € per un ordine da 18 €: non segna niente e dice la cifra giusta',
       r ->> 'ok' = 'false' AND r ->> 'reason' = 'IMPORTO_DIVERSO' AND (r ->> 'atteso_cents')::int = 1800
       AND pg_temp.stato('e1700000-0000-0000-0000-0000000000a1') = 'HELD·∅',
       r::text
  FROM (SELECT pg_temp.segna('e1700000-0000-0000-0000-000000000004', 'authenticated',
          ARRAY['e1700000-0000-0000-0000-0000000000a1'], 3600, 'TRN-410') AS r) t;

-- ③ Uno storno di 5 € arriva su a2 mentre Nicola versa i 36 € letti prima: la somma è 31 €.
SET LOCAL mycity.allow_order_write = '1';
UPDATE public.orders SET seller_payout_reversed_cents = 500 WHERE id = 'e1700000-0000-0000-0000-0000000000a2';
SET LOCAL mycity.allow_order_write = '';
INSERT INTO esiti
SELECT 'importo diverso dai netti meno gli storni: non segna niente',
       r ->> 'ok' = 'false' AND r ->> 'reason' = 'IMPORTO_DIVERSO' AND (r ->> 'atteso_cents')::int = 3100
       AND pg_temp.stato('e1700000-0000-0000-0000-0000000000a1') = 'HELD·∅'
       AND pg_temp.stato('e1700000-0000-0000-0000-0000000000a2') = 'HELD·∅',
       r::text
  FROM (SELECT pg_temp.segna('e1700000-0000-0000-0000-000000000004', 'authenticated',
          ARRAY['e1700000-0000-0000-0000-0000000000a1', 'e1700000-0000-0000-0000-0000000000a2'], 3600, 'TRN-410') AS r) t;
SET LOCAL mycity.allow_order_write = '1';
UPDATE public.orders SET seller_payout_reversed_cents = 0 WHERE id = 'e1700000-0000-0000-0000-0000000000a2';
SET LOCAL mycity.allow_order_write = '';

-- ④ Mai segnati, uno per uno, anche con la cifra giusta di 18 €.
INSERT INTO esiti
SELECT 'mai segnato: ' || v.perche,
       r ->> 'ok' = 'false' AND r ->> 'reason' = 'ORDINI_CAMBIATI' AND pg_temp.stato(v.id) = v.prima,
       r::text || ' · ' || pg_temp.stato(v.id)
  FROM (VALUES
    ('e1700000-0000-0000-0000-0000000000a4', 'reclamo sull ordine',            'HELD·∅'),
    ('e1700000-0000-0000-0000-0000000000a5', 'contestazione in banca',          'HELD·∅'),
    ('e1700000-0000-0000-0000-0000000000a6', 'rimborso pieno',                  'HELD·∅'),
    ('e1700000-0000-0000-0000-0000000000a7', 'reclamo aperto in tabella',       'HELD·∅'),
    ('e1700000-0000-0000-0000-0000000000a8', 'contanti ancora dal fattorino',   'AWAITING_REMITTANCE·∅'),
    ('e1700000-0000-0000-0000-0000000000c1', 'pagato con la carta',             'HELD·∅'),
    ('e1700000-0000-0000-0000-0000000000b1', 'ordine di un altro negozio',      'HELD·∅')
  ) AS v(id, perche, prima),
  LATERAL (SELECT pg_temp.segna('e1700000-0000-0000-0000-000000000004', 'authenticated', ARRAY[v.id], 1800, 'TRN-410') AS r) t;

-- ⑤ L'importo giusto: 36 € per a1 + a2.
INSERT INTO esiti
SELECT 'con l importo giusto segna tutti e due gli ordini', r ->> 'ok' = 'true' AND (r ->> 'segnati')::int = 2, r::text
  FROM (SELECT pg_temp.segna('e1700000-0000-0000-0000-000000000004', 'authenticated',
          ARRAY['e1700000-0000-0000-0000-0000000000a1', 'e1700000-0000-0000-0000-0000000000a2'], 3600, '  TRN-410  ') AS r) t;
INSERT INTO esiti
SELECT 'i contanti versati diventano PAID_MANUALLY con data e riferimento',
       bool_and(payout_status = 'PAID_MANUALLY' AND payout_at IS NOT NULL AND payout_manual_ref = 'TRN-410'),
       string_agg(payout_status || ' · ' || coalesce(payout_manual_ref, '∅'), ', ')
  FROM public.orders WHERE id IN ('e1700000-0000-0000-0000-0000000000a1', 'e1700000-0000-0000-0000-0000000000a2');
INSERT INTO esiti
SELECT 'il bonifico segnato resta nel registro, col nome di chi l ha segnato e la cifra',
       count(*) = 1 AND bool_and(actor_id = 'e1700000-0000-0000-0000-000000000004' AND (metadata ->> 'importo_cents')::int = 3600),
       count(*) || ' righe'
  FROM public.audit_logs WHERE action = 'payout.manual_transfer_marked' AND target_id = 'e1700000-0000-0000-0000-000000000001';
INSERT INTO esiti
SELECT 'gli altri ordini restano come erano',
       bool_and(payout_status IS DISTINCT FROM 'PAID_MANUALLY'), string_agg(right(id::text, 2) || '=' || payout_status, ', ')
  FROM public.orders WHERE seller_id IN ('e1700000-0000-0000-0000-000000000001', 'e1700000-0000-0000-0000-000000000002')
   AND id NOT IN ('e1700000-0000-0000-0000-0000000000a1', 'e1700000-0000-0000-0000-0000000000a2');

-- ⑥ La seconda volta: con lo stesso riferimento non riscrive niente; con un altro non segna.
CREATE TEMP TABLE prima_volta ON COMMIT DROP AS
  SELECT id, payout_at FROM public.orders WHERE id IN ('e1700000-0000-0000-0000-0000000000a1', 'e1700000-0000-0000-0000-0000000000a2');
INSERT INTO esiti
SELECT 'richiamata con lo stesso riferimento non segna una seconda volta',
       r ->> 'ok' = 'true' AND (r ->> 'segnati')::int = 0 AND (r ->> 'gia_segnati')::int = 2,
       r::text
  FROM (SELECT pg_temp.segna('e1700000-0000-0000-0000-000000000004', 'authenticated',
          ARRAY['e1700000-0000-0000-0000-0000000000a1', 'e1700000-0000-0000-0000-0000000000a2'], 3600, 'TRN-410') AS r) t;
INSERT INTO esiti
SELECT 'richiamata con un altro riferimento non segna niente',
       r ->> 'ok' = 'false' AND r ->> 'reason' = 'ORDINI_CAMBIATI', r::text
  FROM (SELECT pg_temp.segna('e1700000-0000-0000-0000-000000000004', 'authenticated',
          ARRAY['e1700000-0000-0000-0000-0000000000a1', 'e1700000-0000-0000-0000-0000000000a2'], 3600, 'TRN-999') AS r) t;
INSERT INTO esiti
SELECT 'dopo le due richiamate data e riferimento sono quelli della prima, e il registro ha una riga sola',
       bool_and(o.payout_manual_ref = 'TRN-410' AND o.payout_at = p.payout_at)
       AND (SELECT count(*) FROM public.audit_logs WHERE action = 'payout.manual_transfer_marked'
             AND target_id = 'e1700000-0000-0000-0000-000000000001') = 1,
       string_agg(o.payout_manual_ref, ', ')
  FROM public.orders o JOIN prima_volta p USING (id);

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
  IF (SELECT count(*) FROM esiti) < 21 THEN
    RAISE EXCEPTION 'controlli mancanti: % su 21', (SELECT count(*) FROM esiti);
  END IF;
END $$;

ROLLBACK;

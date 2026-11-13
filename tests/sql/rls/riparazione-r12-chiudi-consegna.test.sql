-- =============================================================================
-- R12-001 — Se il fattorino sparisce, l'amministratore chiude la consegna in
-- contanti, con l'incasso dichiarato a voce, in un passo solo
-- =============================================================================
--   tests/sql/harness/apply.sh mycity_test && tests/sql/harness/run.sh mycity_test
--
-- Un ordine in contanti resta in strada: il fattorino non ha dichiarato i
-- contanti e non riapre piu' l'app. Dalla 163 nessuno poteva chiuderlo.
-- Senza la migrazione 360 la funzione non esiste e il file e' ROSSO.
-- Tutto in transazione, ROLLBACK.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';
SET LOCAL mycity.allow_order_write   = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('e1200000-0000-0000-0000-000000000001', 'fornaio-r12@test.it',   '{"role":"seller"}'),
  ('e1200000-0000-0000-0000-000000000002', 'fattorino-r12@test.it', '{"role":"rider"}'),
  ('e1200000-0000-0000-0000-000000000003', 'cliente-r12@test.it',   '{"role":"buyer"}'),
  ('e1200000-0000-0000-0000-000000000004', 'capo-r12@test.it',      '{"role":"admin"}');

UPDATE public.profiles
   SET is_approved = true, approval_status = 'approved', store_name = 'Pane R12',
       store_address = 'Via Roma 1, Piacenza'
 WHERE id = 'e1200000-0000-0000-0000-000000000001';
UPDATE public.profiles SET is_approved = true, approval_status = 'approved'
 WHERE id IN ('e1200000-0000-0000-0000-000000000002', 'e1200000-0000-0000-0000-000000000003');
UPDATE public.profiles SET role = 'admin' WHERE id = 'e1200000-0000-0000-0000-000000000004';

-- c1 contanti in strada senza incasso · c2 contanti accettato · c3 carta in strada
-- c4 contanti ritiro in negozio · c5 contanti ritirato (PICKED_UP) · c6 contanti in strada
-- con incasso gia' dichiarato dal fattorino
INSERT INTO public.orders (
  id, user_id, seller_id, rider_id, total_price, gross_total_cents, payment_method, payment_status,
  delivery_status, pickup_in_store, payout_status, seller_payout_cents, rider_fee_cents,
  delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip
)
SELECT v.id::uuid, 'e1200000-0000-0000-0000-000000000003', 'e1200000-0000-0000-0000-000000000001',
       'e1200000-0000-0000-0000-000000000002', 25.00, 2500, v.metodo, v.pagamento, v.stato, v.ritiro,
       'AWAITING_REMITTANCE', 2250, 300, 'Maria Rossi', '3331234567', 'Via Verdi 10', 'Piacenza', '29121'
  FROM (VALUES
    ('e1200000-0000-0000-0000-0000000000c1', 'cod',  'PENDING', 'OUT_FOR_DELIVERY', false),
    ('e1200000-0000-0000-0000-0000000000c2', 'cod',  'PENDING', 'ACCEPTED',         false),
    ('e1200000-0000-0000-0000-0000000000c3', 'card', 'PAID',    'OUT_FOR_DELIVERY', false),
    ('e1200000-0000-0000-0000-0000000000c4', 'cod',  'PENDING', 'OUT_FOR_DELIVERY', true),
    ('e1200000-0000-0000-0000-0000000000c5', 'cod',  'PENDING', 'PICKED_UP',        false),
    ('e1200000-0000-0000-0000-0000000000c6', 'cod',  'PENDING', 'OUT_FOR_DELIVERY', false),
    ('e1200000-0000-0000-0000-0000000000c7', 'cod',  'REFUNDED', 'OUT_FOR_DELIVERY', false),
    ('e1200000-0000-0000-0000-0000000000c8', 'cod',  'PENDING', 'OUT_FOR_DELIVERY', false)
  ) AS v(id, metodo, pagamento, stato, ritiro);

-- c8: una consegna da 2 euro con un compenso del fattorino di 3: il contante non basta.
UPDATE public.orders SET total_price = 2.00, gross_total_cents = 200, seller_payout_cents = 180 WHERE id = 'e1200000-0000-0000-0000-0000000000c8';

UPDATE public.orders SET cash_confirmed_at = now() - interval '1 hour', cash_collected_cents = 2200,
       cash_collected_by = 'e1200000-0000-0000-0000-000000000002', payment_status = 'PAID',
       rider_payout_status = 'CASH_WITHHELD'
 WHERE id = 'e1200000-0000-0000-0000-0000000000c6';

SET LOCAL mycity.allow_order_write = '';
CREATE TEMP TABLE r (caso text, risposta jsonb) ON COMMIT DROP;
GRANT ALL ON r TO authenticated;

-- ── chi non e' amministratore ─────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"e1200000-0000-0000-0000-000000000002","role":"authenticated"}';
INSERT INTO r SELECT 'fattorino', public.admin_chiudi_consegna('e1200000-0000-0000-0000-0000000000c1', 2200, 'Me la chiudo da solo senza codice');
SET LOCAL request.jwt.claims = '{"sub":"e1200000-0000-0000-0000-000000000001","role":"authenticated"}';
INSERT INTO r SELECT 'negozio', public.admin_chiudi_consegna('e1200000-0000-0000-0000-0000000000c1', 2200, 'Il fattorino non risponde piu');
SET LOCAL request.jwt.claims = '{"sub":"e1200000-0000-0000-0000-000000000003","role":"authenticated"}';
INSERT INTO r SELECT 'cliente', public.admin_chiudi_consegna('e1200000-0000-0000-0000-0000000000c1', 0, 'Me la chiudo da solo senza codice');

-- ── l'amministratore: i rifiuti ───────────────────────────────────────────
SET LOCAL request.jwt.claims = '{"sub":"e1200000-0000-0000-0000-000000000004","role":"authenticated"}';
INSERT INTO r SELECT 'senza motivo',      public.admin_chiudi_consegna('e1200000-0000-0000-0000-0000000000c1', 2200, '  ');
INSERT INTO r SELECT 'senza importo',     public.admin_chiudi_consegna('e1200000-0000-0000-0000-0000000000c1', NULL, 'Fattorino irraggiungibile da tre giorni');
INSERT INTO r SELECT 'fuori misura',      public.admin_chiudi_consegna('e1200000-0000-0000-0000-0000000000c1', 99900, 'Fattorino irraggiungibile da tre giorni');
INSERT INTO r SELECT 'non partito',       public.admin_chiudi_consegna('e1200000-0000-0000-0000-0000000000c2', 2200, 'Fattorino irraggiungibile da tre giorni');
INSERT INTO r SELECT 'carta',             public.admin_chiudi_consegna('e1200000-0000-0000-0000-0000000000c3', 0, 'Fattorino irraggiungibile da tre giorni');
INSERT INTO r SELECT 'ritiro in negozio', public.admin_chiudi_consegna('e1200000-0000-0000-0000-0000000000c4', 2500, 'Fattorino irraggiungibile da tre giorni');
INSERT INTO r SELECT 'ritirato',          public.admin_chiudi_consegna('e1200000-0000-0000-0000-0000000000c5', 2200, 'Fattorino irraggiungibile da tre giorni');
INSERT INTO r SELECT 'inesistente',       public.admin_chiudi_consegna('e1200000-0000-0000-0000-0000000000ff', 2200, 'Fattorino irraggiungibile da tre giorni');
-- ── l'amministratore: chiude ──────────────────────────────────────────────
INSERT INTO r SELECT 'chiude con incasso', public.admin_chiudi_consegna('e1200000-0000-0000-0000-0000000000c1', 2200, 'Fattorino irraggiungibile da tre giorni');
INSERT INTO r SELECT 'seconda volta',      public.admin_chiudi_consegna('e1200000-0000-0000-0000-0000000000c1', 2200, 'Fattorino irraggiungibile da tre giorni');
INSERT INTO r SELECT 'incasso gia fatto',  public.admin_chiudi_consegna('e1200000-0000-0000-0000-0000000000c6', 9999, 'Fattorino irraggiungibile da tre giorni');
INSERT INTO r SELECT 'rimborsato',         public.admin_chiudi_consegna('e1200000-0000-0000-0000-0000000000c7', 2200, 'Fattorino irraggiungibile da tre giorni');
INSERT INTO r SELECT 'contante corto',     public.admin_chiudi_consegna('e1200000-0000-0000-0000-0000000000c8', 200, 'Fattorino irraggiungibile da tre giorni');
RESET ROLE;

INSERT INTO esiti
SELECT 'rifiuto: ' || caso, risposta ->> 'reason' = atteso, risposta::text
  FROM r JOIN (VALUES
    ('fattorino', 'NOT_ADMIN'), ('negozio', 'NOT_ADMIN'), ('cliente', 'NOT_ADMIN'),
    ('senza motivo', 'MOTIVO_MANCANTE'), ('senza importo', 'INCASSO_MANCANTE'),
    ('fuori misura', 'IMPORTO_FUORI_MISURA'), ('non partito', 'WRONG_STATUS'),
    ('carta', 'NON_IN_CONTANTI'), ('ritiro in negozio', 'RITIRO_IN_NEGOZIO'),
    ('ritirato', 'WRONG_STATUS'), ('inesistente', 'ORDER_NOT_FOUND'), ('seconda volta', 'WRONG_STATUS')
  ) AS a(c, atteso) ON a.c = r.caso;

INSERT INTO esiti SELECT 'chiude: risposta ok con incasso registrato',
  (risposta ->> 'ok')::boolean AND (risposta ->> 'incasso_registrato')::boolean, risposta::text
  FROM r WHERE caso = 'chiude con incasso';
INSERT INTO esiti SELECT 'chiude: consegnato, incasso, pagato e compenso trattenuto in un colpo',
  delivery_status = 'DELIVERED' AND delivered_at IS NOT NULL AND cash_collected_cents = 2200
  AND cash_confirmed_at IS NOT NULL AND cash_collected_by = 'e1200000-0000-0000-0000-000000000004'
  AND payment_status = 'PAID' AND rider_payout_status = 'CASH_WITHHELD' AND rider_payout_at IS NOT NULL,
  format('%s %s %s %s %s', delivery_status, cash_collected_cents, cash_collected_by, payment_status, rider_payout_status)
  FROM public.orders WHERE id = 'e1200000-0000-0000-0000-0000000000c1';
INSERT INTO esiti SELECT 'chiude: il codice alla porta non resta da dettare', verified_at IS NOT NULL, coalesce(verified_at::text, 'null')
  FROM public.order_delivery_codes WHERE order_id = 'e1200000-0000-0000-0000-0000000000c1';
INSERT INTO esiti SELECT 'chiude: il registro nomina l amministratore e il motivo', count(*) = 1, count(*)::text || ' righe'
  FROM public.audit_logs
 WHERE action = 'order.delivery_closed_by_admin' AND target_id = 'e1200000-0000-0000-0000-0000000000c1'
   AND actor_id = 'e1200000-0000-0000-0000-000000000004'
   AND metadata ->> 'motivo' = 'Fattorino irraggiungibile da tre giorni';
INSERT INTO esiti SELECT 'incasso gia dichiarato dal fattorino: chiude e non lo riscrive',
  o.delivery_status = 'DELIVERED' AND o.cash_collected_cents = 2200
  AND o.cash_collected_by = 'e1200000-0000-0000-0000-000000000002' AND (r.risposta ->> 'incasso_registrato')::boolean = false,
  format('%s %s %s', o.delivery_status, o.cash_collected_cents, r.risposta)
  FROM public.orders o, r WHERE o.id = 'e1200000-0000-0000-0000-0000000000c6' AND r.caso = 'incasso gia fatto';
-- Collaudo K03: tre mutanti sui soldi sopravvivevano. Questi li fanno cadere.
INSERT INTO esiti SELECT 'un ordine gia rimborsato resta rimborsato: non torna pagato',
  delivery_status = 'DELIVERED' AND payment_status = 'REFUNDED', delivery_status || ' ' || payment_status
  FROM public.orders WHERE id = 'e1200000-0000-0000-0000-0000000000c7';
INSERT INTO esiti SELECT 'contante che non basta per il compenso: il resto resta dovuto al fattorino (HELD)',
  rider_payout_status = 'HELD' AND rider_payout_at IS NULL AND payment_status = 'PAID',
  format('%s %s %s', rider_payout_status, rider_payout_at, payment_status)
  FROM public.orders WHERE id = 'e1200000-0000-0000-0000-0000000000c8';
INSERT INTO esiti SELECT 'la chiusura blocca la riga dell ordine (FOR UPDATE: niente gara col fattorino che ricompare)',
  pg_get_functiondef('public.admin_chiudi_consegna(uuid, integer, text)'::regprocedure)
    ~* 'from\s+public\.orders\s+where\s+id\s*=\s*p_order_id\s+for\s+update', '';

INSERT INTO esiti SELECT 'i rifiutati restano come erano', bool_and(delivery_status <> 'DELIVERED' AND cash_confirmed_at IS NULL),
  string_agg(delivery_status, ',')
  FROM public.orders WHERE id IN ('e1200000-0000-0000-0000-0000000000c2', 'e1200000-0000-0000-0000-0000000000c4', 'e1200000-0000-0000-0000-0000000000c5');
INSERT INTO esiti SELECT 'la carta in strada resta in strada', delivery_status = 'OUT_FOR_DELIVERY', delivery_status
  FROM public.orders WHERE id = 'e1200000-0000-0000-0000-0000000000c3';
INSERT INTO esiti SELECT 'gli anonimi non la possono chiamare',
  NOT has_function_privilege('anon', 'public.admin_chiudi_consegna(uuid, integer, text)', 'EXECUTE'), '';

SELECT nome, CASE WHEN ok THEN 'ok' ELSE 'ROTTO' END AS esito, dettaglio FROM esiti ORDER BY nome;

DO $$
DECLARE rossi int; elenco text; quanti int;
BEGIN
  SELECT count(*) INTO quanti FROM esiti;
  SELECT count(*), coalesce(string_agg(format('%s → %s', e.nome, e.dettaglio), E'\n  '), '')
    INTO rossi, elenco FROM esiti e WHERE e.ok IS NOT TRUE;
  IF quanti < 23 THEN RAISE EXCEPTION 'solo % controlli: ne manca qualcuno', quanti; END IF;
  IF rossi > 0 THEN
    RAISE EXCEPTION E'% controllo/i rosso/i sulla chiusura della consegna:\n  %', rossi, elenco;
  END IF;
  RAISE NOTICE 'l amministratore chiude la consegna: % controlli verdi', quanti;
END $$;

ROLLBACK;

-- =============================================================================
-- Il bonifico di rimborso di un reclamo porta il giorno da cui contare i 14 giorni
-- =============================================================================
-- Gira contro un database ricostruito dalle migrazioni vere:
--   tests/sql/harness/apply.sh mycity_test
--   tests/sql/harness/run.sh   mycity_test
--
-- R05-004 (onda 2, 28/11/2026). La 910 elencava i bonifici di rimborso da fare
-- con il giorno della richiesta solo per i resi: per un reclamo nessun giorno,
-- quindi termine «sconosciuto» e nessun allarme del sorvegliante.
--
-- COSA CONTROLLA, con un ordine in contanti che porta tre bonifici (un reso, un
-- reclamo di quell'ordine, e un segno col reclamo di UN ALTRO ordine):
--   ① il reclamo porta quando è stato aperto e quando è stato deciso, e
--     `chiesto_il` resta vuoto (la colonna della 910 non cambia senso);
--   ② il reso porta il giorno della richiesta e niente date di reclamo;
--   ③ un reclamo di un altro ordine non presta le sue date;
--   ④ il server (il sorvegliante) legge le date; il cliente e un anonimo no.
--
-- Senza la migrazione 999o questa prova è ROSSA (le colonne non ci sono).
-- Tutto in transazione, ROLLBACK.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';
SET LOCAL mycity.allow_order_write   = '1';

CREATE TEMP TABLE esiti (nome text, verde boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated, service_role;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('e1040000-0000-0000-0000-00000000000a', 'fornaio-e1@test.it', '{"role":"seller"}'),
  ('e1040000-0000-0000-0000-00000000000b', 'mario-e1@test.it',   '{"role":"buyer"}'),
  ('e1040000-0000-0000-0000-00000000000c', 'anna-e1@test.it',    '{"role":"buyer"}');

UPDATE public.profiles
   SET is_approved = true, approval_status = 'approved', store_name = 'Pane Quotidiano'
 WHERE id = 'e1040000-0000-0000-0000-00000000000a';
UPDATE public.profiles SET full_name = 'Mario Rossi' WHERE id = 'e1040000-0000-0000-0000-00000000000b';
UPDATE public.profiles SET role = 'admin', full_name = 'Anna Conti' WHERE id = 'e1040000-0000-0000-0000-00000000000c';

INSERT INTO public.orders (
  id, user_id, seller_id, total_price, gross_total_cents,
  payment_method, payment_status, delivery_status,
  delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip
) VALUES
  ('e1040000-1111-0000-0000-000000000001', 'e1040000-0000-0000-0000-00000000000b', 'e1040000-0000-0000-0000-00000000000a',
   40.00, 4000, 'cod', 'PAID', 'DELIVERED', 'Mario Rossi', '3331234567', 'Via Verdi 10', 'Piacenza', '29121'),
  ('e1040000-1111-0000-0000-000000000002', 'e1040000-0000-0000-0000-00000000000b', 'e1040000-0000-0000-0000-00000000000a',
   12.00, 1200, 'cod', 'PAID', 'DELIVERED', 'Mario Rossi', '3331234567', 'Via Verdi 10', 'Piacenza', '29121');

INSERT INTO public.returns (id, order_id, buyer_id, seller_id, reason, status, created_at)
VALUES ('e1040000-2222-0000-0000-000000000001', 'e1040000-1111-0000-0000-000000000001',
        'e1040000-0000-0000-0000-00000000000b', 'e1040000-0000-0000-0000-00000000000a',
        'DAMAGED', 'REQUESTED', '2026-11-02T09:00:00Z');

-- Il reclamo dell'ordine 1, aperto il 1° novembre e deciso il 20; uno dell'ordine 2.
INSERT INTO public.disputes (id, order_id, opener_id, reason, description, status, created_at, resolved_at, refund_cents)
VALUES
  ('e1040000-3333-0000-0000-000000000001', 'e1040000-1111-0000-0000-000000000001', 'e1040000-0000-0000-0000-00000000000b',
   'not_received', 'Non è mai arrivato', 'resolved_buyer', '2026-11-01T08:30:00Z', '2026-11-20T16:00:00Z', 1000),
  ('e1040000-3333-0000-0000-000000000002', 'e1040000-1111-0000-0000-000000000002', 'e1040000-0000-0000-0000-00000000000b',
   'not_received', 'Altro ordine', 'resolved_buyer', '2026-10-01T08:30:00Z', '2026-10-02T16:00:00Z', 500);

SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims = '{"role":"service_role"}';
UPDATE public.orders
   SET stripe_refund_id = 'bonifico:3000:return_e1040000-2222-0000-0000-000000000001,'
                       || 'bonifico:1000:dispute_e1040000-3333-0000-0000-000000000001,'
                       || 'bonifico:500:dispute_e1040000-3333-0000-0000-000000000002'
 WHERE id = 'e1040000-1111-0000-0000-000000000001';
RESET request.jwt.claims;
RESET ROLE;

RESET mycity.allow_profile_write;
RESET mycity.allow_order_write;

CREATE OR REPLACE FUNCTION pg_temp.esito(p_sql text) RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN 'PASSATO';
EXCEPTION WHEN others THEN
  RETURN SQLSTATE;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.esito(text) TO anon, authenticated, service_role;

-- ① ② ③ — Anna (amministratrice) legge -------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"e1040000-0000-0000-0000-00000000000c","role":"authenticated"}';
INSERT INTO esiti
SELECT 'il reclamo porta quando è stato aperto e quando è stato deciso',
       e.reclamo_aperto_il = '2026-11-01T08:30:00Z'::timestamptz
         AND e.reclamo_deciso_il = '2026-11-20T16:00:00Z'::timestamptz
         AND e.chiesto_il IS NULL AND e.centesimi = 1000 AND e.stato = 'DA_FARE',
       format('aperto %s · deciso %s · chiesto %s', e.reclamo_aperto_il, e.reclamo_deciso_il, coalesce(e.chiesto_il::text, '-'))
  FROM public.admin_bonifici_rimborso() e
 WHERE e.chiave = 'dispute_e1040000-3333-0000-0000-000000000001';
INSERT INTO esiti
SELECT 'il reso porta il giorno della richiesta e niente date di reclamo',
       e.chiesto_il = '2026-11-02T09:00:00Z'::timestamptz AND e.reclamo_aperto_il IS NULL AND e.reclamo_deciso_il IS NULL,
       format('chiesto %s · aperto %s', e.chiesto_il, coalesce(e.reclamo_aperto_il::text, '-'))
  FROM public.admin_bonifici_rimborso() e
 WHERE e.chiave = 'return_e1040000-2222-0000-0000-000000000001';
INSERT INTO esiti
SELECT 'un reclamo di un altro ordine non presta le sue date',
       e.reclamo_aperto_il IS NULL AND e.reclamo_deciso_il IS NULL,
       format('aperto %s', coalesce(e.reclamo_aperto_il::text, '-'))
  FROM public.admin_bonifici_rimborso() e
 WHERE e.chiave = 'dispute_e1040000-3333-0000-0000-000000000002';
INSERT INTO esiti
SELECT 'tre bonifici, uno per segno', count(*) = 3, count(*) || ' righe'
  FROM public.admin_bonifici_rimborso() e;
RESET request.jwt.claims;
RESET ROLE;

-- ④ — Il server sì, il cliente e l'anonimo no ------------------------------------
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims = '{"role":"service_role"}';
INSERT INTO esiti
SELECT 'il server legge le date del reclamo (allarme del termine)',
       count(*) = 1, count(*) || ' reclami con la data'
  FROM public.admin_bonifici_rimborso() e
 WHERE e.reclamo_aperto_il IS NOT NULL;
RESET request.jwt.claims;
RESET ROLE;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"e1040000-0000-0000-0000-00000000000b","role":"authenticated"}';
DO $$
DECLARE legge text;
BEGIN
  legge := pg_temp.esito('SELECT * FROM public.admin_bonifici_rimborso()');
  INSERT INTO esiti VALUES ('il cliente non legge l elenco dei bonifici', legge = '42501', 'risposta: ' || legge);
END $$;
RESET request.jwt.claims;
RESET ROLE;

SET LOCAL ROLE anon;
DO $$
DECLARE legge text;
BEGIN
  legge := pg_temp.esito('SELECT * FROM public.admin_bonifici_rimborso()');
  INSERT INTO esiti VALUES ('un anonimo non legge l elenco dei bonifici', legge = '42501', 'risposta: ' || legge);
END $$;
RESET ROLE;

-- ── Verdetto ──────────────────────────────────────────────────────────────
SELECT nome, CASE WHEN verde THEN 'ok' ELSE 'ROTTO' END AS esito, dettaglio
  FROM esiti ORDER BY nome;

DO $$
DECLARE rossi int; elenco text;
BEGIN
  SELECT count(*), coalesce(string_agg(format('%s → %s', e.nome, e.dettaglio), E'\n  '), '')
    INTO rossi, elenco
  FROM esiti e WHERE e.verde IS NOT TRUE;

  IF (SELECT count(*) FROM esiti) <> 7 THEN
    RAISE EXCEPTION 'la prova doveva fare 7 controlli e ne ha fatti %', (SELECT count(*) FROM esiti);
  END IF;
  IF rossi > 0 THEN
    RAISE EXCEPTION E'% controllo/i rosso/i sul termine dei reclami:\n  %', rossi, elenco;
  END IF;
  RAISE NOTICE 'il bonifico di un reclamo porta le sue date: % controlli verdi', (SELECT count(*) FROM esiti);
END $$;

ROLLBACK;

-- =============================================================================
-- Il bonifico di rimborso al cliente si segna «fatto» una volta sola
-- =============================================================================
-- Gira contro un database ricostruito dalle migrazioni vere:
--   tests/sql/harness/apply.sh mycity_test
--   tests/sql/harness/run.sh   mycity_test
--
-- R05 (26/11/2026). Chi ha pagato in contanti riavrà i soldi con un bonifico
-- fatto a mano dall'app della banca. Sull'ordine resta il segno
-- `bonifico:<centesimi>:<chiave>`; poi, dice il registro dei fatti di Nicola
-- (29/10), chi ha pagato «tocca "fatto"». Prima non c'era niente da toccare:
-- l'unica difesa contro il doppio pagamento era cercare la causale fra i
-- movimenti del conto, e un bonifico respinto dalla banca risultava pagato.
--
-- COSA CONTROLLA, con un ordine in contanti che porta due bonifici (un reso da
-- 30 € e un reclamo da 10 €) e due amministratori:
--   ① l'amministratore legge i bonifici scritti sull'ordine, da fare, col
--     cliente e, per il reso, il giorno della richiesta (da lì i 14 giorni);
--   ② il cliente non legge l'elenco, e non segna niente; un anonimo nemmeno;
--   ③ chiave, cifra od ordine che non sono un segno sull'ordine: rifiutati;
--   ④ il primo amministratore segna «fatto»: passa;
--   ⑤ il secondo, sullo stesso bonifico, riceve «già fatto» con chi e quando,
--     e la riga resta del primo (niente doppio, un solo passo nel registro);
--   ⑥ «respinto dalla banca» vale solo su un bonifico fatto, e lo rimette da
--     fare; dopo si può segnare fatto di nuovo;
--   ⑦ la tabella degli esiti non si legge direttamente; il server legge
--     l'elenco (per l'allarme del termine).
--
-- Senza la migrazione 910 questa prova è ROSSA. Tutto in transazione, ROLLBACK.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';
SET LOCAL mycity.allow_order_write   = '1';

CREATE TEMP TABLE esiti (nome text, verde boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated, service_role;
CREATE TEMP TABLE risposte (passo text PRIMARY KEY, r jsonb) ON COMMIT DROP;
GRANT ALL ON risposte TO anon, authenticated, service_role;

-- ------------------------------------------------------------------ personaggi
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('e5000000-0000-0000-0000-00000000000a', 'fornaio-r05@test.it', '{"role":"seller"}'),
  ('e5000000-0000-0000-0000-00000000000b', 'mario-r05@test.it',   '{"role":"buyer"}'),
  ('e5000000-0000-0000-0000-00000000000c', 'anna-r05@test.it',    '{"role":"buyer"}'),
  ('e5000000-0000-0000-0000-00000000000d', 'bruno-r05@test.it',   '{"role":"buyer"}');

UPDATE public.profiles
   SET is_approved = true, approval_status = 'approved', store_name = 'Pane Quotidiano'
 WHERE id = 'e5000000-0000-0000-0000-00000000000a';
UPDATE public.profiles SET full_name = 'Mario Rossi' WHERE id = 'e5000000-0000-0000-0000-00000000000b';
UPDATE public.profiles SET role = 'admin', full_name = 'Anna Conti'  WHERE id = 'e5000000-0000-0000-0000-00000000000c';
UPDATE public.profiles SET role = 'admin', full_name = 'Bruno Verdi' WHERE id = 'e5000000-0000-0000-0000-00000000000d';

-- L'ordine di Mario, 40 € in contanti, e un secondo ordine senza bonifici.
INSERT INTO public.orders (
  id, user_id, seller_id, total_price, gross_total_cents,
  payment_method, payment_status, delivery_status,
  delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip
) VALUES
  ('e5000000-1111-0000-0000-000000000001', 'e5000000-0000-0000-0000-00000000000b', 'e5000000-0000-0000-0000-00000000000a',
   40.00, 4000, 'cod', 'PAID', 'DELIVERED', 'Mario Rossi', '3331234567', 'Via Verdi 10', 'Piacenza', '29121'),
  ('e5000000-1111-0000-0000-000000000002', 'e5000000-0000-0000-0000-00000000000b', 'e5000000-0000-0000-0000-00000000000a',
   12.00, 1200, 'cod', 'PAID', 'DELIVERED', 'Mario Rossi', '3331234567', 'Via Verdi 10', 'Piacenza', '29121');

INSERT INTO public.returns (id, order_id, buyer_id, seller_id, reason, status, created_at)
VALUES ('e5000000-2222-0000-0000-000000000001', 'e5000000-1111-0000-0000-000000000001',
        'e5000000-0000-0000-0000-00000000000b', 'e5000000-0000-0000-0000-00000000000a',
        'DAMAGED', 'REQUESTED', '2026-11-02T09:00:00Z');

-- Il segno lo scrive solo il server (061): qui con la chiave di servizio.
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims = '{"role":"service_role"}';
UPDATE public.orders
   SET stripe_refund_id = 'wallet:return_x,bonifico:3000:return_e5000000-2222-0000-0000-000000000001,bonifico:1000:dispute_e5000000-3333-0000-0000-000000000001'
 WHERE id = 'e5000000-1111-0000-0000-000000000001';
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

-- =============================================================================
-- ① Anna (amministratrice) legge i bonifici da fare
-- =============================================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"e5000000-0000-0000-0000-00000000000c","role":"authenticated"}';
INSERT INTO esiti
SELECT 'l amministratore legge i due bonifici dell ordine, da fare',
       count(*) = 2 AND bool_and(e.stato = 'DA_FARE'),
       coalesce(string_agg(e.chiave || '=' || e.stato || '/' || e.centesimi, ', '), '(niente)')
  FROM public.admin_bonifici_rimborso() e;
INSERT INTO esiti
SELECT 'il reso porta il giorno della richiesta, il cliente e l email da cui accettare l IBAN',
       e.centesimi = 3000 AND e.chiesto_il = '2026-11-02T09:00:00Z'::timestamptz
         AND e.cliente_nome = 'Mario Rossi' AND e.cliente_email = 'mario-r05@test.it'
         AND e.order_id = 'e5000000-1111-0000-0000-000000000001',
       format('%s · %s · %s · %s', e.centesimi, e.chiesto_il, e.cliente_nome, e.cliente_email)
  FROM public.admin_bonifici_rimborso() e
 WHERE e.chiave = 'return_e5000000-2222-0000-0000-000000000001';
INSERT INTO esiti
SELECT 'il reclamo non ha un giorno di partenza',
       e.centesimi = 1000 AND e.chiesto_il IS NULL,
       format('%s · %s', e.centesimi, coalesce(e.chiesto_il::text, 'nessun giorno'))
  FROM public.admin_bonifici_rimborso() e
 WHERE e.chiave = 'dispute_e5000000-3333-0000-0000-000000000001';
RESET request.jwt.claims;
RESET ROLE;

-- =============================================================================
-- ② Mario (il cliente) e un anonimo: niente elenco, niente «fatto»
-- =============================================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"e5000000-0000-0000-0000-00000000000b","role":"authenticated"}';
DO $$
DECLARE legge text; segna text;
BEGIN
  legge := pg_temp.esito('SELECT * FROM public.admin_bonifici_rimborso()');
  segna := pg_temp.esito($q$SELECT public.admin_segna_bonifico_rimborso(
             'e5000000-1111-0000-0000-000000000001', 'return_e5000000-2222-0000-0000-000000000001', 3000, 'FATTO')$q$);
  INSERT INTO esiti VALUES ('il cliente non legge l elenco dei bonifici', legge = '42501', 'risposta: ' || legge);
  INSERT INTO esiti VALUES ('il cliente non segna fatto il suo bonifico', segna = '42501', 'risposta: ' || segna);
END $$;
RESET request.jwt.claims;
RESET ROLE;

SET LOCAL ROLE anon;
DO $$
DECLARE segna text;
BEGIN
  segna := pg_temp.esito($q$SELECT public.admin_segna_bonifico_rimborso(
             'e5000000-1111-0000-0000-000000000001', 'return_e5000000-2222-0000-0000-000000000001', 3000, 'FATTO')$q$);
  INSERT INTO esiti VALUES ('un anonimo non segna fatto', segna = '42501', 'risposta: ' || segna);
END $$;
RESET ROLE;

-- =============================================================================
-- ③ Chiave, cifra od ordine sbagliati: rifiutati, e non resta niente
-- =============================================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"e5000000-0000-0000-0000-00000000000c","role":"authenticated"}';
INSERT INTO risposte VALUES
  ('cifra sbagliata', public.admin_segna_bonifico_rimborso(
     'e5000000-1111-0000-0000-000000000001', 'return_e5000000-2222-0000-0000-000000000001', 4000, 'FATTO')),
  ('chiave sbagliata', public.admin_segna_bonifico_rimborso(
     'e5000000-1111-0000-0000-000000000001', 'return_e5000000-2222-0000-0000-000000000009', 3000, 'FATTO')),
  ('chiave a meta', public.admin_segna_bonifico_rimborso(
     'e5000000-1111-0000-0000-000000000001', 'return_e5000000', 3000, 'FATTO')),
  ('ordine sbagliato', public.admin_segna_bonifico_rimborso(
     'e5000000-1111-0000-0000-000000000002', 'return_e5000000-2222-0000-0000-000000000001', 3000, 'FATTO'));
RESET request.jwt.claims;
RESET ROLE;

INSERT INTO esiti
SELECT 'rifiutato: ' || x.passo, x.r->>'ok' = 'false' AND x.r->>'reason' = 'SEGNO_DIVERSO', x.r::text
  FROM risposte x WHERE x.passo IN ('cifra sbagliata', 'chiave sbagliata', 'chiave a meta', 'ordine sbagliato');

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"e5000000-0000-0000-0000-00000000000c","role":"authenticated"}';
INSERT INTO esiti
SELECT 'dopo i rifiuti i bonifici restano tutti da fare',
       count(*) = 2 AND bool_and(e.stato = 'DA_FARE'),
       coalesce(string_agg(e.chiave || '=' || e.stato, ', '), '(niente)')
  FROM public.admin_bonifici_rimborso() e;

-- =============================================================================
-- ④ Anna segna fatto il reso
-- =============================================================================
INSERT INTO risposte VALUES
  ('anna fatto', public.admin_segna_bonifico_rimborso(
     'e5000000-1111-0000-0000-000000000001', 'return_e5000000-2222-0000-0000-000000000001', 3000, 'FATTO'));
RESET request.jwt.claims;
RESET ROLE;

INSERT INTO esiti
SELECT 'il primo amministratore segna fatto', x.r->>'ok' = 'true', x.r::text
  FROM risposte x WHERE x.passo = 'anna fatto';

-- =============================================================================
-- ⑤ Bruno preme «Fatto» sullo stesso bonifico: già fatto da Anna
-- =============================================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"e5000000-0000-0000-0000-00000000000d","role":"authenticated"}';
INSERT INTO risposte VALUES
  ('bruno fatto', public.admin_segna_bonifico_rimborso(
     'e5000000-1111-0000-0000-000000000001', 'return_e5000000-2222-0000-0000-000000000001', 3000, 'FATTO'));
INSERT INTO esiti
SELECT 'l elenco dice fatto, e da chi',
       e.stato = 'FATTO' AND e.fatto_da_nome = 'Anna Conti' AND e.fatto_il IS NOT NULL,
       format('%s · %s · %s', e.stato, e.fatto_da_nome, e.fatto_il)
  FROM public.admin_bonifici_rimborso() e
 WHERE e.chiave = 'return_e5000000-2222-0000-0000-000000000001';
RESET request.jwt.claims;
RESET ROLE;

INSERT INTO esiti
SELECT 'il secondo amministratore legge «già fatto» con chi e quando',
       x.r->>'ok' = 'false' AND x.r->>'reason' = 'GIA_FATTO'
         AND x.r->>'fatto_da_nome' = 'Anna Conti' AND (x.r->>'fatto_il') IS NOT NULL,
       x.r::text
  FROM risposte x WHERE x.passo = 'bruno fatto';

INSERT INTO esiti
SELECT 'un solo «fatto» nel registro, quello di Anna',
       count(*) = 1 AND bool_and(a.actor_id = 'e5000000-0000-0000-0000-00000000000c'),
       count(*) || ' righe'
  FROM public.audit_logs a
 WHERE a.action = 'refund_transfer.done' AND a.target_id = 'e5000000-1111-0000-0000-000000000001';

-- =============================================================================
-- ⑥ Respinto dalla banca: solo su un bonifico fatto, e torna da fare
-- =============================================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"e5000000-0000-0000-0000-00000000000d","role":"authenticated"}';
INSERT INTO risposte VALUES
  ('respinto mai fatto', public.admin_segna_bonifico_rimborso(
     'e5000000-1111-0000-0000-000000000001', 'dispute_e5000000-3333-0000-0000-000000000001', 1000, 'RESPINTO'));
INSERT INTO risposte VALUES
  ('bruno respinto', public.admin_segna_bonifico_rimborso(
     'e5000000-1111-0000-0000-000000000001', 'return_e5000000-2222-0000-0000-000000000001', 3000, 'RESPINTO'));
INSERT INTO esiti
SELECT 'il bonifico respinto torna da fare, con chi l ha segnato',
       e.stato = 'RESPINTO' AND e.respinto_da_nome = 'Bruno Verdi' AND e.respinto_il IS NOT NULL,
       format('%s · %s', e.stato, e.respinto_da_nome)
  FROM public.admin_bonifici_rimborso() e
 WHERE e.chiave = 'return_e5000000-2222-0000-0000-000000000001';
INSERT INTO risposte VALUES
  ('bruno rifatto', public.admin_segna_bonifico_rimborso(
     'e5000000-1111-0000-0000-000000000001', 'return_e5000000-2222-0000-0000-000000000001', 3000, 'FATTO'));
INSERT INTO esiti
SELECT 'rifatto dopo il respinto: fatto, da chi l ha rifatto',
       e.stato = 'FATTO' AND e.fatto_da_nome = 'Bruno Verdi',
       format('%s · %s', e.stato, e.fatto_da_nome)
  FROM public.admin_bonifici_rimborso() e
 WHERE e.chiave = 'return_e5000000-2222-0000-0000-000000000001';
RESET request.jwt.claims;
RESET ROLE;

INSERT INTO esiti
SELECT 'respinto su un bonifico mai fatto: rifiutato', x.r->>'ok' = 'false' AND x.r->>'reason' = 'NON_FATTO', x.r::text
  FROM risposte x WHERE x.passo = 'respinto mai fatto';
INSERT INTO esiti
SELECT 'respinto su un bonifico fatto: passa', x.r->>'ok' = 'true', x.r::text
  FROM risposte x WHERE x.passo = 'bruno respinto';
INSERT INTO esiti
SELECT 'dopo il respinto si segna fatto di nuovo', x.r->>'ok' = 'true', x.r::text
  FROM risposte x WHERE x.passo = 'bruno rifatto';

-- =============================================================================
-- ⑦ La tabella degli esiti non si legge da fuori; il server legge l'elenco
-- =============================================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"e5000000-0000-0000-0000-00000000000c","role":"authenticated"}';
DO $$
DECLARE come text;
BEGIN
  come := pg_temp.esito('SELECT * FROM private.bonifici_rimborso');
  INSERT INTO esiti VALUES ('nemmeno un amministratore legge la tabella degli esiti direttamente', come = '42501', 'risposta: ' || come);
END $$;
RESET request.jwt.claims;
RESET ROLE;

SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims = '{"role":"service_role"}';
INSERT INTO esiti
SELECT 'il server legge l elenco (allarme del termine)', count(*) = 2, count(*) || ' bonifici'
  FROM public.admin_bonifici_rimborso() e;
RESET request.jwt.claims;
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

  IF (SELECT count(*) FROM esiti) <> 22 THEN
    RAISE EXCEPTION 'la prova doveva fare 22 controlli e ne ha fatti %', (SELECT count(*) FROM esiti);
  END IF;
  IF rossi > 0 THEN
    RAISE EXCEPTION E'% controllo/i rosso/i sul bonifico di rimborso:\n  %', rossi, elenco;
  END IF;
  RAISE NOTICE 'il bonifico di rimborso si segna fatto una volta sola: % controlli verdi', (SELECT count(*) FROM esiti);
END $$;

ROLLBACK;

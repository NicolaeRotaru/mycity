-- =============================================================================
-- L'ordine in contanti porta la chiave del suo carrello (999p)
-- =============================================================================
-- Gira contro un database ricostruito dalle migrazioni vere:
--   tests/sql/harness/apply.sh mycity_test
--   tests/sql/harness/run.sh   mycity_test
--
-- R06-009 / R09-007 (onda 2, 28/11/2026). Il carrello in contanti si ritrovava
-- solo dalla riga contro il doppio clic (cod_checkout_attempts), scritta a parte
-- dopo gli ordini. Ora l'ordine nasce con la chiave del carrello.
--
-- COSA CONTROLLA:
--   ① il server scrive la chiave con l'ordine, e gli ordini dello stesso
--     cliente con la stessa chiave si ritrovano (con l'indice parziale);
--   ② il cliente non cambia la chiave del suo ordine (non si lega da solo un
--     ordine a un altro carrello), il negozio nemmeno; e anche con una regola di
--     riga che li lasciasse scrivere, la guardia degli ordini ferma la colonna;
--   ③ una chiave vuota o più lunga di 200 caratteri non entra.
-- (La semina degli ordini già nati si prova applicando la migrazione su un
-- database con righe: vedi il referto della campagna.)
--
-- Senza la migrazione 999p questa prova è ROSSA. Tutto in transazione, ROLLBACK.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';
SET LOCAL mycity.allow_order_write   = '1';

CREATE TEMP TABLE esiti (nome text, verde boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated, service_role;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('e1090000-0000-0000-0000-00000000000a', 'forno-e19@test.it', '{"role":"seller"}'),
  ('e1090000-0000-0000-0000-00000000000b', 'mario-e19@test.it', '{"role":"buyer"}'),
  ('e1090000-0000-0000-0000-00000000000c', 'luca-e19@test.it',  '{"role":"buyer"}');
UPDATE public.profiles
   SET is_approved = true, approval_status = 'approved', store_name = 'Forno'
 WHERE id = 'e1090000-0000-0000-0000-00000000000a';

RESET mycity.allow_order_write;

-- ① Il server (la rotta della cassa) scrive gli ordini con la chiave ----------------
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims = '{"role":"service_role"}';
INSERT INTO public.orders (
  id, user_id, seller_id, total_price, gross_total_cents, payment_method, payment_status, delivery_status,
  delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip, cod_cart_key
) VALUES
  ('e1090000-1111-0000-0000-000000000001', 'e1090000-0000-0000-0000-00000000000b', 'e1090000-0000-0000-0000-00000000000a',
   15, 1500, 'cod', 'PENDING', 'NEW', 'Mario', '333', 'Via 1', 'Piacenza', '29121', 'carrello-a'),
  ('e1090000-1111-0000-0000-000000000002', 'e1090000-0000-0000-0000-00000000000b', 'e1090000-0000-0000-0000-00000000000a',
   13, 1300, 'cod', 'PENDING', 'NEW', 'Mario', '333', 'Via 1', 'Piacenza', '29121', 'carrello-a'),
  ('e1090000-1111-0000-0000-000000000003', 'e1090000-0000-0000-0000-00000000000b', 'e1090000-0000-0000-0000-00000000000a',
   9, 900, 'cod', 'PENDING', 'NEW', 'Mario', '333', 'Via 1', 'Piacenza', '29121', 'carrello-b'),
  ('e1090000-1111-0000-0000-000000000004', 'e1090000-0000-0000-0000-00000000000c', 'e1090000-0000-0000-0000-00000000000a',
   9, 900, 'cod', 'PENDING', 'NEW', 'Luca', '333', 'Via 1', 'Piacenza', '29121', 'carrello-a');
INSERT INTO esiti
SELECT 'gli ordini dello stesso cliente con la stessa chiave sono il suo carrello',
       count(*) = 2 AND bool_and(o.id::text LIKE 'e1090000-1111-0000-0000-00000000000_'),
       string_agg(right(o.id::text, 1), ',' ORDER BY o.id)
  FROM public.orders o
 WHERE o.user_id = 'e1090000-0000-0000-0000-00000000000b' AND o.cod_cart_key = 'carrello-a';
RESET request.jwt.claims;
RESET ROLE;

INSERT INTO esiti
SELECT 'c è l indice per cliente e chiave, solo sulle righe con la chiave',
       count(*) = 1,
       coalesce(string_agg(indexdef, ' | '), 'nessun indice')
  FROM pg_indexes
 WHERE schemaname = 'public' AND tablename = 'orders' AND indexname = 'orders_cod_cart_key_idx'
   AND indexdef LIKE '%(user_id, cod_cart_key)%' AND indexdef LIKE '%WHERE (cod_cart_key IS NOT NULL)%';

CREATE OR REPLACE FUNCTION pg_temp.esito(p_sql text) RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN 'PASSATO';
EXCEPTION WHEN others THEN
  RETURN SQLSTATE;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.esito(text) TO anon, authenticated, service_role;

-- ② Il cliente e il negozio non cambiano la chiave ----------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"e1090000-0000-0000-0000-00000000000b","role":"authenticated"}';
DO $$
DECLARE r text;
BEGIN
  r := pg_temp.esito($q$UPDATE public.orders SET cod_cart_key = 'carrello-a'
                        WHERE id = 'e1090000-1111-0000-0000-000000000003'$q$);
  -- Rifiutato (42501) o nessuna riga toccata (la regola di riga non lo lascia scrivere): la prova vera è il valore, qui sotto.
  INSERT INTO esiti VALUES ('il cliente non lega da solo un suo ordine a un altro carrello', r IN ('42501', 'PASSATO'), 'risposta: ' || r);
END $$;
RESET request.jwt.claims;
RESET ROLE;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"e1090000-0000-0000-0000-00000000000a","role":"authenticated"}';
DO $$
DECLARE r text;
BEGIN
  r := pg_temp.esito($q$UPDATE public.orders SET cod_cart_key = NULL
                        WHERE id = 'e1090000-1111-0000-0000-000000000001'$q$);
  INSERT INTO esiti VALUES ('il negozio non toglie la chiave a un ordine', r IN ('42501', 'PASSATO'), 'risposta: ' || r);
END $$;
RESET request.jwt.claims;
RESET ROLE;

-- Anche se la regola di riga un giorno lasciasse scrivere il cliente o il negozio, la guardia degli ordini
-- (enforce_order_update_rules) ferma il campo: qui si prova col cliente che passa la regola di riga.
-- Una regola di riga larghissima, solo dentro questa transazione (ROLLBACK in fondo).
CREATE POLICY prova_e1_2_tutti_scrivono ON public.orders FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"e1090000-0000-0000-0000-00000000000b","role":"authenticated"}';
DO $$
DECLARE r text;
BEGIN
  r := pg_temp.esito($q$UPDATE public.orders SET cod_cart_key = 'carrello-a'
                        WHERE id = 'e1090000-1111-0000-0000-000000000003'$q$);
  INSERT INTO esiti VALUES ('anche passando la regola di riga, la guardia degli ordini ferma la chiave', r = '42501', 'risposta: ' || r);
END $$;
RESET request.jwt.claims;
RESET ROLE;
DROP POLICY prova_e1_2_tutti_scrivono ON public.orders;

INSERT INTO esiti
SELECT 'dopo i tentativi le chiavi sono quelle scritte dal server',
       count(*) FILTER (WHERE o.cod_cart_key = 'carrello-a') = 3 AND count(*) FILTER (WHERE o.cod_cart_key = 'carrello-b') = 1,
       string_agg(right(o.id::text, 1) || '=' || coalesce(o.cod_cart_key, '-'), ', ' ORDER BY o.id)
  FROM public.orders o
 WHERE o.id::text LIKE 'e1090000-1111-%';

-- ③ Chiave vuota o troppo lunga -----------------------------------------------------
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims = '{"role":"service_role"}';
DO $$
DECLARE vuota text; lunga text;
BEGIN
  vuota := pg_temp.esito($q$UPDATE public.orders SET cod_cart_key = ''
                            WHERE id = 'e1090000-1111-0000-0000-000000000003'$q$);
  lunga := pg_temp.esito(format($q$UPDATE public.orders SET cod_cart_key = %L
                            WHERE id = 'e1090000-1111-0000-0000-000000000003'$q$, repeat('k', 201)));
  INSERT INTO esiti VALUES ('una chiave vuota non entra', vuota = '23514', 'risposta: ' || vuota);
  INSERT INTO esiti VALUES ('una chiave oltre i 200 caratteri non entra', lunga = '23514', 'risposta: ' || lunga);
END $$;
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

  IF (SELECT count(*) FROM esiti) <> 8 THEN
    RAISE EXCEPTION 'la prova doveva fare 8 controlli e ne ha fatti %', (SELECT count(*) FROM esiti);
  END IF;
  IF rossi > 0 THEN
    RAISE EXCEPTION E'% controllo/i rosso/i sulla chiave del carrello:\n  %', rossi, elenco;
  END IF;
  RAISE NOTICE 'l ordine in contanti porta la chiave del suo carrello: % controlli verdi', (SELECT count(*) FROM esiti);
END $$;

ROLLBACK;

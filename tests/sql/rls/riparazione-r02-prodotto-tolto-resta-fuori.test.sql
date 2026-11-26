-- =============================================================================
-- 881 — Un prodotto tolto dopo una segnalazione accolta non torna in vendita da solo
-- =============================================================================
--   tests/sql/harness/apply.sh mycity_test && tests/sql/harness/run.sh mycity_test
--   ① il venditore non rimette in vendita il prodotto con una segnalazione accolta
--     (riceve il motivo, il prodotto resta in bozza);
--   ② un rifornimento dello stesso prodotto riesce, ma non lo ripubblica;
--   ③ il venditore attiva ancora un prodotto senza segnalazioni;
--   ④ e uno con la segnalazione respinta;
--   ⑤ il venditore cambia ancora il prezzo del prodotto tolto;
--   ⑥ lo staff lo rimette in vendita;
--   ⑦ il server (chiave di servizio) anche.
-- Senza la migrazione 881 ① e ② sono ROSSI.
-- =============================================================================

BEGIN;
SET LOCAL mycity.allow_profile_write = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('e8810000-0000-0000-0000-000000000001', 'negozio-881@test.it', '{"role":"seller"}'),
  ('e8810000-0000-0000-0000-000000000002', 'admin-881@test.it',   '{"role":"buyer"}');
UPDATE public.profiles SET is_approved = true, approval_status = 'approved', store_name = 'Negozio 881'
 WHERE id = 'e8810000-0000-0000-0000-000000000001';
UPDATE public.profiles SET role = 'admin' WHERE id = 'e8810000-0000-0000-0000-000000000002';

-- p1 tolto (accolta) · p2 senza segnalazioni · p3 tolto ed esaurito · p4 segnalazione respinta · p5 tolto, lo riattiva lo staff
INSERT INTO public.products (id, seller_id, name, description, price, stock, status) VALUES
  ('e8810000-0000-0000-0000-0000000000a1', 'e8810000-0000-0000-0000-000000000001', 'Borsa 881 uno',    'prova', 30, 5, 'draft'),
  ('e8810000-0000-0000-0000-0000000000a2', 'e8810000-0000-0000-0000-000000000001', 'Borsa 881 due',    'prova', 30, 5, 'draft'),
  ('e8810000-0000-0000-0000-0000000000a3', 'e8810000-0000-0000-0000-000000000001', 'Borsa 881 tre',    'prova', 30, 0, 'out_of_stock'),
  ('e8810000-0000-0000-0000-0000000000a4', 'e8810000-0000-0000-0000-000000000001', 'Borsa 881 quattro','prova', 30, 5, 'draft'),
  ('e8810000-0000-0000-0000-0000000000a5', 'e8810000-0000-0000-0000-000000000001', 'Borsa 881 cinque', 'prova', 30, 5, 'draft');
INSERT INTO public.segnalazioni (tipo, oggetto_id, motivo, stato, esito_motivato, deciso_at) VALUES
  ('prodotto', 'e8810000-0000-0000-0000-0000000000a1', 'contraffatto', 'accolta',  'Il marchio è usato senza licenza.', now()),
  ('prodotto', 'e8810000-0000-0000-0000-0000000000a3', 'contraffatto', 'accolta',  'Il marchio è usato senza licenza.', now()),
  ('prodotto', 'e8810000-0000-0000-0000-0000000000a4', 'contraffatto', 'respinta', 'Il prodotto è originale, c''è la fattura.', now()),
  ('prodotto', 'e8810000-0000-0000-0000-0000000000a5', 'contraffatto', 'accolta',  'Il marchio è usato senza licenza.', now());
RESET mycity.allow_profile_write;

-- Scrive una modifica: 'ok' se passa e tocca la riga, altrimenti il codice dell'errore (o 'nessuna riga').
CREATE FUNCTION pg_temp.scrivi(prodotto uuid, cosa text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  EXECUTE format('UPDATE public.products SET %s WHERE id = %L', cosa, prodotto);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN CASE WHEN n = 1 THEN 'ok' ELSE 'nessuna riga' END;
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE || ' ' || left(SQLERRM, 60);
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.scrivi(uuid, text) TO authenticated;

CREATE TEMP TABLE risposte (chiave text, esito text) ON COMMIT DROP;
GRANT ALL ON risposte TO authenticated;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"e8810000-0000-0000-0000-000000000001","role":"authenticated"}';
INSERT INTO risposte VALUES ('p1-attiva',   pg_temp.scrivi('e8810000-0000-0000-0000-0000000000a1', $q$status = 'available'$q$));
INSERT INTO risposte VALUES ('p3-merce',    pg_temp.scrivi('e8810000-0000-0000-0000-0000000000a3', 'stock = 10'));
INSERT INTO risposte VALUES ('p2-attiva',   pg_temp.scrivi('e8810000-0000-0000-0000-0000000000a2', $q$status = 'available'$q$));
INSERT INTO risposte VALUES ('p4-attiva',   pg_temp.scrivi('e8810000-0000-0000-0000-0000000000a4', $q$status = 'available'$q$));
INSERT INTO risposte VALUES ('p1-prezzo',   pg_temp.scrivi('e8810000-0000-0000-0000-0000000000a1', 'price = 25'));
SET LOCAL request.jwt.claims = '{"sub":"e8810000-0000-0000-0000-000000000002","role":"authenticated"}';
INSERT INTO risposte VALUES ('p5-staff',    pg_temp.scrivi('e8810000-0000-0000-0000-0000000000a5', $q$status = 'available'$q$));
RESET ROLE;

INSERT INTO esiti SELECT '1 il venditore non rimette in vendita il prodotto tolto',
  r.esito LIKE '23514%' AND p.status = 'draft', r.esito || ' · stato ' || p.status
  FROM risposte r, public.products p WHERE r.chiave = 'p1-attiva' AND p.id = 'e8810000-0000-0000-0000-0000000000a1';
INSERT INTO esiti SELECT '2 il rifornimento del prodotto tolto riesce ma non lo ripubblica',
  r.esito = 'ok' AND p.stock = 10 AND p.status = 'out_of_stock', r.esito || ' · stato ' || p.status || ' · merce ' || p.stock
  FROM risposte r, public.products p WHERE r.chiave = 'p3-merce' AND p.id = 'e8810000-0000-0000-0000-0000000000a3';
INSERT INTO esiti SELECT '3 il venditore attiva un prodotto senza segnalazioni',
  r.esito = 'ok' AND p.status = 'available', r.esito || ' · stato ' || p.status
  FROM risposte r, public.products p WHERE r.chiave = 'p2-attiva' AND p.id = 'e8810000-0000-0000-0000-0000000000a2';
INSERT INTO esiti SELECT '4 il venditore attiva un prodotto con la segnalazione respinta',
  r.esito = 'ok' AND p.status = 'available', r.esito || ' · stato ' || p.status
  FROM risposte r, public.products p WHERE r.chiave = 'p4-attiva' AND p.id = 'e8810000-0000-0000-0000-0000000000a4';
INSERT INTO esiti SELECT '5 il venditore cambia ancora il prezzo del prodotto tolto',
  r.esito = 'ok' AND p.price = 25, r.esito || ' · prezzo ' || p.price
  FROM risposte r, public.products p WHERE r.chiave = 'p1-prezzo' AND p.id = 'e8810000-0000-0000-0000-0000000000a1';
INSERT INTO esiti SELECT '6 lo staff rimette in vendita un prodotto tolto',
  r.esito = 'ok' AND p.status = 'available', r.esito || ' · stato ' || p.status
  FROM risposte r, public.products p WHERE r.chiave = 'p5-staff' AND p.id = 'e8810000-0000-0000-0000-0000000000a5';

-- Il server: le rotte usano la chiave di servizio.
SET LOCAL request.jwt.claims = '{"role":"service_role"}';
INSERT INTO esiti SELECT '7 il server rimette in vendita un prodotto tolto', e = 'ok', e
  FROM pg_temp.scrivi('e8810000-0000-0000-0000-0000000000a1', $q$status = 'available'$q$) AS e;

DO $$
DECLARE r record; rossi int;
BEGIN
  FOR r IN SELECT * FROM esiti ORDER BY nome LOOP
    RAISE INFO '%  %  — %', CASE WHEN r.ok THEN 'ok  ' ELSE 'ROTTO' END, r.nome, r.dettaglio;
  END LOOP;
  SELECT count(*) INTO rossi FROM esiti WHERE ok IS NOT TRUE;
  IF rossi > 0 OR (SELECT count(*) FROM esiti) <> 7 THEN
    RAISE EXCEPTION '% controlli su % sono rossi: un prodotto tolto dopo una segnalazione torna in vendita da solo', rossi, (SELECT count(*) FROM esiti);
  END IF;
  RAISE INFO 'un prodotto tolto dopo una segnalazione accolta resta fuori: % controlli verdi', (SELECT count(*) FROM esiti);
END $$;
ROLLBACK;

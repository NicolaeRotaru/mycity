-- =============================================================================
-- S01-04 — Spazi del nome: nomi_pubblici, rider_reviews_ricevute,
--          get_referral_leaderboard()
-- =============================================================================
--   tests/sql/harness/apply.sh mycity_test && tests/sql/harness/run.sh mycity_test
--   ① nomi_pubblici dà la prima parola anche con U+00A0, tabulazione, U+3000;
--   ② «Anna Verdi» resta «Anna»;
--   ③ rider_reviews_ricevute dà la prima parola dell'autore;
--   ④ get_referral_leaderboard() dà la prima parola;
--   ⑤ opzioni e permessi delle due viste sono quelli di prima;
--   ⑥ il nome si salva con uno spazio solo fra le parole, anche dal browser;
--   ⑦ lo stesso con gli altri spazi di Unicode, i caratteri invisibili e i
--     riempitivi, uno per volta, e nomi_pubblici dà la prima parola;
--   ⑧ un nome fatto solo di spazi si salva vuoto (NULL), non '';
--   ⑨ lettere accentate, trattini, apostrofi ed emoji semplici restano come sono;
--   ⑩ la regola, carattere per carattere, su tutta la classe dichiarata nella
--     997, e i caratteri appena fuori restano;
--   ⑪ i selettori di variante si tolgono senza spezzare la parola;
--   ⑫ nomi veri con ZWJ, ZWNJ e selettori di forma mongoli (singalese, persiano,
--     devanagari, malayalam, emoji composte, mongolo) restano interi, e la
--     prima parola pubblica è quella intera;
--   ⑬ le righe già scritte che l'UPDATE della 997 tocca sono solo quelle che
--     cambiano per gli spazi, non quelle con soli ZWJ/ZWNJ/selettori.
-- Senza la migrazione 992 ①, ③, ④ e ⑥ sono ROSSI; senza la 997 ⑦, ⑧, ⑩, ⑪ e
-- ⑬; con la 997 del giro prima (ZWJ e ZWNJ diventavano spazio) ⑩, ⑫ e ⑬.
-- =============================================================================

BEGIN;
SET LOCAL mycity.allow_profile_write = '1';
SET LOCAL mycity.allow_order_write   = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('e9920000-0000-0000-0000-000000000001', 'negozio-s01-04@test.it', '{"role":"seller"}'),
  ('e9920000-0000-0000-0000-000000000002', 'rider-s01-04@test.it',   '{"role":"rider"}'),
  ('e9920000-0000-0000-0000-000000000003', 'a-s01-04@test.it',       '{"role":"buyer"}'),
  ('e9920000-0000-0000-0000-000000000004', 'b-s01-04@test.it',       '{"role":"buyer"}'),
  ('e9920000-0000-0000-0000-000000000005', 'c-s01-04@test.it',       '{"role":"buyer"}'),
  ('e9920000-0000-0000-0000-000000000006', 'd-s01-04@test.it',       '{"role":"buyer"}'),
  ('e9920000-0000-0000-0000-000000000007', 'x-s01-04@test.it',       '{"role":"buyer"}'),
  ('e9920000-0000-0000-0000-000000000008', 'e-s01-04@test.it',       '{"role":"buyer"}'),
  ('e9920000-0000-0000-0000-000000000009', 'f-s01-04@test.it',       '{"role":"buyer"}'),
  ('e9920000-0000-0000-0000-00000000000a', 'g-s01-04@test.it',       '{"role":"buyer"}'),
  ('e9920000-0000-0000-0000-00000000000b', 'h-s01-04@test.it',       '{"role":"buyer"}');
UPDATE public.profiles SET is_approved = true, approval_status = 'approved', store_name = 'Bottega S01-04',
       store_address = 'Via Roma 1', store_lat = 45.05, store_lng = 9.69, visibile_senza_abbonamento = true
 WHERE id = 'e9920000-0000-0000-0000-000000000001';
UPDATE public.profiles SET is_approved = true, approval_status = 'approved', rider_vehicle_type = 'BIKE'
 WHERE id = 'e9920000-0000-0000-0000-000000000002';
UPDATE public.profiles SET full_name = E'Maria Rossi'      WHERE id = 'e9920000-0000-0000-0000-000000000003';
UPDATE public.profiles SET full_name = E'Luca\tBianchi'         WHERE id = 'e9920000-0000-0000-0000-000000000004';
UPDATE public.profiles SET full_name = 'Anna Verdi'             WHERE id = 'e9920000-0000-0000-0000-000000000005';
UPDATE public.profiles SET full_name = E'　Gianni　Neri' WHERE id = 'e9920000-0000-0000-0000-000000000006';

INSERT INTO public.orders (
  id, user_id, seller_id, rider_id, total_price, payment_status, delivery_status,
  delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip, rider_fee_cents
)
SELECT ('a9920000-0000-0000-0000-00000000000' || n)::uuid, ('e9920000-0000-0000-0000-00000000000' || (n + 2))::uuid,
       'e9920000-0000-0000-0000-000000000001', 'e9920000-0000-0000-0000-000000000002', 20, 'PAID', 'DELIVERED',
       'Cliente', '3331234567', 'Via Verdi 10', 'Piacenza', '29121', 450
  FROM generate_series(1, 4) AS n;

INSERT INTO public.store_reviews (store_id, user_id, order_id, rating)
SELECT 'e9920000-0000-0000-0000-000000000001', ('e9920000-0000-0000-0000-00000000000' || (n + 2))::uuid,
       ('a9920000-0000-0000-0000-00000000000' || n)::uuid, 5
  FROM generate_series(1, 4) AS n;
INSERT INTO public.rider_reviews (rider_id, user_id, order_id, rating)
SELECT 'e9920000-0000-0000-0000-000000000002', ('e9920000-0000-0000-0000-00000000000' || (n + 2))::uuid,
       ('a9920000-0000-0000-0000-00000000000' || n)::uuid, 5
  FROM generate_series(1, 2) AS n;
-- ⑦: anche il cliente «e» ha recensito il negozio, così il suo nome è fra i nomi pubblici.
INSERT INTO public.orders (
  id, user_id, seller_id, rider_id, total_price, payment_status, delivery_status,
  delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip, rider_fee_cents
) VALUES ('a9920000-0000-0000-0000-000000000008', 'e9920000-0000-0000-0000-000000000008',
       'e9920000-0000-0000-0000-000000000001', 'e9920000-0000-0000-0000-000000000002', 20, 'PAID', 'DELIVERED',
       'Cliente', '3331234567', 'Via Verdi 10', 'Piacenza', '29121', 450);
INSERT INTO public.store_reviews (store_id, user_id, order_id, rating)
VALUES ('e9920000-0000-0000-0000-000000000001', 'e9920000-0000-0000-0000-000000000008',
        'a9920000-0000-0000-0000-000000000008', 4);
INSERT INTO public.referrals (referrer_id, referred_id, status)
VALUES ('e9920000-0000-0000-0000-000000000003', 'e9920000-0000-0000-0000-000000000008', 'signed_up');

SET LOCAL mycity.allow_profile_write = '0';
SET LOCAL mycity.allow_order_write   = '0';

SET LOCAL ROLE authenticated;

-- Un cliente qualunque.
SET LOCAL request.jwt.claims = '{"sub":"e9920000-0000-0000-0000-000000000007","role":"authenticated"}';
INSERT INTO esiti SELECT '1 nomi_pubblici dà la prima parola anche con spazi speciali',
  string_agg(nome, ',' ORDER BY id) = 'Maria,Luca,Gianni',
  string_agg(coalesce(nome, '∅'), ' | ' ORDER BY id)
  FROM public.nomi_pubblici
 WHERE id IN ('e9920000-0000-0000-0000-000000000003', 'e9920000-0000-0000-0000-000000000004',
              'e9920000-0000-0000-0000-000000000006');
INSERT INTO esiti SELECT '2 un nome con lo spazio normale resta la prima parola', nome = 'Anna', coalesce(nome, '∅')
  FROM public.nomi_pubblici WHERE id = 'e9920000-0000-0000-0000-000000000005';
INSERT INTO esiti SELECT '4 la classifica degli inviti dà la prima parola', full_name = 'Maria', coalesce(full_name, '∅')
  FROM public.get_referral_leaderboard() WHERE user_id = 'e9920000-0000-0000-0000-000000000003';

-- Il fattorino.
SET LOCAL request.jwt.claims = '{"sub":"e9920000-0000-0000-0000-000000000002","role":"authenticated"}';
INSERT INTO esiti SELECT '3 le recensioni del fattorino danno la prima parola dell''autore',
  string_agg(autore_nome, ',' ORDER BY autore_nome) = 'Luca,Maria',
  string_agg(coalesce(autore_nome, '∅'), ' | ' ORDER BY autore_nome)
  FROM public.rider_reviews_ricevute;
-- Il cliente cambia il proprio nome dal browser.
SET LOCAL request.jwt.claims = '{"sub":"e9920000-0000-0000-0000-000000000007","role":"authenticated"}';
UPDATE public.profiles SET full_name = E'Paolo\u00a0\u00a0Gialli ' WHERE id = 'e9920000-0000-0000-0000-000000000007';

-- ⑦ Un carattere per volta fra nome e cognome, scritto dal cliente; poi la prima parola
-- come la vede un altro cliente (funzioni VOLATILE: vedono la riga appena scritta).
CREATE FUNCTION pg_temp.nome_con(p_codice int) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE salvato text; pubblico text;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"e9920000-0000-0000-0000-000000000008","role":"authenticated"}', true);
  UPDATE public.profiles SET full_name = 'Maria' || chr(p_codice) || chr(p_codice) || 'Rossi' || chr(p_codice)
   WHERE id = 'e9920000-0000-0000-0000-000000000008';
  SELECT full_name INTO salvato FROM public.profiles WHERE id = 'e9920000-0000-0000-0000-000000000008';
  PERFORM set_config('request.jwt.claims', '{"sub":"e9920000-0000-0000-0000-000000000007","role":"authenticated"}', true);
  SELECT nome INTO pubblico FROM public.nomi_pubblici WHERE id = 'e9920000-0000-0000-0000-000000000008';
  RETURN CASE WHEN salvato = 'Maria Rossi' AND pubblico = 'Maria' THEN 'ok'
              ELSE format('U+%s: %s / %s', upper(to_hex(p_codice)), coalesce(salvato, '∅'), coalesce(pubblico, '∅')) END;
END $$;
INSERT INTO esiti SELECT '7 gli altri spazi, gli invisibili e i riempitivi diventano uno spazio solo',
  count(*) FILTER (WHERE e <> 'ok') = 0,
  coalesce(string_agg(e, ' | ') FILTER (WHERE e <> 'ok'), count(*) || ' caratteri')
  FROM unnest(ARRAY[
    133, 160, 5760, 8192, 8202, 8232, 8233, 8239, 8287, 12288,           -- spazi di Unicode
    1, 31, 127, 159,                                                      -- controllo
    173, 847, 1564, 6068, 6069, 6158, 8203,                               -- invisibili
    8206, 8207, 8234, 8238, 8288, 8289, 8290, 8291, 8292, 8294, 8297,
    65279, 65520, 65531, 917505, 917536,
    4447, 4448, 10240, 12644, 65440                                       -- riempitivi
  ]) AS c, pg_temp.nome_con(c) AS e;

-- ⑧ Solo spazi, dal browser.
SET LOCAL request.jwt.claims = '{"sub":"e9920000-0000-0000-0000-000000000009","role":"authenticated"}';
UPDATE public.profiles SET full_name = ' ' || chr(160) || chr(12644) || chr(8203) || chr(9) || ' '
 WHERE id = 'e9920000-0000-0000-0000-000000000009';
SET LOCAL request.jwt.claims = '{"sub":"e9920000-0000-0000-0000-00000000000a","role":"authenticated"}';
UPDATE public.profiles SET full_name = 'Nicolò D''Angelo-Çelik ' || chr(128512) WHERE id = 'e9920000-0000-0000-0000-00000000000a';
-- ⑪ Un ideogramma con il suo selettore di variante e un cuore con il selettore emoji.
SET LOCAL request.jwt.claims = '{"sub":"e9920000-0000-0000-0000-00000000000b","role":"authenticated"}';
UPDATE public.profiles SET full_name = chr(33883) || chr(917760) || chr(22478) || ' Hanako ' || chr(10084) || chr(65039)
 WHERE id = 'e9920000-0000-0000-0000-00000000000b';
RESET ROLE;

INSERT INTO esiti SELECT '8 un nome di soli spazi si salva vuoto, non ''''',
  full_name IS NULL, coalesce('[' || full_name || ']', '∅')
  FROM public.profiles WHERE id = 'e9920000-0000-0000-0000-000000000009';
INSERT INTO esiti SELECT '9 accenti, trattini, apostrofi ed emoji restano',
  full_name = 'Nicolò D''Angelo-Çelik ' || chr(128512), full_name
  FROM public.profiles WHERE id = 'e9920000-0000-0000-0000-00000000000a';

INSERT INTO esiti SELECT '11 i selettori di variante si tolgono senza spezzare la parola',
  full_name = chr(33883) || chr(22478) || ' Hanako ' || chr(10084), full_name
  FROM public.profiles WHERE id = 'e9920000-0000-0000-0000-00000000000b';

-- ⑩ Tutta la classe della 997, un carattere per volta, con la funzione del trigger.
CREATE TEMP TABLE classe_997 (da int, a int);
INSERT INTO classe_997 VALUES (9, 13), (32, 32), (1, 31), (127, 159), (160, 160), (173, 173), (847, 847), (1536, 1541), (1564, 1564), (1757, 1757), (1807, 1807), (2192, 2193), (2274, 2274), (4447, 4447), (4448, 4448), (5760, 5760), (6068, 6068), (6069, 6069), (6158, 6158), (8192, 8203), (8206, 8207), (8232, 8239), (8287, 8303), (10240, 10240), (12288, 12288), (12644, 12644), (65279, 65279), (65440, 65440), (65520, 65531), (69821, 69821), (69837, 69837), (78896, 78914), (94180, 94180), (113824, 113827), (119129, 119129), (119155, 119162), (917504, 917759), (918000, 921599);
DO $$
DECLARE rotti text; fuori text;
BEGIN
  IF to_regprocedure('public.profiles_nome_normalizzato(text)') IS NULL THEN
    INSERT INTO esiti VALUES ('10 tutta la classe, carattere per carattere', false, 'manca profiles_nome_normalizzato');
    RETURN;
  END IF;
  EXECUTE $q$
    SELECT string_agg('U+' || upper(to_hex(c)), ' ' ORDER BY c)
      FROM (SELECT DISTINCT generate_series(da, a) AS c FROM classe_997) x
     WHERE public.profiles_nome_normalizzato('Maria' || chr(c) || 'Rossi' || chr(c)) IS DISTINCT FROM 'Maria Rossi'
  $q$ INTO rotti;
  EXECUTE $q$
    SELECT string_agg('U+' || upper(to_hex(c)), ' ' ORDER BY c)
      FROM unnest(ARRAY[33, 45, 183, 1546, 2273, 6155, 6156, 6157, 6159, 8204, 8205, 8208, 8304, 10241, 12289, 12645, 65040, 65532, 917503, 921600]) AS c
     WHERE public.profiles_nome_normalizzato('Maria' || chr(c) || 'Rossi') IS DISTINCT FROM 'Maria' || chr(c) || 'Rossi'
  $q$ INTO fuori;
  INSERT INTO esiti VALUES ('10 tutta la classe, carattere per carattere', rotti IS NULL AND fuori IS NULL,
                            concat_ws(' · ', 'dentro e non normalizzati: ' || rotti, 'fuori e cambiati: ' || fuori));
END $$;

-- ⑫ Nomi veri scritti dal cliente «e», letti come prima parola da un altro cliente.
CREATE FUNCTION pg_temp.nome_intero(p_nome text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE salvato text; pubblico text;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"e9920000-0000-0000-0000-000000000008","role":"authenticated"}', true);
  SET LOCAL ROLE authenticated;
  UPDATE public.profiles SET full_name = p_nome WHERE id = 'e9920000-0000-0000-0000-000000000008';
  SELECT full_name INTO salvato FROM public.profiles WHERE id = 'e9920000-0000-0000-0000-000000000008';
  PERFORM set_config('request.jwt.claims', '{"sub":"e9920000-0000-0000-0000-000000000007","role":"authenticated"}', true);
  SELECT nome INTO pubblico FROM public.nomi_pubblici WHERE id = 'e9920000-0000-0000-0000-000000000008';
  RESET ROLE;
  RETURN CASE WHEN salvato = p_nome AND pubblico = split_part(p_nome, ' ', 1) THEN 'ok'
              ELSE format('%s / %s', coalesce(salvato, '∅'), coalesce(pubblico, '∅')) END;
END $$;
INSERT INTO esiti SELECT '12 nomi veri con ZWJ, ZWNJ e selettori mongoli restano interi',
  count(*) FILTER (WHERE e <> 'ok') = 0,
  coalesce(string_agg(n || ': ' || e, ' | ') FILTER (WHERE e <> 'ok'), count(*) || ' nomi')
  FROM (VALUES
    ('singalese', U&'\0DC1\0DCA\200D\0DBB\0DD3\0DB8\0DAD\0DD3 \0DB4\0DD9\0DBB\0DDA\0DBB\0DCF'),
    ('persiano', U&'\0639\0644\06CC\200C\0631\0636\0627 \0627\062D\0645\062F\06CC'),
    ('devanagari', U&'\0915\094D\200D\0937\092E\093E \0936\0930\094D\092E\093E'),
    ('malayalam', U&'\0D05\0D30\0D4D\200D\0D1C\0D41\0D28\0D4D\200D \0D28\0D3E\0D2F\0D30\0D4D\200D'),
    ('emoji', U&'Giulia \+01F469\200D\+01F4BB'),
    ('mongolo', U&'\1830\180B\1820\1837\1820 \182A\1820\180F\1832\1824')
  ) AS v(n, nome), pg_temp.nome_intero(v.nome) AS e;

-- ⑬ La condizione dell'UPDATE della 997 sulle righe già scritte.
DO $$
DECLARE toccate text;
BEGIN
  IF to_regprocedure('public.profiles_nome_spazi(text)') IS NULL THEN
    INSERT INTO esiti VALUES ('13 l''UPDATE tocca solo le righe che cambiano per gli spazi', false, 'manca profiles_nome_spazi');
    RETURN;
  END IF;
  EXECUTE $q$
    SELECT string_agg(n || '=' || (r IS DISTINCT FROM public.profiles_nome_spazi(r))::text, ' ' ORDER BY n)
      FROM (VALUES
        ('a_zwj',     U&'Giulia \+01F469\200D\+01F4BB'),
        ('b_zwnj',    U&'\0639\0644\06CC\200C\0631\0636\0627'),
        ('c_selettore', U&'Anna \2764\FE0F'),
        ('d_fvs',     U&'\1830\180B\1820'),
        ('e_nbsp',    U&'Anna\00A0Verdi'),
        ('f_zwj_nbsp', U&'Anna\00A0Verdi \+01F469\200D\+01F4BB'),
        ('g_spazi',   '   ')
      ) AS v(n, r)
  $q$ INTO toccate;
  INSERT INTO esiti VALUES ('13 l''UPDATE tocca solo le righe che cambiano per gli spazi',
    toccate = 'a_zwj=false b_zwnj=false c_selettore=false d_fvs=false e_nbsp=true f_zwj_nbsp=true g_spazi=true', toccate);
END $$;

INSERT INTO esiti SELECT '6 il nome si salva con uno spazio solo fra le parole',
  string_agg(full_name, ' | ' ORDER BY id) = 'Maria Rossi | Luca Bianchi | Anna Verdi | Gianni Neri | Paolo Gialli',
  string_agg(replace(replace(full_name, E'\u00a0', '<nbsp>'), E'\t', '<tab>'), ' | ' ORDER BY id)
  FROM public.profiles
 WHERE id IN ('e9920000-0000-0000-0000-000000000003', 'e9920000-0000-0000-0000-000000000004',
              'e9920000-0000-0000-0000-000000000005', 'e9920000-0000-0000-0000-000000000006',
              'e9920000-0000-0000-0000-000000000007');

INSERT INTO esiti SELECT '5 opzioni e permessi delle viste sono quelli di prima',
  bool_and(c.reloptions @> ARRAY['security_barrier=true']
           AND (c.reloptions @> ARRAY['security_invoker=false'] OR c.reloptions @> ARRAY['security_invoker=off'])
           AND has_table_privilege('authenticated', c.oid, 'SELECT')
           AND NOT has_table_privilege('anon', c.oid, 'SELECT')),
  string_agg(c.relname || ' ' || array_to_string(c.reloptions, ','), ' | ')
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relname IN ('nomi_pubblici', 'rider_reviews_ricevute');

DO $$
DECLARE r record; rossi int;
BEGIN
  FOR r IN SELECT * FROM esiti ORDER BY nome LOOP
    RAISE INFO '%  %  — %', CASE WHEN r.ok THEN 'ok  ' ELSE 'ROTTO' END, r.nome, r.dettaglio;
  END LOOP;
  SELECT count(*) INTO rossi FROM esiti WHERE ok IS NOT TRUE;
  IF rossi > 0 OR (SELECT count(*) FROM esiti) <> 13 THEN
    RAISE EXCEPTION '% controlli su % sono rossi (S01-04)', rossi, (SELECT count(*) FROM esiti);
  END IF;
  RAISE INFO 'S01-04: % controlli verdi', (SELECT count(*) FROM esiti);
END $$;
ROLLBACK;

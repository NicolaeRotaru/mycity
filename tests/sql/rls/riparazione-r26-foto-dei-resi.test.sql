-- =============================================================================
-- R26-001 — Le foto dei resi stanno in un magazzino chiuso
-- =============================================================================
-- Gira dopo tests/sql/harness/apply.sh. Transazione con ROLLBACK finale.
--
-- Il cliente fotografa il pacco arrivato rotto, e nella foto c'e' l'etichetta
-- col suo nome e indirizzo. Quelle foto stavano nel magazzino pubblico
-- `products`: chiunque avesse l'indirizzo le vedeva, senza account.
--
-- Qui si guarda il deposito vero ricostruito dalle migrazioni:
--   ① il magazzino delle foto dei resi esiste ed e' chiuso, coi paletti degli
--      altri magazzini di foto;
--   ② scrive solo il cliente, nella sua cartella e per un ordine suo;
--   ③ legge il cliente, il negozio di quell'ordine e l'amministratore; non
--      legge un altro cliente, un altro negozio, chi non ha l'account.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';
SET LOCAL mycity.allow_order_write   = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('e2600000-0000-0000-0000-00000000000a', 'cliente-a-r26@example.com', '{"role":"buyer"}'),
  ('e2600000-0000-0000-0000-00000000000b', 'cliente-b-r26@example.com', '{"role":"buyer"}'),
  ('e2600000-0000-0000-0000-00000000000c', 'forno-r26@example.com',     '{"role":"seller"}'),
  ('e2600000-0000-0000-0000-00000000000d', 'altro-r26@example.com',     '{"role":"seller"}'),
  ('e2600000-0000-0000-0000-00000000000e', 'capo-r26@example.com',      '{"role":"admin"}');
UPDATE public.profiles SET role = 'admin' WHERE id = 'e2600000-0000-0000-0000-00000000000e';

-- L'ordine di A dal forno, e un ordine di B dall'altro negozio.
INSERT INTO public.orders (
  id, user_id, seller_id, total_price, gross_total_cents, payment_method, payment_status, delivery_status,
  pickup_in_store, delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip
) VALUES
  ('e2600000-0000-0000-0000-0000000000f1', 'e2600000-0000-0000-0000-00000000000a', 'e2600000-0000-0000-0000-00000000000c',
   25, 2500, 'card', 'PAID', 'DELIVERED', false, 'Anna A', '333 111', 'Via A 1', 'Piacenza', '29121'),
  ('e2600000-0000-0000-0000-0000000000f2', 'e2600000-0000-0000-0000-00000000000b', 'e2600000-0000-0000-0000-00000000000d',
   18, 1800, 'card', 'PAID', 'DELIVERED', false, 'Bruno B', '333 222', 'Via B 2', 'Piacenza', '29121');

-- =============================================================================
-- ① Il magazzino
-- =============================================================================
INSERT INTO esiti
SELECT 'il magazzino delle foto dei resi esiste ed e chiuso',
       count(*) = 1 AND bool_and(public IS FALSE),
       count(*) || ' magazzini, pubblico: ' || coalesce(string_agg(public::text, ','), '-')
  FROM storage.buckets WHERE id = 'returns';

INSERT INTO esiti
SELECT 'ha i paletti degli altri magazzini di foto: 10 MiB e le foto dell iPhone',
       count(*) = 1 AND bool_and(file_size_limit = 10485760 AND 'image/heic' = ANY (allowed_mime_types)
                                 AND NOT ('image/svg+xml' = ANY (allowed_mime_types))),
       coalesce(string_agg(file_size_limit::text, ','), '-')
  FROM storage.buckets WHERE id = 'returns';

-- La foto del reso di A, messa dal server (solo se il magazzino c'e').
INSERT INTO storage.objects (bucket_id, name, owner)
SELECT 'returns', 'e2600000-0000-0000-0000-00000000000a/e2600000-0000-0000-0000-0000000000f1/pacco-rotto.jpg',
       'e2600000-0000-0000-0000-00000000000a'
 WHERE EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'returns');

-- =============================================================================
-- ② Chi scrive
-- =============================================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"e2600000-0000-0000-0000-00000000000a","role":"authenticated"}';
DO $$
DECLARE esito text;
BEGIN
  BEGIN
    INSERT INTO storage.objects (bucket_id, name)
    VALUES ('returns', 'e2600000-0000-0000-0000-00000000000a/e2600000-0000-0000-0000-0000000000f1/seconda.jpg');
    esito := 'ok';
  EXCEPTION WHEN OTHERS THEN esito := SQLSTATE;
  END;
  INSERT INTO esiti VALUES ('il cliente carica la foto del reso nella sua cartella, per il suo ordine', esito = 'ok', esito);

  BEGIN
    INSERT INTO storage.objects (bucket_id, name)
    VALUES ('returns', 'e2600000-0000-0000-0000-00000000000a/e2600000-0000-0000-0000-0000000000f2/furba.jpg');
    esito := 'entrata';
  EXCEPTION WHEN OTHERS THEN esito := SQLSTATE;
  END;
  INSERT INTO esiti VALUES ('il cliente non carica foto per l ordine di un altro', esito <> 'entrata', esito);

  BEGIN
    INSERT INTO storage.objects (bucket_id, name)
    VALUES ('returns', 'e2600000-0000-0000-0000-00000000000b/e2600000-0000-0000-0000-0000000000f2/furba.jpg');
    esito := 'entrata';
  EXCEPTION WHEN OTHERS THEN esito := SQLSTATE;
  END;
  INSERT INTO esiti VALUES ('il cliente non scrive nella cartella di un altro', esito <> 'entrata', esito);
END $$;
RESET ROLE;
RESET request.jwt.claims;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"e2600000-0000-0000-0000-00000000000c","role":"authenticated"}';
DO $$
DECLARE esito text;
BEGIN
  BEGIN
    INSERT INTO storage.objects (bucket_id, name)
    VALUES ('returns', 'e2600000-0000-0000-0000-00000000000a/e2600000-0000-0000-0000-0000000000f1/del-negozio.jpg');
    esito := 'entrata';
  EXCEPTION WHEN OTHERS THEN esito := SQLSTATE;
  END;
  INSERT INTO esiti VALUES ('il negozio non scrive nella cartella del cliente', esito <> 'entrata', esito);
END $$;
RESET ROLE;
RESET request.jwt.claims;

SET LOCAL ROLE anon;
DO $$
DECLARE esito text;
BEGIN
  BEGIN
    INSERT INTO storage.objects (bucket_id, name)
    VALUES ('returns', 'e2600000-0000-0000-0000-00000000000a/e2600000-0000-0000-0000-0000000000f1/anonima.jpg');
    esito := 'entrata';
  EXCEPTION WHEN OTHERS THEN esito := SQLSTATE;
  END;
  INSERT INTO esiti VALUES ('chi non ha l account non scrive', esito <> 'entrata', esito);
END $$;
RESET ROLE;

-- =============================================================================
-- ③ Chi legge la foto del reso di A
-- =============================================================================
CREATE TEMP TABLE lettori (nome text, chi text, attesa int) ON COMMIT DROP;
GRANT ALL ON lettori TO anon, authenticated;
INSERT INTO lettori VALUES
  ('il cliente legge la sua foto',                   'e2600000-0000-0000-0000-00000000000a', 1),
  ('il negozio dell ordine legge la foto del reso',  'e2600000-0000-0000-0000-00000000000c', 1),
  ('l amministratore legge la foto del reso',        'e2600000-0000-0000-0000-00000000000e', 1),
  ('un altro cliente non la legge',                  'e2600000-0000-0000-0000-00000000000b', 0),
  ('un altro negozio non la legge',                  'e2600000-0000-0000-0000-00000000000d', 0);

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"e2600000-0000-0000-0000-00000000000a","role":"authenticated"}';
INSERT INTO esiti SELECT l.nome, count(o.id) = l.attesa, count(o.id) || ' righe'
  FROM lettori l LEFT JOIN storage.objects o
    ON o.bucket_id = 'returns' AND o.name LIKE '%/pacco-rotto.jpg'
 WHERE l.chi = 'e2600000-0000-0000-0000-00000000000a' GROUP BY l.nome, l.attesa;
RESET ROLE; RESET request.jwt.claims;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"e2600000-0000-0000-0000-00000000000c","role":"authenticated"}';
INSERT INTO esiti SELECT l.nome, count(o.id) = l.attesa, count(o.id) || ' righe'
  FROM lettori l LEFT JOIN storage.objects o
    ON o.bucket_id = 'returns' AND o.name LIKE '%/pacco-rotto.jpg'
 WHERE l.chi = 'e2600000-0000-0000-0000-00000000000c' GROUP BY l.nome, l.attesa;
RESET ROLE; RESET request.jwt.claims;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"e2600000-0000-0000-0000-00000000000e","role":"authenticated"}';
INSERT INTO esiti SELECT l.nome, count(o.id) = l.attesa, count(o.id) || ' righe'
  FROM lettori l LEFT JOIN storage.objects o
    ON o.bucket_id = 'returns' AND o.name LIKE '%/pacco-rotto.jpg'
 WHERE l.chi = 'e2600000-0000-0000-0000-00000000000e' GROUP BY l.nome, l.attesa;
RESET ROLE; RESET request.jwt.claims;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"e2600000-0000-0000-0000-00000000000b","role":"authenticated"}';
INSERT INTO esiti SELECT l.nome, count(o.id) = l.attesa, count(o.id) || ' righe'
  FROM lettori l LEFT JOIN storage.objects o
    ON o.bucket_id = 'returns' AND o.name LIKE '%/pacco-rotto.jpg'
 WHERE l.chi = 'e2600000-0000-0000-0000-00000000000b' GROUP BY l.nome, l.attesa;
RESET ROLE; RESET request.jwt.claims;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"e2600000-0000-0000-0000-00000000000d","role":"authenticated"}';
INSERT INTO esiti SELECT l.nome, count(o.id) = l.attesa, count(o.id) || ' righe'
  FROM lettori l LEFT JOIN storage.objects o
    ON o.bucket_id = 'returns' AND o.name LIKE '%/pacco-rotto.jpg'
 WHERE l.chi = 'e2600000-0000-0000-0000-00000000000d' GROUP BY l.nome, l.attesa;
RESET ROLE; RESET request.jwt.claims;

SET LOCAL ROLE anon;
INSERT INTO esiti
SELECT 'chi non ha l account non legge nessuna foto dei resi', count(*) = 0, count(*) || ' righe'
  FROM storage.objects WHERE bucket_id = 'returns';
RESET ROLE;

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

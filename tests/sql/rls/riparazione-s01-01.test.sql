-- =============================================================================
-- S01-01 — Prodotti: colonne della sincronizzazione esterna
-- =============================================================================
--   tests/sql/harness/apply.sh mycity_test && tests/sql/harness/run.sh mycity_test
--   ① il negozio non cambia le cinque colonne external_* del proprio prodotto;
--   ② il negozio cambia ancora nome, descrizione, prezzo e scorta;
--   ③ rimandare lo stesso snapshot non rompe un salvataggio;
--   ④ il salvataggio con salva_prodotto_e_varianti cambia ancora il prezzo;
--   ⑤ il prodotto di un altro negozio resta fuori (0 righe);
--   ⑥ l'amministratore cambia lo stato della sincronizzazione;
--   ⑦ la chiave di servizio aggiorna snapshot, data e stato;
--   ⑧ in banca dati lo snapshot del prodotto è quello scritto dal server;
--   ⑨ un nuovo prodotto del negozio parte da 'idle' con la data non oltre adesso;
--   ⑩ il nuovo prodotto importato dal modulo tiene snapshot e data;
--   ⑪ l'upsert sul proprio prodotto non cambia lo snapshot;
--   ⑫ un prodotto nuovo senza sincronizzazione resta con la data vuota, sia
--     senza la colonna sia con la data mandata vuota.
-- Senza la migrazione 990 ①, ⑧, ⑨ e ⑪ sono ROSSI; con la 990 senza la 996 ⑫.
-- =============================================================================

BEGIN;
SET LOCAL mycity.allow_profile_write = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated, service_role;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('e9900000-0000-0000-0000-000000000001', 'negozio-a-s01@test.it', '{"role":"seller"}'),
  ('e9900000-0000-0000-0000-000000000002', 'negozio-b-s01@test.it', '{"role":"seller"}'),
  ('e9900000-0000-0000-0000-000000000003', 'staff-s01@test.it',     '{"role":"buyer"}');
UPDATE public.profiles SET is_approved = true, approval_status = 'approved', store_name = 'Negozio S01'
 WHERE id IN ('e9900000-0000-0000-0000-000000000001', 'e9900000-0000-0000-0000-000000000002');
UPDATE public.profiles SET role = 'admin' WHERE id = 'e9900000-0000-0000-0000-000000000003';
RESET mycity.allow_profile_write;

INSERT INTO public.products (id, name, price, seller_id, status, stock,
                             external_source_url, external_marketplace, external_data,
                             external_synced_at, external_sync_status) VALUES
  ('e9900000-0000-0000-0000-0000000000a1', 'Prodotto A', 40, 'e9900000-0000-0000-0000-000000000001', 'available', 5,
   'https://www.ebay.it/itm/1', 'ebay', '{"price": 50, "currency": "EUR"}',
   '2026-11-20 10:00:00+00', 'idle'),
  ('e9900000-0000-0000-0000-0000000000b1', 'Prodotto B', 30, 'e9900000-0000-0000-0000-000000000002', 'available', 5,
   NULL, NULL, NULL, NULL, 'idle');

-- Righe cambiate da un UPDATE di UNA colonna; -1 se fermato per permessi.
CREATE FUNCTION pg_temp.prova(prodotto uuid, colonna text, valore text) RETURNS int
LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  EXECUTE format('UPDATE public.products SET %I = %L WHERE id = %L', colonna, valore, prodotto);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
EXCEPTION WHEN insufficient_privilege THEN RETURN -1;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.prova(uuid, text, text) TO authenticated, service_role;

-- Le colonne della lista che PASSANO (righe > 0), separate da virgola.
CREATE FUNCTION pg_temp.passate(prodotto uuid, coppie text[][]) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE i int; passate text[] := '{}';
BEGIN
  FOR i IN 1 .. array_length(coppie, 1) LOOP
    IF pg_temp.prova(prodotto, coppie[i][1], coppie[i][2]) > 0 THEN
      passate := passate || coppie[i][1];
    END IF;
  END LOOP;
  RETURN array_to_string(passate, ', ');
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.passate(uuid, text[]) TO authenticated, service_role;

CREATE FUNCTION pg_temp.salva(prodotto uuid, patch jsonb) RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.salva_prodotto_e_varianti(prodotto, patch);
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE || ' ' || SQLERRM;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.salva(uuid, jsonb) TO authenticated;

-- Inserisce un prodotto del negozio A e torna stato, data (rispetto ad adesso) e snapshot salvati.
CREATE FUNCTION pg_temp.inserisci(prodotto uuid, sincronizzato timestamptz, stato text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
  INSERT INTO public.products (id, name, price, seller_id, status, stock,
                               external_source_url, external_marketplace, external_data,
                               external_synced_at, external_sync_status)
  VALUES (prodotto, 'Importato', 20, 'e9900000-0000-0000-0000-000000000001', 'available', 1,
          'https://www.ebay.it/itm/9', 'ebay', '{"price": 25, "currency": "EUR"}',
          sincronizzato, coalesce(stato, 'idle'))
  RETURNING external_sync_status, external_synced_at, external_data INTO r;
  RETURN format('stato=%s data=%s snapshot=%s', r.external_sync_status,
                CASE WHEN r.external_synced_at IS NULL THEN 'vuota'
                     WHEN r.external_synced_at = sincronizzato AND r.external_synced_at <= now() THEN 'tenuta'
                     WHEN r.external_synced_at <= now() THEN 'non_oltre_adesso'
                     ELSE 'nel_futuro' END,
                r.external_data::text);
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE || ' ' || SQLERRM;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.inserisci(uuid, timestamptz, text) TO authenticated;

-- Un prodotto del negozio A nato qui, senza sincronizzazione: torna la data salvata.
CREATE FUNCTION pg_temp.nativo(prodotto uuid) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
  INSERT INTO public.products (id, name, price, seller_id, status, stock)
  VALUES (prodotto, 'Nato qui', 5, 'e9900000-0000-0000-0000-000000000001', 'available', 1)
  RETURNING external_synced_at, external_sync_status INTO r;
  RETURN format('stato=%s data=%s', r.external_sync_status, coalesce(r.external_synced_at::text, 'vuota'));
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE || ' ' || SQLERRM;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.nativo(uuid) TO authenticated;

CREATE FUNCTION pg_temp.upsert(prodotto uuid) RETURNS int
LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  INSERT INTO public.products (id, name, price, seller_id)
  VALUES (prodotto, 'Prodotto A', 40, 'e9900000-0000-0000-0000-000000000001')
  ON CONFLICT (id) DO UPDATE SET external_data = '{"price": 2, "currency": "EUR"}';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
EXCEPTION WHEN insufficient_privilege THEN RETURN -1;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.upsert(uuid) TO authenticated;

SET LOCAL ROLE authenticated;

-- Il negozio A, sul proprio prodotto.
SET LOCAL request.jwt.claims = '{"sub":"e9900000-0000-0000-0000-000000000001","role":"authenticated"}';
INSERT INTO esiti SELECT '1 il negozio non cambia le colonne della sincronizzazione', p = '', 'passate: ' || p
  FROM pg_temp.passate('e9900000-0000-0000-0000-0000000000a1', ARRAY[
    ['external_data',        '{"price": 1, "currency": "EUR"}'],
    ['external_synced_at',   '2030-01-01 00:00:00+00'],
    ['external_sync_status', 'pending'],
    ['external_source_url',  'https://www.ebay.it/itm/2'],
    ['external_marketplace', 'amazon']
  ]) AS p;
INSERT INTO esiti SELECT '2 il negozio cambia ancora nome, descrizione, prezzo e scorta', p = 'name, description, price, stock', 'passate: ' || p
  FROM pg_temp.passate('e9900000-0000-0000-0000-0000000000a1', ARRAY[
    ['name',        'Prodotto A nuovo'],
    ['description', 'Descrizione nuova'],
    ['price',       '42'],
    ['stock',       '7']
  ]) AS p;
INSERT INTO esiti SELECT '3 rimandare lo stesso snapshot non rompe il salvataggio', n = 1, 'righe: ' || n
  FROM pg_temp.prova('e9900000-0000-0000-0000-0000000000a1', 'external_data', '{"price": 50, "currency": "EUR"}') AS n;
INSERT INTO esiti SELECT '4 il salvataggio del negozio cambia ancora il prezzo', e = 'ok', e
  FROM pg_temp.salva('e9900000-0000-0000-0000-0000000000a1', '{"price": 44}') AS e;
INSERT INTO esiti SELECT '5 il prodotto di un altro negozio resta fuori', n = 0, 'righe: ' || n
  FROM pg_temp.prova('e9900000-0000-0000-0000-0000000000b1', 'external_sync_status', 'pending') AS n;
INSERT INTO esiti SELECT '9 un nuovo prodotto del negozio parte da idle con la data non oltre adesso',
  e = 'stato=idle data=non_oltre_adesso snapshot={"price": 25, "currency": "EUR"}', e
  FROM pg_temp.inserisci('e9900000-0000-0000-0000-0000000000a2', '2099-01-01 00:00:00+00', 'pending') AS e;
INSERT INTO esiti SELECT '10 il nuovo prodotto importato dal modulo tiene snapshot e data',
  e = 'stato=idle data=tenuta snapshot={"price": 25, "currency": "EUR"}', e
  FROM pg_temp.inserisci('e9900000-0000-0000-0000-0000000000a3', now() - interval '1 minute', NULL) AS e;
INSERT INTO esiti SELECT '11 l''upsert sul proprio prodotto non cambia lo snapshot', n = -1, 'righe: ' || n
  FROM pg_temp.upsert('e9900000-0000-0000-0000-0000000000a1') AS n;
INSERT INTO esiti SELECT '12 un prodotto nuovo senza sincronizzazione resta con la data vuota',
  e = 'stato=idle data=vuota' AND v = 'stato=idle data=vuota snapshot={"price": 25, "currency": "EUR"}',
  e || ' · ' || v
  FROM pg_temp.nativo('e9900000-0000-0000-0000-0000000000a4') AS e,
       pg_temp.inserisci('e9900000-0000-0000-0000-0000000000a5', NULL, NULL) AS v;

-- L'amministratore, dal browser.
SET LOCAL request.jwt.claims = '{"sub":"e9900000-0000-0000-0000-000000000003","role":"authenticated"}';
INSERT INTO esiti SELECT '6 l''amministratore cambia lo stato della sincronizzazione', n = 1, 'righe: ' || n
  FROM pg_temp.prova('e9900000-0000-0000-0000-0000000000b1', 'external_sync_status', 'error') AS n;
RESET ROLE;

-- Il server: le rotte usano la chiave di servizio.
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims = '{"role":"service_role"}';
INSERT INTO esiti SELECT '7 la chiave di servizio aggiorna snapshot, data e stato', p = 'external_sync_status, external_data, external_synced_at, external_sync_status', 'passate: ' || p
  FROM pg_temp.passate('e9900000-0000-0000-0000-0000000000a1', ARRAY[
    ['external_sync_status', 'pending'],
    ['external_data',        '{"price": 48, "currency": "EUR"}'],
    ['external_synced_at',   '2026-11-26 09:00:00+00'],
    ['external_sync_status', 'idle']
  ]) AS p;
RESET ROLE;

INSERT INTO esiti SELECT '8 lo snapshot in banca dati è quello del server',
  external_data = '{"price": 48, "currency": "EUR"}'::jsonb
    AND external_synced_at = '2026-11-26 09:00:00+00'::timestamptz
    AND external_sync_status = 'idle'
    AND external_source_url = 'https://www.ebay.it/itm/1'
    AND external_marketplace = 'ebay'
    AND price = 44 AND name = 'Prodotto A nuovo',
  concat_ws(' | ', external_data::text, external_synced_at::text, external_sync_status,
            external_source_url, external_marketplace, price::text, name)
  FROM public.products WHERE id = 'e9900000-0000-0000-0000-0000000000a1';

DO $$
DECLARE r record; rossi int;
BEGIN
  FOR r IN SELECT * FROM esiti ORDER BY nome LOOP
    RAISE INFO '%  %  — %', CASE WHEN r.ok THEN 'ok  ' ELSE 'ROTTO' END, r.nome, r.dettaglio;
  END LOOP;
  SELECT count(*) INTO rossi FROM esiti WHERE ok IS NOT TRUE;
  IF rossi > 0 OR (SELECT count(*) FROM esiti) <> 12 THEN
    RAISE EXCEPTION '% controlli su % sono rossi (S01-01)', rossi, (SELECT count(*) FROM esiti);
  END IF;
  RAISE INFO 'S01-01: % controlli verdi', (SELECT count(*) FROM esiti);
END $$;
ROLLBACK;

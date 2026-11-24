-- =============================================================================
-- R02 — La campanella «Ordine pronto» dice il giorno della fascia, non solo l'orario,
-- e dice «fattorino», non «rider» (832)
-- =============================================================================
--   tests/sql/harness/apply.sh mycity_test && tests/sql/harness/run.sh mycity_test
--
-- L'orologio è fisso sul giorno di calendario di Piacenza: le date degli ordini si scrivono come
-- mezzogiorno di un giorno preciso a Piacenza (ieri, tre giorni fa), contato da now() nel fuso
-- Europe/Rome, così la prova non cambia esito a mezzanotte né col cambio dell'ora.
--   ① ordine nato oggi per «Domani · 9:00–11:00», pronto stasera: «… a casa domani nella fascia
--     che hai scelto (9:00–11:00).»
--   ② ordine nato oggi per «Oggi · 11:00–13:00»: «… a casa oggi nella fascia … (11:00–13:00).»
--   ③ ordine nato ieri per «Domani · 16:30–18:00»: la fascia è oggi, «oggi», non «domani»
--   ④ ordine nato tre giorni fa per «Oggi · 18:00–19:30»: la fascia è passata, nessun giorno
--   ⑤ tutte le campanelle «ordine pronto» a domicilio dicono «un fattorino passa a prenderlo»,
--     anche la veloce e quella senza fascia, e nessuna dice «rider»
--   ⑥ il ritiro in negozio resta com'era
-- Senza la correzione ①, ②, ③ e ⑤ sono rossi. Tutto in transazione, ROLLBACK.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';
SET LOCAL mycity.allow_order_write   = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;

INSERT INTO auth.users (id, email, raw_user_meta_data, email_confirmed_at) VALUES
  ('e0289000-0000-0000-0000-000000000001', 'forno-r02g@test.it', '{"role":"seller"}', now()),
  ('e0289000-0000-0000-0000-000000000003', 'maria-r02g@test.it', '{"role":"buyer"}',  now());

UPDATE public.profiles
   SET is_approved = true, approval_status = 'approved', store_name = 'Forno R02', store_address = 'Via Roma 1, Piacenza'
 WHERE id = 'e0289000-0000-0000-0000-000000000001';

-- Mezzogiorno di N giorni fa a Piacenza.
CREATE TEMP TABLE giorni ON COMMIT DROP AS
SELECT ((((now() AT TIME ZONE 'Europe/Rome')::date - 1) + time '12:00') AT TIME ZONE 'Europe/Rome') AS ieri,
       ((((now() AT TIME ZONE 'Europe/Rome')::date - 3) + time '12:00') AT TIME ZONE 'Europe/Rome') AS tre_giorni_fa;

INSERT INTO public.orders (id, user_id, seller_id, total_price, gross_total_cents, payment_method, payment_status,
  delivery_status, pickup_in_store, delivery_slot, delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip, created_at)
SELECT v.id::uuid, 'e0289000-0000-0000-0000-000000000003', 'e0289000-0000-0000-0000-000000000001',
       10, 1000, 'card', 'PAID', 'ACCEPTED', v.ritiro, v.fascia, 'Maria', '3', 'Via Verdi 1', 'Piacenza', '29121', v.nato
  FROM giorni g, LATERAL (VALUES
    ('e0289000-0000-0000-0000-0000000000a1', 'Domani · 9:00–11:00',          false, now()),
    ('e0289000-0000-0000-0000-0000000000a2', 'Oggi · 11:00–13:00',           false, now()),
    ('e0289000-0000-0000-0000-0000000000a3', 'Domani · 16:30–18:00',         false, g.ieri),
    ('e0289000-0000-0000-0000-0000000000a4', 'Oggi · 18:00–19:30',           false, g.tre_giorni_fa),
    ('e0289000-0000-0000-0000-0000000000a5', 'Adesso · arrivo in 45 minuti', false, now()),
    ('e0289000-0000-0000-0000-0000000000a6', NULL,                           false, now()),
    ('e0289000-0000-0000-0000-0000000000a7', NULL,                           true,  now())
  ) AS v(id, fascia, ritiro, nato);

UPDATE public.orders SET delivery_status = 'READY' WHERE id::text LIKE 'e0289000-%';

CREATE TEMP TABLE pronti ON COMMIT DROP AS
SELECT replace(link, '/orders/', '') AS ordine, body
  FROM public.notifications
 WHERE user_id = 'e0289000-0000-0000-0000-000000000003' AND title = 'Ordine pronto';

INSERT INTO esiti SELECT '① nato oggi per domani: «a casa domani nella fascia che hai scelto (9:00–11:00).»',
  coalesce(bool_and(body LIKE '%a casa domani nella fascia che hai scelto (9:00–11:00).'), false), string_agg(body, ' / ')
  FROM pronti WHERE ordine = 'e0289000-0000-0000-0000-0000000000a1';
INSERT INTO esiti SELECT '② nato oggi per oggi: «a casa oggi nella fascia che hai scelto (11:00–13:00).»',
  coalesce(bool_and(body LIKE '%a casa oggi nella fascia che hai scelto (11:00–13:00).'), false), string_agg(body, ' / ')
  FROM pronti WHERE ordine = 'e0289000-0000-0000-0000-0000000000a2';
INSERT INTO esiti SELECT '③ nato ieri per domani: la fascia è oggi, «a casa oggi nella fascia … (16:30–18:00).»',
  coalesce(bool_and(body LIKE '%a casa oggi nella fascia che hai scelto (16:30–18:00).'), false), string_agg(body, ' / ')
  FROM pronti WHERE ordine = 'e0289000-0000-0000-0000-0000000000a3';
INSERT INTO esiti SELECT '④ fascia già passata: nessun giorno, «a casa nella fascia che hai scelto (18:00–19:30).»',
  coalesce(bool_and(body LIKE '%a casa nella fascia che hai scelto (18:00–19:30).'), false), string_agg(body, ' / ')
  FROM pronti WHERE ordine = 'e0289000-0000-0000-0000-0000000000a4';
INSERT INTO esiti SELECT '⑤ a domicilio tutte dicono «un fattorino passa a prenderlo» e nessuna «rider»',
  coalesce(bool_and(body LIKE '%un fattorino passa a prenderlo%' AND body NOT ILIKE '%rider%'), false) AND count(*) = 6,
  count(*) || ' avvisi: ' || string_agg(body, ' / ')
  FROM pronti WHERE ordine <> 'e0289000-0000-0000-0000-0000000000a7';
INSERT INTO esiti SELECT '⑤ la veloce e quella senza fascia restano «a breve»',
  coalesce(bool_and(body LIKE '%un fattorino passa a prenderlo a breve%'), false) AND count(*) = 2, string_agg(body, ' / ')
  FROM pronti WHERE ordine IN ('e0289000-0000-0000-0000-0000000000a5', 'e0289000-0000-0000-0000-0000000000a6');
INSERT INTO esiti SELECT '⑥ il ritiro in negozio resta «passare a ritirarlo in negozio»',
  coalesce(bool_and(body LIKE '%passare a ritirarlo in negozio%'), false), string_agg(body, ' / ')
  FROM pronti WHERE ordine = 'e0289000-0000-0000-0000-0000000000a7';
INSERT INTO esiti SELECT 'una campanella per ordine', count(*) = 7, count(*) || ' avvisi' FROM pronti;

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
  RAISE INFO 'tutti verdi: % controlli', (SELECT count(*) FROM esiti);
END $$;

ROLLBACK;

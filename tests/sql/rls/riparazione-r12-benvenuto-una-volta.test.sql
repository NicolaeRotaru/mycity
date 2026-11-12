-- =============================================================================
-- R12-004 — Il codice «solo primo ordine» si rivendica una volta per cliente
-- =============================================================================
--   tests/sql/harness/apply.sh mycity_test && tests/sql/harness/run.sh mycity_test
--
-- Due schede aperte rivendicavano due volte il benvenuto: claim_coupon non
-- sapeva chi lo usava. Qui:
--   ① prima rivendicazione del cliente → si';
--   ② seconda dello stesso cliente, subito dopo (l'altra scheda) → no;
--   ③ un altro cliente → si';
--   ④ una rivendicazione di piu' di due ore fa non blocca piu' (la cassa e' scaduta);
--   ⑤ un ordine annullato restituisce il codice con release_coupon(codice, ordine):
--      il cliente lo puo' rivendicare di nuovo;
--   ⑥ un codice normale (non first_order_only) non si blocca per cliente;
--   ⑦ nessuno dall'esterno legge o scrive coupon_redemptions.
-- Senza la migrazione 361 la funzione a due argomenti non esiste: ROSSO.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';
SET LOCAL mycity.allow_order_write   = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('e1240000-0000-0000-0000-000000000001', 'fornaio-r12c@test.it', '{"role":"seller"}'),
  ('e1240000-0000-0000-0000-000000000002', 'maria-r12c@test.it',   '{"role":"buyer"}'),
  ('e1240000-0000-0000-0000-000000000003', 'luca-r12c@test.it',    '{"role":"buyer"}'),
  ('e1240000-0000-0000-0000-000000000004', 'anna-r12c@test.it',    '{"role":"buyer"}');
UPDATE public.profiles SET is_approved = true, approval_status = 'approved', store_name = 'Pane R12c'
 WHERE id = 'e1240000-0000-0000-0000-000000000001';

INSERT INTO public.coupons (code, type, value, first_order_only, active) VALUES
  ('BENVENUTO-R12', 'FIXED', 5, true, true),
  ('ESTATE-R12', 'FIXED', 2, false, true);

INSERT INTO esiti SELECT '1 prima rivendicazione: si',
  public.claim_coupon('benvenuto-r12', 'e1240000-0000-0000-0000-000000000002'), '';
INSERT INTO esiti SELECT '2 la seconda scheda dello stesso cliente: no',
  NOT public.claim_coupon('BENVENUTO-R12', 'e1240000-0000-0000-0000-000000000002'), '';
INSERT INTO esiti SELECT '3 un altro cliente: si',
  public.claim_coupon('BENVENUTO-R12', 'e1240000-0000-0000-0000-000000000003'), '';
INSERT INTO esiti SELECT '3b il contatore conta solo le rivendicazioni riuscite',
  uses_count = 2, uses_count::text FROM public.coupons WHERE code = 'BENVENUTO-R12';

-- ④ una rivendicazione di tre ore fa, mai chiusa (cassa scaduta senza ordine)
INSERT INTO public.coupon_redemptions (coupon_id, user_id, claimed_at)
SELECT id, 'e1240000-0000-0000-0000-000000000004', now() - interval '3 hours'
  FROM public.coupons WHERE code = 'BENVENUTO-R12';
INSERT INTO esiti SELECT '4 una rivendicazione vecchia di tre ore non blocca piu',
  public.claim_coupon('BENVENUTO-R12', 'e1240000-0000-0000-0000-000000000004'), '';
INSERT INTO esiti SELECT '4b ma una rivendicazione appena fatta blocca',
  NOT public.claim_coupon('BENVENUTO-R12', 'e1240000-0000-0000-0000-000000000004'), '';

-- ⑤ l'ordine di Maria viene annullato: il codice torna a lei
INSERT INTO public.orders (
  id, user_id, seller_id, total_price, gross_total_cents, payment_method, payment_status,
  delivery_status, pickup_in_store, coupon_code,
  delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip
) VALUES (
  'e1240000-0000-0000-0000-0000000000a1', 'e1240000-0000-0000-0000-000000000002',
  'e1240000-0000-0000-0000-000000000001', 20, 2000, 'cod', 'PENDING', 'CANCELED', false, 'BENVENUTO-R12',
  'Maria Rossi', '3331234567', 'Via Verdi 10', 'Piacenza', '29121'
);
SELECT public.release_coupon('BENVENUTO-R12', 'e1240000-0000-0000-0000-0000000000a1');
INSERT INTO esiti SELECT '5 dopo l annullo il codice torna a Maria',
  public.claim_coupon('BENVENUTO-R12', 'e1240000-0000-0000-0000-000000000002'), '';

-- ⑥ un codice normale
INSERT INTO esiti SELECT '6 un codice normale si rivendica ancora',
  public.claim_coupon('ESTATE-R12', 'e1240000-0000-0000-0000-000000000002')
  AND public.claim_coupon('ESTATE-R12', 'e1240000-0000-0000-0000-000000000002'), '';
INSERT INTO esiti SELECT '6b e non lascia righe per cliente', count(*) = 0, count(*)::text
  FROM public.coupon_redemptions r JOIN public.coupons c ON c.id = r.coupon_id WHERE c.code = 'ESTATE-R12';

-- ⑦ porte chiuse
INSERT INTO esiti SELECT '7 i clienti non leggono le rivendicazioni',
  NOT has_table_privilege('authenticated', 'public.coupon_redemptions', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.coupon_redemptions', 'SELECT'), '';
INSERT INTO esiti SELECT '7b i clienti non chiamano la rivendicazione',
  NOT has_function_privilege('authenticated', 'public.claim_coupon(text, uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.claim_coupon(text, uuid)', 'EXECUTE'), '';

SELECT nome, CASE WHEN ok THEN 'ok' ELSE 'ROTTO' END AS esito, dettaglio FROM esiti ORDER BY nome;

DO $$
DECLARE rossi int; elenco text;
BEGIN
  SELECT count(*), coalesce(string_agg(format('%s → %s', e.nome, e.dettaglio), E'\n  '), '')
    INTO rossi, elenco FROM esiti e WHERE e.ok IS NOT TRUE;
  IF rossi > 0 THEN
    RAISE EXCEPTION E'% controllo/i rosso/i sul benvenuto:\n  %', rossi, elenco;
  END IF;
  RAISE NOTICE 'il benvenuto si rivendica una volta per cliente: % controlli verdi', (SELECT count(*) FROM esiti);
END $$;

ROLLBACK;

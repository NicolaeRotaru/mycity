-- =============================================================================
-- R12-004 — Il codice «solo primo ordine» si rivendica una volta per cliente
-- =============================================================================
--   tests/sql/harness/apply.sh mycity_test && tests/sql/harness/run.sh mycity_test
--
-- Due schede rivendicavano due volte il benvenuto. Il lucchetto (361) blocca
-- lo stesso cliente finché c'è una prova viva che sta usando il codice: una
-- rivendicazione di meno di 2 minuti, una cassa con la carta aperta, un ordine
-- valido col codice. Senza la 361 la funzione a due argomenti non esiste: ROSSO.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';
SET LOCAL mycity.allow_order_write   = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('e1240000-0000-0000-0000-000000000001', 'fornaio-r12c@test.it', '{"role":"seller"}'),
  ('e1240000-0000-0000-0000-000000000002', 'maria-r12c@test.it',   '{"role":"buyer"}'),
  ('e1240000-0000-0000-0000-000000000003', 'luca-r12c@test.it',    '{"role":"buyer"}'),
  ('e1240000-0000-0000-0000-000000000004', 'anna-r12c@test.it',    '{"role":"buyer"}'),
  ('e1240000-0000-0000-0000-000000000005', 'piero-r12c@test.it',   '{"role":"buyer"}');
UPDATE public.profiles SET is_approved = true, approval_status = 'approved', store_name = 'Pane R12c'
 WHERE id = 'e1240000-0000-0000-0000-000000000001';

INSERT INTO public.coupons (code, type, value, first_order_only, active) VALUES
  ('BENVENUTO-R12', 'FIXED', 5, true, true),
  ('ESTATE-R12', 'FIXED', 2, false, true);

-- Invecchia le rivendicazioni di un cliente: simula che siano passati più di 2 minuti.
CREATE FUNCTION pg_temp.invecchia(p uuid) RETURNS void LANGUAGE sql AS
  $$ UPDATE public.coupon_redemptions SET claimed_at = now() - interval '5 minutes' WHERE user_id = p $$;

-- ① ② ③ la gara delle due schede
INSERT INTO esiti SELECT '1 prima rivendicazione: si',
  public.claim_coupon('benvenuto-r12', 'e1240000-0000-0000-0000-000000000002'), '';
INSERT INTO esiti SELECT '2 la seconda scheda dello stesso cliente subito dopo: no',
  NOT public.claim_coupon('BENVENUTO-R12', 'e1240000-0000-0000-0000-000000000002'), '';
INSERT INTO esiti SELECT '3 un altro cliente: si',
  public.claim_coupon('BENVENUTO-R12', 'e1240000-0000-0000-0000-000000000003'), '';
INSERT INTO esiti SELECT '3b il contatore conta solo le rivendicazioni riuscite',
  uses_count = 2, uses_count::text FROM public.coupons WHERE code = 'BENVENUTO-R12';

-- ④ ⑤ ⑥ la cassa con la carta di Maria (scheda 1) è aperta: anche dopo 2 minuti la scheda 3 non passa
INSERT INTO public.pending_checkouts (id, buyer_id, total_cents, groups, coupon_code, delivery, status, expires_at)
VALUES ('e1240000-0000-0000-0000-0000000000f1', 'e1240000-0000-0000-0000-000000000002', 2000, '[]'::jsonb,
        'BENVENUTO-R12', '{}'::jsonb, 'PENDING', now() + interval '1 hour');
-- una cassa abbandonata di un ALTRO carrello di Maria, liberata (il caso delle tre schede del collaudo K03)
INSERT INTO public.pending_checkouts (id, buyer_id, total_cents, groups, coupon_code, delivery, status, expires_at)
VALUES ('e1240000-0000-0000-0000-0000000000f2', 'e1240000-0000-0000-0000-000000000002', 900, '[]'::jsonb,
        NULL, '{}'::jsonb, 'CANCELED', now() - interval '1 hour');
SELECT pg_temp.invecchia('e1240000-0000-0000-0000-000000000002');
INSERT INTO esiti SELECT '4 con la cassa della scheda 1 aperta la scheda 3 non passa (anche dopo 2 minuti)',
  NOT public.claim_coupon('BENVENUTO-R12', 'e1240000-0000-0000-0000-000000000002'), '';
UPDATE public.pending_checkouts SET status = 'CANCELED' WHERE id = 'e1240000-0000-0000-0000-0000000000f1';
SELECT public.release_coupon('BENVENUTO-R12');
INSERT INTO esiti SELECT '5 cassa annullata (Stripe rifiuta, articolo esaurito): dopo 2 minuti il benvenuto torna',
  public.claim_coupon('BENVENUTO-R12', 'e1240000-0000-0000-0000-000000000002'), '';
SELECT pg_temp.invecchia('e1240000-0000-0000-0000-000000000002');
INSERT INTO public.pending_checkouts (id, buyer_id, total_cents, groups, coupon_code, delivery, status, expires_at)
VALUES ('e1240000-0000-0000-0000-0000000000f3', 'e1240000-0000-0000-0000-000000000002', 2000, '[]'::jsonb,
        'BENVENUTO-R12', '{}'::jsonb, 'PENDING', now() - interval '1 minute');
SELECT public.release_coupon('BENVENUTO-R12');
INSERT INTO esiti SELECT '6 una cassa scaduta non blocca',
  public.claim_coupon('BENVENUTO-R12', 'e1240000-0000-0000-0000-000000000002'), '';

-- ⑦ ⑧ un ordine in contanti di Anna col codice
INSERT INTO esiti SELECT '7a Anna rivendica', public.claim_coupon('BENVENUTO-R12', 'e1240000-0000-0000-0000-000000000004'), '';
INSERT INTO public.orders (
  id, user_id, seller_id, total_price, gross_total_cents, payment_method, payment_status,
  delivery_status, pickup_in_store, coupon_code,
  delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip
) VALUES (
  'e1240000-0000-0000-0000-0000000000a1', 'e1240000-0000-0000-0000-000000000004',
  'e1240000-0000-0000-0000-000000000001', 20, 2000, 'cod', 'PENDING', 'NEW', false, 'BENVENUTO-R12',
  'Anna Bianchi', '3331234567', 'Via Verdi 10', 'Piacenza', '29121'
);
SELECT pg_temp.invecchia('e1240000-0000-0000-0000-000000000004');
INSERT INTO esiti SELECT '7b con un ordine valido col codice non passa (anche dopo 2 minuti)',
  NOT public.claim_coupon('BENVENUTO-R12', 'e1240000-0000-0000-0000-000000000004'), '';
UPDATE public.orders SET delivery_status = 'CANCELED' WHERE id = 'e1240000-0000-0000-0000-0000000000a1';
SELECT public.release_coupon('BENVENUTO-R12', 'e1240000-0000-0000-0000-0000000000a1');
INSERT INTO esiti SELECT '8 ordine annullato e codice restituito: il benvenuto torna subito',
  public.claim_coupon('BENVENUTO-R12', 'e1240000-0000-0000-0000-000000000004'), '';

-- ⑨ un codice normale
INSERT INTO esiti SELECT '9 un codice normale si rivendica ancora',
  public.claim_coupon('ESTATE-R12', 'e1240000-0000-0000-0000-000000000005')
  AND public.claim_coupon('ESTATE-R12', 'e1240000-0000-0000-0000-000000000005'), '';
INSERT INTO esiti SELECT '9b e non lascia righe per cliente', count(*) = 0, count(*)::text
  FROM public.coupon_redemptions r JOIN public.coupons c ON c.id = r.coupon_id WHERE c.code = 'ESTATE-R12';

-- ⑩ pulizia: le righe di più di un giorno spariscono alla prossima rivendicazione
INSERT INTO public.coupon_redemptions (coupon_id, user_id, claimed_at)
SELECT id, 'e1240000-0000-0000-0000-000000000005', now() - interval '3 days' FROM public.coupons WHERE code = 'BENVENUTO-R12';
SELECT public.claim_coupon('BENVENUTO-R12', 'e1240000-0000-0000-0000-000000000005');
INSERT INTO esiti SELECT '10 nessuna rivendicazione resta più di un giorno', count(*) = 0, count(*)::text
  FROM public.coupon_redemptions WHERE claimed_at < now() - interval '1 day';

-- ⑪ porte chiuse
INSERT INTO esiti SELECT '11 i clienti non leggono le rivendicazioni',
  NOT has_table_privilege('authenticated', 'public.coupon_redemptions', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.coupon_redemptions', 'SELECT'), '';
INSERT INTO esiti SELECT '11b i clienti non chiamano la rivendicazione',
  NOT has_function_privilege('authenticated', 'public.claim_coupon(text, uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.claim_coupon(text, uuid)', 'EXECUTE'), '';
INSERT INTO esiti SELECT '12 la rivendicazione blocca la riga del codice (le gare si mettono in fila)',
  pg_get_functiondef('public.claim_coupon(text, uuid)'::regprocedure) ~* 'from\s+public\.coupons[^;]*for\s+update', '';

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

-- =============================================================================
-- R18-019 · Il database non accetta un codice sconto del 150% né soldi negativi
-- =============================================================================
-- Gira contro un database ricostruito dalle migrazioni vere:
--   tests/sql/harness/apply.sh mycity_test
--   tests/sql/harness/run.sh   mycity_test
--
-- Il difetto: `coupons` aveva un controllo solo sul tipo (014:130). Un codice
-- PERCENT da 150, un FIXED a meno cinque euro, una spesa minima negativa, un
-- contatore degli usi negativo o oltre il massimo entravano senza un fiato.
-- Su `orders` shipping_cost, discount_amount, application_fee_cents e
-- cash_collected_cents potevano essere negativi e payment_method era testo
-- libero; su `disputes` refund_cents e su `gift_cards` voided_cents negativi.
--
-- Non cerca i nomi dei vincoli: prova a scrivere i numeri storti e pretende un
-- rifiuto, poi scrive quelli giusti e pretende che passino. Senza la 423 è rossa.
-- Tutto in transazione con ROLLBACK: non lascia dati.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';
SET LOCAL mycity.allow_order_write   = '1';

CREATE TEMP TABLE esiti (nome text, verde boolean, dettaglio text) ON COMMIT DROP;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('e1819000-0000-0000-0000-00000000000a', 'fornaio-r18c@test.it', '{"role":"seller"}'),
  ('e1819000-0000-0000-0000-00000000000b', 'cliente-r18c@test.it', '{"role":"buyer"}');

UPDATE public.profiles
   SET is_approved = true, approval_status = 'approved', store_name = 'Pane R18c'
 WHERE id = 'e1819000-0000-0000-0000-00000000000a';

-- Un ordine sano: appoggio per il reclamo.
INSERT INTO public.orders (
  id, user_id, seller_id, total_price, gross_total_cents,
  payment_method, payment_status, delivery_status,
  delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip
) VALUES (
  'e1819000-2222-0000-0000-00000000000d',
  'e1819000-0000-0000-0000-00000000000b',
  'e1819000-0000-0000-0000-00000000000a',
  20.00, 2000, 'card', 'PAID', 'DELIVERED',
  'Maria Rossi', '3331234567', 'Via Verdi 10', 'Piacenza', '29121'
);

INSERT INTO public.disputes (id, order_id, opener_id, reason, description)
VALUES ('e1819000-3333-0000-0000-00000000000e', 'e1819000-2222-0000-0000-00000000000d',
        'e1819000-0000-0000-0000-00000000000b', 'altro', 'Il pane era raffermo');

INSERT INTO public.gift_cards (code, amount_cents, balance_cents, buyer_id)
VALUES ('R18C-REGALO', 5000, 5000, 'e1819000-0000-0000-0000-00000000000b');

-- Aiuto: esegue un comando e dice se un paletto l'ha fermato.
CREATE OR REPLACE FUNCTION pg_temp.rifiutato(p_sql text) RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN false;
EXCEPTION WHEN check_violation THEN
  RETURN true;
END $$;

-- Un ordine nuovo con UNA colonna scelta, il resto sano (pagato con carta,
-- tranne quando la colonna scelta è proprio il metodo di pagamento).
CREATE OR REPLACE FUNCTION pg_temp.ordine_con(p_colonna text, p_valore text) RETURNS text
LANGUAGE sql AS $$
  SELECT format($f$
    INSERT INTO public.orders (
      user_id, seller_id, total_price, gross_total_cents, payment_status,
      delivery_status, delivery_full_name, delivery_phone, delivery_address, delivery_city,
      delivery_zip, %s
    ) VALUES (
      'e1819000-0000-0000-0000-00000000000b', 'e1819000-0000-0000-0000-00000000000a',
      10.00, 1000, 'PAID', 'NEW', 'Maria Rossi', '3331234567', 'Via Verdi 10',
      'Piacenza', '29121', %s
    )$f$,
    CASE WHEN p_colonna = 'payment_method' THEN quote_ident(p_colonna)
         ELSE 'payment_method, ' || quote_ident(p_colonna) END,
    CASE WHEN p_colonna = 'payment_method' THEN p_valore
         ELSE quote_literal('card') || ', ' || p_valore END)
$$;

-- ── Le scritture storte: il database le deve rifiutare ───────────────────
INSERT INTO esiti
SELECT nome, x.fermato,
       CASE WHEN x.fermato THEN 'rifiutato' ELSE 'PASSATO: il database l''ha scritto' END
FROM (VALUES
  ('01 codice PERCENT da 150 non entra',
   $q$INSERT INTO public.coupons (code, type, value) VALUES ('R18C-P150', 'PERCENT', 150)$q$),
  ('02 codice PERCENT da meno 5 non entra',
   $q$INSERT INTO public.coupons (code, type, value) VALUES ('R18C-PNEG', 'PERCENT', -5)$q$),
  ('03 codice FIXED da meno 5 euro non entra',
   $q$INSERT INTO public.coupons (code, type, value) VALUES ('R18C-FNEG', 'FIXED', -5)$q$),
  ('04 codice FIXED da zero euro non entra',
   $q$INSERT INTO public.coupons (code, type, value) VALUES ('R18C-FZERO', 'FIXED', 0)$q$),
  ('05 spesa minima negativa non entra',
   $q$INSERT INTO public.coupons (code, type, value, min_subtotal) VALUES ('R18C-MIN', 'FIXED', 5, -10)$q$),
  ('06 usi oltre il massimo non entrano',
   $q$INSERT INTO public.coupons (code, type, value, max_uses, uses_count) VALUES ('R18C-USI', 'FIXED', 5, 1, 7)$q$),
  ('07 usi negativi non entrano',
   $q$INSERT INTO public.coupons (code, type, value, uses_count) VALUES ('R18C-USINEG', 'FIXED', 5, -3)$q$),
  ('08 massimo usi negativo non entra',
   $q$INSERT INTO public.coupons (code, type, value, max_uses) VALUES ('R18C-MAXNEG', 'FIXED', 5, -1)$q$),
  ('09 ordine con spedizione negativa non entra',  pg_temp.ordine_con('shipping_cost', '-50')),
  ('10 ordine con sconto negativo non entra',      pg_temp.ordine_con('discount_amount', '-20')),
  ('11 ordine con commissione negativa non entra', pg_temp.ordine_con('application_fee_cents', '-500')),
  ('12 ordine con contanti incassati negativi non entra', pg_temp.ordine_con('cash_collected_cents', '-100')),
  ('13 ordine pagato in bitcoin non entra',        pg_temp.ordine_con('payment_method', $v$'bitcoin'$v$)),
  ('14 reclamo con rimborso negativo non si scrive',
   $q$UPDATE public.disputes SET refund_cents = -300 WHERE id = 'e1819000-3333-0000-0000-00000000000e'$q$),
  ('15 buono regalo con annullato negativo non si scrive',
   $q$UPDATE public.gift_cards SET voided_cents = -100 WHERE code = 'R18C-REGALO'$q$)
) AS v(nome, cmd)
CROSS JOIN LATERAL (SELECT pg_temp.rifiutato(v.cmd) AS fermato) x;

-- ── Le scritture oneste: devono passare ──────────────────────────────────
INSERT INTO esiti
SELECT nome, NOT x.fermato,
       CASE WHEN x.fermato THEN 'RIFIUTATO: il paletto è stretto troppo' ELSE 'passa' END
FROM (VALUES
  ('21 codice PERCENT da 100 entra',
   $q$INSERT INTO public.coupons (code, type, value) VALUES ('R18C-P100', 'PERCENT', 100)$q$),
  ('22 codice PERCENT da 15 entra',
   $q$INSERT INTO public.coupons (code, type, value, min_subtotal) VALUES ('R18C-P15', 'PERCENT', 15, 0)$q$),
  ('23 codice FIXED da 150 euro entra (è un importo, non una percentuale)',
   $q$INSERT INTO public.coupons (code, type, value) VALUES ('R18C-F150', 'FIXED', 150)$q$),
  ('24 spedizione gratuita a valore zero entra',
   $q$INSERT INTO public.coupons (code, type, value) VALUES ('R18C-SPED', 'FREE_SHIPPING', 0)$q$),
  ('25 usi pari al massimo entrano',
   $q$INSERT INTO public.coupons (code, type, value, max_uses, uses_count) VALUES ('R18C-PIENO', 'FIXED', 5, 3, 3)$q$),
  ('26 ordine in contanti con spedizione e sconto entra',
   $q$INSERT INTO public.orders (user_id, seller_id, total_price, gross_total_cents, payment_method,
        payment_status, delivery_status, delivery_full_name, delivery_phone, delivery_address,
        delivery_city, delivery_zip, shipping_cost, discount_amount, application_fee_cents, cash_collected_cents)
      VALUES ('e1819000-0000-0000-0000-00000000000b', 'e1819000-0000-0000-0000-00000000000a',
        10.00, 1000, 'cod', 'PENDING', 'NEW', 'Maria Rossi', '3331234567', 'Via Verdi 10',
        'Piacenza', '29121', 3.50, 2.00, 120, 1000)$q$),
  ('27 ordine vecchio senza metodo di pagamento entra',  pg_temp.ordine_con('payment_method', 'NULL')),
  ('28 reclamo con rimborso vero si scrive',
   $q$UPDATE public.disputes SET refund_cents = 300 WHERE id = 'e1819000-3333-0000-0000-00000000000e'$q$),
  ('29 buono regalo con annullato vero si scrive',
   $q$UPDATE public.gift_cards SET voided_cents = 500 WHERE code = 'R18C-REGALO'$q$)
) AS v(nome, cmd)
CROSS JOIN LATERAL (SELECT pg_temp.rifiutato(v.cmd) AS fermato) x;

-- ── Il contatore degli usi non sfonda il massimo ma torna giù ────────────
INSERT INTO public.coupons (code, type, value, max_uses, uses_count, active)
VALUES ('R18C-UNO', 'FIXED', 5, 1, 0, true);
DO $$
DECLARE primo boolean; secondo boolean; dopo int;
BEGIN
  primo   := public.claim_coupon('R18C-UNO');
  secondo := public.claim_coupon('R18C-UNO');
  PERFORM public.release_coupon('R18C-UNO');
  PERFORM public.release_coupon('R18C-UNO');
  SELECT uses_count INTO dopo FROM public.coupons WHERE code = 'R18C-UNO';
  INSERT INTO esiti VALUES ('30 claim e release lavorano dentro i paletti',
    primo AND NOT secondo AND dopo = 0,
    format('primo %s, secondo %s, usi dopo due release %s (atteso true, false, 0)', primo, secondo, dopo));
END $$;

-- ── Verdetto ──────────────────────────────────────────────────────────────
DO $$
DECLARE rossi int; elenco text;
BEGIN
  SELECT count(*), coalesce(string_agg(format('%s → %s', e.nome, e.dettaglio), E'\n  ' ORDER BY e.nome), '')
    INTO rossi, elenco
  FROM esiti e WHERE e.verde IS NOT TRUE;
  IF rossi > 0 THEN
    RAISE EXCEPTION E'R18-019: % controllo/i rosso/i sui paletti di sconti e soldi:\n  %', rossi, elenco;
  END IF;
  RAISE INFO 'R18-019: sconti e soldi hanno i loro paletti (% controlli verdi)', (SELECT count(*) FROM esiti);
END $$;

ROLLBACK;

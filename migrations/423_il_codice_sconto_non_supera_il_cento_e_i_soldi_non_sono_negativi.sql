-- Il database accettava un codice sconto del 150% e importi in soldi negativi.
--
-- IL DIFETTO (R18-019). La tabella `coupons` nasce nella 014 (riga 130) con un solo controllo, sul
-- tipo: sul valore niente. Un codice PERCENT con valore 150 entrava, e cosi' un FIXED a meno cinque
-- euro, una spesa minima negativa, un contatore degli usi negativo o oltre il massimo. Esempio:
-- l'amministratore scrive «150» invece di «15»; un cliente con 20 euro di spesa si vede uno sconto di
-- 30 euro e paga un centesimo (la cassa taglia lo sconto a «carrello meno un centesimo»,
-- lib/coupons.ts:137-138 e lib/stripe/ripartizione.ts).
-- Su `orders` i paletti della 146 e della 215 non coprivano shipping_cost, discount_amount,
-- application_fee_cents e cash_collected_cents, e payment_method era testo libero (il calcolo dei
-- bonifici tratta come contanti tutto quello che non e' 'card'). Su `disputes` mancava il paletto
-- su refund_cents, su `gift_cards` su voided_cents.
--
-- LA CURA. I paletti mancanti, uno per regola, con lo stesso giro della 215: si aggiungono
-- NOT VALID (valgono subito per ogni riga nuova o cambiata) e poi si prova a validare il passato.
-- Se in produzione ci sono righe vecchie storte, il vincolo resta NOT VALID con un avviso nei log
-- invece di fermare il rilascio: quelle righe vanno guardate una per una, sono soldi. Le domande
-- per contarle sono in fondo.
--
-- I valori ammessi sono quelli che il sito scrive davvero: percentuale fra 0 e 100, sconto fisso
-- maggiore di zero, spedizione gratuita mai negativa; payment_method 'card' (lib/stripe/webhook/
-- ordini.ts) o 'cod' (app/api/orders/cod/route.ts), oppure vuoto come sugli ordini vecchi.
-- claim_coupon conta gia' gli usi solo sotto il massimo e release_coupon non scende sotto zero:
-- il paletto sugli usi non ferma il lavoro onesto.
--
-- REVERSIBILE: `ALTER TABLE public.<tabella> DROP CONSTRAINT <vincolo>;` per ognuno dei dieci.
--
-- LA PROVA: tests/sql/rls/riparazione-r18-coupon.test.sql. Non cerca i nomi dei vincoli: prova a
-- scrivere i numeri storti e pretende un rifiuto, poi scrive quelli giusti e pretende che passino.

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('coupons',    'coupons_valore_sensato',
         'value >= 0 AND (type <> ''PERCENT'' OR value <= 100) AND (type <> ''FIXED'' OR value > 0)'),
      ('coupons',    'coupons_spesa_minima_non_negativa',
         'min_subtotal IS NULL OR min_subtotal >= 0'),
      ('coupons',    'coupons_usi_sensati',
         '(uses_count IS NULL OR uses_count >= 0) AND (max_uses IS NULL OR max_uses >= 0)'
         ' AND (uses_count IS NULL OR max_uses IS NULL OR uses_count <= max_uses)'),
      ('orders',     'orders_spedizione_non_negativa',
         'shipping_cost IS NULL OR shipping_cost >= 0'),
      ('orders',     'orders_sconto_non_negativo',
         'discount_amount IS NULL OR discount_amount >= 0'),
      ('orders',     'orders_commissione_non_negativa',
         'application_fee_cents IS NULL OR application_fee_cents >= 0'),
      ('orders',     'orders_contanti_incassati_non_negativi',
         'cash_collected_cents IS NULL OR cash_collected_cents >= 0'),
      ('orders',     'orders_metodo_di_pagamento_noto',
         'payment_method IS NULL OR payment_method IN (''card'', ''cod'')'),
      ('disputes',   'disputes_rimborso_non_negativo',
         'refund_cents IS NULL OR refund_cents >= 0'),
      ('gift_cards', 'gift_cards_annullato_non_negativo',
         'voided_cents IS NULL OR voided_cents >= 0')
    ) AS v(tabella, vincolo, regola)
  LOOP
    IF to_regclass('public.' || r.tabella) IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = r.vincolo
                        AND conrelid = ('public.' || r.tabella)::regclass) THEN
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (%s) NOT VALID', r.tabella, r.vincolo, r.regola);
      BEGIN
        EXECUTE format('ALTER TABLE public.%I VALIDATE CONSTRAINT %I', r.tabella, r.vincolo);
      EXCEPTION WHEN check_violation THEN
        RAISE WARNING '423: % su % resta NOT VALID: ci sono righe vecchie da guardare (regola: %)',
          r.vincolo, r.tabella, r.regola;
      END;
    END IF;
  END LOOP;
END $$;

-- Se un avviso «resta NOT VALID» compare nei log, queste contano le righe da guardare:
--   SELECT code, type, value, min_subtotal, uses_count, max_uses FROM public.coupons
--    WHERE value < 0 OR (type = 'PERCENT' AND value > 100) OR (type = 'FIXED' AND value <= 0)
--       OR min_subtotal < 0 OR uses_count < 0 OR max_uses < 0 OR uses_count > max_uses;
--   SELECT count(*) FROM public.orders
--    WHERE shipping_cost < 0 OR discount_amount < 0 OR application_fee_cents < 0
--       OR cash_collected_cents < 0 OR payment_method NOT IN ('card', 'cod');
--   SELECT count(*) FROM public.disputes WHERE refund_cents < 0;
--   SELECT count(*) FROM public.gift_cards WHERE voided_cents < 0;
-- Dopo averle sistemate: ALTER TABLE public.<tabella> VALIDATE CONSTRAINT <vincolo>;

NOTIFY pgrst, 'reload schema';

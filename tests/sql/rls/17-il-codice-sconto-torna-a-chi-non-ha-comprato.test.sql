-- =============================================================================
-- 22/8/2026 — IL CODICE A USO UNICO SI BRUCIAVA ANCHE SENZA ORDINE.
-- =============================================================================
-- Il coupon si rivendica al checkout, prima di creare l'ordine: giusto, senza
-- quella rivendicazione due persone userebbero lo stesso codice nello stesso
-- istante. Ma quando l'ordine POI non si faceva — il cliente annulla, il
-- negozio rifiuta — il contatore non tornava indietro.
--
-- Per chi ha ricevuto un buono «una volta sola» questo vuol dire che il buono
-- è finito senza aver comprato niente, e che se ne accorge premendo «Applica»
-- e leggendo «codice già usato».
--
-- Togli le due chiamate a release_coupon e questa prova torna rossa.
--
-- 27/8/2026 (R121) — QUESTA PROVA COPRE UNA STRADA CHE IL CLIENTE NON FA PIU'.
-- Qui si esercitano le funzioni `cancel_order` / `seller_reject_order` del
-- database. Ma dal 21/8 il pulsante «Annulla ordine» del cliente non passa piu'
-- di li': passa da /api/orders/[id]/cancel, cioe' da `annullaERimborsa` in
-- lib/ordini/annulla.ts — e li' il codice sconto non veniva nemmeno letto.
-- Questa prova restava verde su un percorso morto mentre il difetto era vivo
-- sul percorso vero. Il rifiuto del negozio passa ancora da `seller_reject_order`,
-- quindi la prova serve ancora: resta com'e'. La strada del cliente e quella
-- dell'amministrazione sono coperte da
-- tests/unit/il-codice-sconto-torna-a-chi-annulla.test.ts, che esercita
-- `annullaERimborsa` e diventa rosso se `release_coupon` non viene chiamata.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';
SET LOCAL mycity.allow_order_write   = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('11111111-1111-1111-1111-111111111111', 'negozio@test.it', '{"role":"seller"}'),
  ('33333333-3333-3333-3333-333333333333', 'cliente@test.it', '{"role":"buyer"}');

UPDATE public.profiles SET is_approved = true, approval_status = 'approved', store_name = 'Bottega'
 WHERE id = '11111111-1111-1111-1111-111111111111';

-- Un codice a uso unico, già rivendicato una volta dal checkout.
INSERT INTO public.coupons (code, type, value, max_uses, uses_count, active)
VALUES ('UNAVOLTA', 'FIXED', 5, 1, 1, true);

INSERT INTO public.orders (
  id, user_id, seller_id, total_price, payment_status, delivery_status, coupon_code,
  delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip
) VALUES (
  'a0000000-0000-0000-0000-00000000000a',
  '33333333-3333-3333-3333-333333333333',
  '11111111-1111-1111-1111-111111111111',
  20.00, 'PENDING', 'NEW', 'UNAVOLTA',
  'Maria Rossi', '3331234567', 'Via Verdi 10', 'Piacenza', '29121'
);

-- ── ① Il cliente annulla: il codice deve tornare ─────────────────────────
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';

DO $$
DECLARE esito jsonb;
BEGIN
  esito := public.cancel_order('a0000000-0000-0000-0000-00000000000a');
  CREATE TEMP TABLE esito_annullo AS SELECT esito AS valore;
END $$;

-- Il contatore si legge SENZA il ruolo ristretto: come `authenticated` le
-- regole per riga nascondono la riga dei coupon, e la lettura tornava NULL —
-- che il verdetto scambiava per «a posto».
RESET ROLE;

DO $$
DECLARE esito jsonb; usi int;
BEGIN
  SELECT valore INTO esito FROM esito_annullo;
  SELECT uses_count INTO usi FROM public.coupons WHERE code = 'UNAVOLTA';

  INSERT INTO esiti VALUES (
    'annullando l''ordine il codice a uso unico torna disponibile',
    (esito->>'ok')::boolean AND usi = 0,
    format('esito=%s usi_rimasti=%s (atteso 0)', esito->>'ok', usi)
  );
END $$;
SET LOCAL mycity.allow_order_write = '1';

-- ── ② Il negozio rifiuta: stessa cosa ───────────────────────────────────
UPDATE public.coupons SET uses_count = 1 WHERE code = 'UNAVOLTA';
INSERT INTO public.orders (
  id, user_id, seller_id, total_price, payment_status, delivery_status, coupon_code,
  delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip
) VALUES (
  'b0000000-0000-0000-0000-00000000000b',
  '33333333-3333-3333-3333-333333333333',
  '11111111-1111-1111-1111-111111111111',
  20.00, 'PENDING', 'NEW', 'UNAVOLTA',
  'Maria Rossi', '3331234567', 'Via Verdi 10', 'Piacenza', '29121'
);

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

DO $$
DECLARE esito jsonb;
BEGIN
  esito := public.seller_reject_order('b0000000-0000-0000-0000-00000000000b', 'finito');
  CREATE TEMP TABLE esito_rifiuto AS SELECT esito AS valore;
END $$;

RESET ROLE;

DO $$
DECLARE esito jsonb; usi int;
BEGIN
  SELECT valore INTO esito FROM esito_rifiuto;
  SELECT uses_count INTO usi FROM public.coupons WHERE code = 'UNAVOLTA';

  INSERT INTO esiti VALUES (
    'col rifiuto del negozio il codice torna disponibile',
    (esito->>'ok')::boolean AND usi = 0,
    format('esito=%s usi_rimasti=%s (atteso 0)', esito->>'ok', usi)
  );
END $$;

-- ── ③ Il contatore non va sotto zero ────────────────────────────────────
DO $$
DECLARE usi int;
BEGIN
  PERFORM public.release_coupon('UNAVOLTA');
  PERFORM public.release_coupon('UNAVOLTA');
  SELECT uses_count INTO usi FROM public.coupons WHERE code = 'UNAVOLTA';

  INSERT INTO esiti VALUES (
    'restituire due volte non manda il contatore in negativo',
    usi = 0,
    format('usi=%s (atteso 0)', usi)
  );
END $$;

-- ── Verdetto ────────────────────────────────────────────────────────────
DO $$
DECLARE rossi int; elenco text;
BEGIN
  SELECT count(*), coalesce(string_agg(format('%s → %s', e.nome, e.dettaglio), E'\n  '), '')
    INTO rossi, elenco
  -- 22/8/2026 — `WHERE e.ok IS NOT TRUE` lasciava passare i NULL: `NOT NULL` è NULL,
  -- che non è vero, quindi la riga non veniva contata fra le rosse. Un
  -- controllo che non ha potuto misurare usciva verde. `IS NOT TRUE` prende
  -- sia il falso sia il non misurato — ed è così che deve essere.
  FROM esiti e WHERE e.ok IS NOT TRUE;

  -- E un file che non ha misurato NIENTE non è un file verde.
  IF (SELECT count(*) FROM esiti) = 0 THEN
    RAISE EXCEPTION 'nessun controllo eseguito: il file gira a vuoto';
  END IF;

  IF rossi > 0 THEN
    RAISE EXCEPTION E'% controllo/i rosso/i:\n  %', rossi, elenco;
  END IF;
  RAISE NOTICE 'il codice sconto torna a chi non ha comprato: % controlli verdi', (SELECT count(*) FROM esiti);
END $$;

ROLLBACK;

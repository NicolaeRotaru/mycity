-- 178 — IL BUONO REGALO SEGUE IL SUO PAGAMENTO.
--
-- Un buono regalo nasce da un pagamento con carta (webhook Stripe,
-- lib/stripe/webhook/giftcard.ts). Quando quel pagamento torna indietro — un
-- rimborso, o una contestazione aperta in banca — il buono deve spegnersi con
-- lui: i soldi che lo reggevano non ci sono piu'.
--
-- COSA FA QUESTA MIGRAZIONE
--  ① `gift_cards` impara a dire che e' stato annullato: quando (`voided_at`),
--     perche' (`void_reason`: 'refunded' o 'disputed') e quanto si e' tolto
--     (`voided_cents`). Un vincolo lega le due cose: un buono annullato ha
--     saldo zero, sempre.
--  ② `gift_cards.stripe_payment_intent`: il rimborso e la contestazione
--     arrivano col pagamento (payment_intent), non con la sessione. La colonna
--     e' vuota sui buoni gia' nati; la scrive il webhook d'ora in poi.
--  ③ `gift_card_void_for_payment(sessione, pagamento, motivo)`: la sola strada
--     per annullare. La chiama il server (service_role), mai il browser.
--       - buono ancora da riscattare → saldo a zero, annotato su `voided_cents`;
--       - buono gia' riscattato → il credito che ha generato si riprende dal
--         portafoglio di chi l'ha riscattato, fino a quanto ce n'e', con una
--         riga a diario `wallet_ledger` (motivo 'gift_card_void', chiave = codice).
--         Quello che era gia' stato speso non si recupera: la funzione lo
--         restituisce in `non_recuperati_cents`, cosi' la cassa lo vede.
--     Due chiamate per lo stesso buono (Stripe riconsegna l'evento) fanno il
--     lavoro una volta sola: la riga del buono e' bloccata FOR UPDATE, la
--     seconda trova `voided_at` gia' scritto; e il diario del portafoglio ha la
--     sua chiave unica (143) su motivo+codice.
--     Se il buono non c'e' ancora risponde 'non_trovato': chi chiama deve
--     trattarlo come «da rifare», non come «fatto».
--  ⑤ Il pagamento puo' tornare indietro PRIMA che il buono nasca: Stripe non
--     garantisce l'ordine degli eventi, e la nascita puo' arrivare in ritardo
--     (un tentativo caduto che Stripe ripete ore dopo). Allora l'annullo non
--     trova il buono: lo annota in `gift_card_pending_voids`, e il buono che
--     nasce con quel pagamento nasce gia' spento (trigger BEFORE INSERT).
--     Annullo e nascita prendono la stessa serratura (advisory lock sul
--     pagamento): se corrono insieme, il secondo aspetta e vede il primo.
--  ④ `redeem_gift_card` rifiuta un buono annullato. Lo stesso FOR UPDATE mette
--     in fila riscatto e annullo: se il riscatto passa prima, l'annullo
--     riprende il credito; se passa dopo, trova il buono spento.
--
-- REVERSIBILE. `DROP FUNCTION public.gift_card_void_for_payment(text, text, text);`
-- `DROP TRIGGER gift_cards_apply_pending_void ON public.gift_cards;`
-- `DROP FUNCTION public.gift_card_apply_pending_void(); DROP TABLE public.gift_card_pending_voids;`
-- `redeem_gift_card` si ricrea col testo della 087; le colonne nuove, vuote,
-- non disturbano nessuno.
--
-- LA PROVA: tests/unit/il-buono-regalo-segue-il-suo-pagamento.test.ts, su un
-- PostgreSQL vero usa e getta.
--
-- Idempotente.

-- =========================================================
-- ① ② LE COLONNE
-- =========================================================
ALTER TABLE public.gift_cards ADD COLUMN IF NOT EXISTS stripe_payment_intent text;
ALTER TABLE public.gift_cards ADD COLUMN IF NOT EXISTS voided_at timestamptz;
ALTER TABLE public.gift_cards ADD COLUMN IF NOT EXISTS void_reason text;
ALTER TABLE public.gift_cards ADD COLUMN IF NOT EXISTS voided_cents int;

CREATE UNIQUE INDEX IF NOT EXISTS gift_cards_stripe_payment_intent_idx
  ON public.gift_cards (stripe_payment_intent)
  WHERE stripe_payment_intent IS NOT NULL;

ALTER TABLE public.gift_cards DROP CONSTRAINT IF EXISTS gift_cards_void_reason_check;
ALTER TABLE public.gift_cards
  ADD CONSTRAINT gift_cards_void_reason_check
  CHECK (void_reason IS NULL OR void_reason IN ('refunded', 'disputed'));

ALTER TABLE public.gift_cards DROP CONSTRAINT IF EXISTS gift_cards_voided_without_balance;
ALTER TABLE public.gift_cards
  ADD CONSTRAINT gift_cards_voided_without_balance
  CHECK (voided_at IS NULL OR (balance_cents = 0 AND void_reason IS NOT NULL));

COMMENT ON COLUMN public.gift_cards.voided_at IS
  'Quando il pagamento che ha comprato il buono e'' tornato indietro (178). Annullato = saldo zero.';
COMMENT ON COLUMN public.gift_cards.voided_cents IS
  'Quanto si e'' tolto all''annullo: saldo del buono + credito ripreso dal portafoglio (178).';

-- =========================================================
-- ⑤ IL PAGAMENTO TORNATO INDIETRO PRIMA DEL BUONO
-- =========================================================
CREATE TABLE IF NOT EXISTS public.gift_card_pending_voids (
  stripe_payment_intent text PRIMARY KEY,
  void_reason text NOT NULL CHECK (void_reason IN ('refunded', 'disputed')),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.gift_card_pending_voids ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.gift_card_pending_voids FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.gift_card_pending_voids IS
  'Pagamenti tornati indietro quando il loro buono regalo non era ancora nato (178): il buono nasce spento.';

-- =========================================================
-- ③ L'ANNULLO
-- =========================================================
CREATE OR REPLACE FUNCTION public.gift_card_void_for_payment(p_session_id text, p_payment_intent text, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  g record;
  v_dal_saldo int;
  v_dal_credito int := 0;
BEGIN
  IF p_reason IS NULL OR p_reason NOT IN ('refunded', 'disputed') THEN
    RAISE EXCEPTION 'gift_card_void_for_payment: motivo % non previsto', p_reason;
  END IF;
  IF coalesce(p_session_id, '') = '' AND coalesce(p_payment_intent, '') = '' THEN
    RAISE EXCEPTION 'gift_card_void_for_payment: serve la sessione o il pagamento';
  END IF;

  -- ⑤ La stessa serratura della nascita del buono: i due non si incrociano.
  IF coalesce(p_payment_intent, '') <> '' THEN
    PERFORM pg_advisory_xact_lock(hashtext('gift_card_payment:' || p_payment_intent));
  END IF;

  SELECT code, amount_cents, balance_cents, redeemed_by, voided_at, voided_cents
    INTO g
    FROM public.gift_cards
   WHERE (coalesce(p_session_id, '') <> '' AND stripe_session_id = p_session_id)
      OR (coalesce(p_payment_intent, '') <> '' AND stripe_payment_intent = p_payment_intent)
   ORDER BY created_at, code
   LIMIT 1
   FOR UPDATE;

  IF NOT FOUND THEN
    -- ⑤ Il buono non e' ancora nato: lo si annota, e nascera' spento.
    IF coalesce(p_payment_intent, '') <> '' THEN
      INSERT INTO public.gift_card_pending_voids (stripe_payment_intent, void_reason)
      VALUES (p_payment_intent, p_reason)
      ON CONFLICT (stripe_payment_intent) DO NOTHING;
      RETURN jsonb_build_object('esito', 'non_trovato', 'in_attesa', true);
    END IF;
    RETURN jsonb_build_object('esito', 'non_trovato');
  END IF;
  IF g.voided_at IS NOT NULL THEN
    RETURN jsonb_build_object('esito', 'gia_annullato', 'code', g.code, 'voided_cents', g.voided_cents);
  END IF;

  v_dal_saldo := g.balance_cents;
  IF g.redeemed_by IS NOT NULL AND g.amount_cents > g.balance_cents THEN
    v_dal_credito := public.wallet_debit(g.redeemed_by, g.amount_cents - g.balance_cents, 'gift_card_void', g.code);
  END IF;

  UPDATE public.gift_cards
     SET balance_cents = 0,
         voided_at = now(),
         void_reason = p_reason,
         voided_cents = v_dal_saldo + v_dal_credito
   WHERE code = g.code;

  RETURN jsonb_build_object(
    'esito', 'annullato',
    'code', g.code,
    'dal_saldo_cents', v_dal_saldo,
    'dal_credito_cents', v_dal_credito,
    'non_recuperati_cents', g.amount_cents - v_dal_saldo - v_dal_credito
  );
END; $$;

COMMENT ON FUNCTION public.gift_card_void_for_payment(text, text, text) IS
  'Annulla il buono regalo il cui pagamento e'' stato rimborsato o contestato (178). Solo server.';

REVOKE ALL ON FUNCTION public.gift_card_void_for_payment(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gift_card_void_for_payment(text, text, text) TO service_role;

-- ⑤ Il buono che nasce con un pagamento gia' tornato indietro nasce spento.
CREATE OR REPLACE FUNCTION public.gift_card_apply_pending_void()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_reason text;
BEGIN
  IF coalesce(NEW.stripe_payment_intent, '') = '' THEN
    RETURN NEW;
  END IF;
  -- Prima la serratura, poi la lettura: se l'annullo corre in parallelo, qui
  -- si aspetta che finisca e la lettura (nuova istantanea) lo vede.
  PERFORM pg_advisory_xact_lock(hashtext('gift_card_payment:' || NEW.stripe_payment_intent));
  SELECT void_reason INTO v_reason
    FROM public.gift_card_pending_voids
   WHERE stripe_payment_intent = NEW.stripe_payment_intent;
  IF FOUND THEN
    NEW.voided_cents := NEW.balance_cents;
    NEW.balance_cents := 0;
    NEW.voided_at := now();
    NEW.void_reason := v_reason;
  END IF;
  RETURN NEW;
END; $$;

REVOKE ALL ON FUNCTION public.gift_card_apply_pending_void() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS gift_cards_apply_pending_void ON public.gift_cards;
CREATE TRIGGER gift_cards_apply_pending_void
  BEFORE INSERT ON public.gift_cards
  FOR EACH ROW EXECUTE FUNCTION public.gift_card_apply_pending_void();

-- =========================================================
-- ④ IL RISCATTO
-- =========================================================
-- Il testo e' quello della 087, con una riga in piu': il buono annullato si ferma.
CREATE OR REPLACE FUNCTION public.redeem_gift_card(p_code text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid; v_code text; v_credit int; v_expires timestamptz; v_voided timestamptz;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Devi accedere per riscattare una gift card'; END IF;
  v_code := upper(btrim(p_code));

  -- Blocca la riga: riscatti concorrenti, e il riscatto contro l'annullo, si serializzano qui.
  SELECT balance_cents, expires_at, voided_at INTO v_credit, v_expires, v_voided
    FROM public.gift_cards WHERE code = v_code FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Codice gift card non valido'; END IF;
  IF v_voided IS NOT NULL THEN RAISE EXCEPTION 'Gift card non più valida'; END IF;
  IF v_expires <= now() THEN RAISE EXCEPTION 'Gift card scaduta'; END IF;
  IF v_credit <= 0 THEN RAISE EXCEPTION 'Gift card già utilizzata'; END IF;

  UPDATE public.gift_cards
    SET balance_cents = 0, redeemed_by = v_uid, redeemed_at = now()
    WHERE code = v_code;

  PERFORM public.wallet_credit(v_uid, v_credit, 'gift_card_redeem', v_code);
  RETURN jsonb_build_object('credited_cents', v_credit);
END; $$;

NOTIFY pgrst, 'reload schema';

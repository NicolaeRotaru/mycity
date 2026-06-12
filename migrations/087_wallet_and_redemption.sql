-- 087_wallet_and_redemption.sql
--
-- CREDITO SPENDIBILE (wallet) + riscatto gift card + conversione punti fedeltà.
--
-- Contesto: gift card e punti fedeltà promettevano valore ("€5 spendibili",
-- "buono spesa") ma NON esisteva alcun modo di spenderli davvero. Qui si crea un
-- vero "credito MyCity" per-utente (centesimi), alimentato da:
--   - riscatto di una gift card pagata (redeem_gift_card)
--   - conversione di punti fedeltà (convert_loyalty_to_credit, 100 pt = €5)
-- e speso atomicamente al checkout (wallet_debit), con storno (wallet_credit)
-- in caso di ordine fallito. Tutte le scritture passano da funzioni SECURITY
-- DEFINER: il client non può MAI accreditarsi credito da solo.
--
-- Idempotente.

-- =============================================================================
-- 1. Saldo credito sul profilo + ledger di audit
-- =============================================================================
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS wallet_balance_cents int NOT NULL DEFAULT 0;

DO $$ BEGIN
  ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_wallet_non_negative CHECK (wallet_balance_cents >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.wallet_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  delta_cents int NOT NULL,          -- positivo = accredito, negativo = spesa
  reason text NOT NULL,              -- gift_card_redeem | loyalty_convert | order_cod | order_cod_refund
  ref text,                          -- codice gift card / order id / nota
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wallet_ledger_user_idx ON public.wallet_ledger(user_id, created_at DESC);

ALTER TABLE public.wallet_ledger ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wallet_ledger_owner_read ON public.wallet_ledger;
CREATE POLICY wallet_ledger_owner_read ON public.wallet_ledger
  FOR SELECT USING (auth.uid() = user_id);
-- Nessuna policy di scrittura: il ledger si scrive solo via RPC SECURITY DEFINER.

-- Quanto credito è stato usato su un ordine (per ricevute / storni).
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS wallet_applied_cents int NOT NULL DEFAULT 0;

-- =============================================================================
-- 2. Primitive interne (mai esposte al client): applica delta + scrive ledger
-- =============================================================================
CREATE OR REPLACE FUNCTION public._wallet_apply(p_user uuid, p_delta int, p_reason text, p_ref text)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_new int;
BEGIN
  UPDATE public.profiles
    SET wallet_balance_cents = wallet_balance_cents + p_delta
    WHERE id = p_user
    RETURNING wallet_balance_cents INTO v_new;  -- il CHECK >= 0 impedisce saldi negativi
  IF NOT FOUND THEN RAISE EXCEPTION 'Utente inesistente'; END IF;
  INSERT INTO public.wallet_ledger (user_id, delta_cents, reason, ref)
    VALUES (p_user, p_delta, p_reason, p_ref);
  RETURN v_new;
END; $$;

-- Spesa atomica: addebita fino a p_max_cents, restituisce quanto effettivamente
-- applicato. Il FOR UPDATE serializza spese concorrenti (no doppia spesa).
CREATE OR REPLACE FUNCTION public.wallet_debit(p_user uuid, p_max_cents int, p_reason text, p_ref text)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_bal int; v_applied int;
BEGIN
  IF p_max_cents IS NULL OR p_max_cents <= 0 THEN RETURN 0; END IF;
  SELECT wallet_balance_cents INTO v_bal FROM public.profiles WHERE id = p_user FOR UPDATE;
  IF v_bal IS NULL THEN RETURN 0; END IF;
  v_applied := LEAST(v_bal, p_max_cents);
  IF v_applied <= 0 THEN RETURN 0; END IF;
  PERFORM public._wallet_apply(p_user, -v_applied, p_reason, p_ref);
  RETURN v_applied;
END; $$;

CREATE OR REPLACE FUNCTION public.wallet_credit(p_user uuid, p_cents int, p_reason text, p_ref text)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_cents IS NULL OR p_cents <= 0 THEN RETURN 0; END IF;
  RETURN public._wallet_apply(p_user, p_cents, p_reason, p_ref);
END; $$;

-- =============================================================================
-- 3. Riscatto gift card → credito (chiamabile dall'utente destinatario)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.redeem_gift_card(p_code text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid; v_code text; v_credit int; v_expires timestamptz;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Devi accedere per riscattare una gift card'; END IF;
  v_code := upper(btrim(p_code));

  -- Blocca la riga: due riscatti concorrenti si serializzano qui.
  SELECT balance_cents, expires_at INTO v_credit, v_expires
    FROM public.gift_cards WHERE code = v_code FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Codice gift card non valido'; END IF;
  IF v_expires <= now() THEN RAISE EXCEPTION 'Gift card scaduta'; END IF;
  IF v_credit <= 0 THEN RAISE EXCEPTION 'Gift card già utilizzata'; END IF;

  UPDATE public.gift_cards
    SET balance_cents = 0, redeemed_by = v_uid, redeemed_at = now()
    WHERE code = v_code;

  PERFORM public.wallet_credit(v_uid, v_credit, 'gift_card_redeem', v_code);
  RETURN jsonb_build_object('credited_cents', v_credit);
END; $$;

-- =============================================================================
-- 4. Conversione punti fedeltà → credito (100 pt = €5)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.convert_loyalty_to_credit(p_points int)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid; v_bal int; v_cents int;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Devi accedere'; END IF;
  IF p_points IS NULL OR p_points < 100 OR (p_points % 100) <> 0 THEN
    RAISE EXCEPTION 'I punti si convertono a blocchi di 100 (100 punti = €5)';
  END IF;

  SELECT points_balance INTO v_bal FROM public.loyalty_accounts WHERE user_id = v_uid FOR UPDATE;
  IF v_bal IS NULL OR v_bal < p_points THEN RAISE EXCEPTION 'Punti insufficienti'; END IF;

  v_cents := (p_points / 100) * 500;  -- 100 pt = €5
  PERFORM public.award_loyalty_points(v_uid, -p_points, 'redeem_credit');
  PERFORM public.wallet_credit(v_uid, v_cents, 'loyalty_convert', format('%s_pts', p_points));
  RETURN jsonb_build_object('points_spent', p_points, 'credited_cents', v_cents);
END; $$;

-- =============================================================================
-- 5. Permessi (stessa postura della migration 059): tutto chiuso di default,
--    poi si concede esplicitamente il minimo indispensabile.
-- =============================================================================
REVOKE EXECUTE ON FUNCTION public._wallet_apply(uuid,int,text,text)  FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.wallet_debit(uuid,int,text,text)   FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.wallet_credit(uuid,int,text,text)  FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.redeem_gift_card(text)             FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.convert_loyalty_to_credit(int)     FROM public, anon, authenticated;

-- Solo il backend (service role) può spendere/stornare credito.
GRANT EXECUTE ON FUNCTION public.wallet_debit(uuid,int,text,text)  TO service_role;
GRANT EXECUTE ON FUNCTION public.wallet_credit(uuid,int,text,text) TO service_role;
-- L'utente autenticato può riscattare una gift card e convertire i propri punti
-- (le funzioni si auto-proteggono comunque via auth.uid()).
GRANT EXECUTE ON FUNCTION public.redeem_gift_card(text)         TO authenticated;
GRANT EXECUTE ON FUNCTION public.convert_loyalty_to_credit(int) TO authenticated;

NOTIFY pgrst, 'reload schema';

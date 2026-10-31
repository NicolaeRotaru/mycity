-- 168: niente regali in euro e punti spenti al lancio.
--
-- PERCHE'. Il 6/7/2026 alle 12:51 l'AD ha deciso (DECISIONI.md) di tenere Punti e
-- Buoni regalo «armati, non lanciati»: si accendono con almeno 5 negozi reali che
-- incassano e una percentuale approvata dalla finanza (ipotesi 2%). Il 26/10 la
-- carta #209 firmata da Nicola ha aggiunto «nessun regalo in euro al lancio».
-- Il database invece li teneva accesi per tutti:
--   · ogni nuovo cliente riceveva 100 punti (migrazione 029) con una notifica
--     «€5 di sconto sul primo ordine, si applicano automaticamente al checkout
--     quando spendi almeno €10». Falso tre volte: la cassa non li applica, non
--     c'e' nessuna soglia di 10 euro, non c'e' nessun limite al primo ordine
--     (convert_loyalty_to_credit li trasforma subito in 5 euro di credito, e il
--     contrassegno spende il credito fino al totale);
--   · ogni ordine consegnato dava 1 punto per euro (migrazione 045), e 100 punti
--     si convertono in 5 euro: il 5% di ogni ordine restituito al cliente, che
--     nessuno ha approvato e che nessun negozio paga.
--
-- COSA FA. Spegne i regali nuovi e i punti nuovi; non toglie niente a nessuno.
--   ① il regalo di benvenuto non nasce piu' (via il trigger della 029);
--   ② un interruttore unico, `punti_fedelta_accesi()`, oggi `false`: lo stesso
--      valore di INVITI_E_PUNTI_ACCESI in lib/funzioni-al-lancio.ts (la prova
--      tests/unit/al-lancio-niente-regali-in-euro-e-punti-spenti.test.tsx
--      pretende che dicano la stessa cosa);
--   ③ award_loyalty_points non accredita punti nuovi finche' l'interruttore e'
--      spento — e' l'unica strada da cui entrano punti (benvenuto, ordini,
--      badge, serie di visite, recensioni, inviti), quindi le chiude tutte;
--      i movimenti in uscita restano;
--   ④ convert_loyalty_to_credit non crea credito nuovo finche' e' spento.
--
-- COSA NON FA. Non tocca loyalty_accounts, loyalty_transactions, il saldo del
-- credito (profiles.wallet_balance_cents) ne' le notifiche gia' scritte: i punti
-- che qualcuno ha gia' restano suoi, il credito MyCity gia' dato (buoni,
-- rimborsi, punti gia' convertiti) resta spendibile come prima.
--
-- PER RIACCENDERE. Una migrazione che riscrive `punti_fedelta_accesi()` con
-- `SELECT true`, insieme a INVITI_E_PUNTI_ACCESI = true, dopo la firma di Nicola
-- e con la percentuale decisa dalla finanza. Il regalo di benvenuto, se tornera',
-- tornera' con la sua regola vera (soglia, primo ordine) fatta rispettare dalla cassa.
--
-- Idempotente: si puo' rilanciare.

-- ① Il regalo di benvenuto: niente piu' 100 punti e notifica all'iscrizione.
DROP TRIGGER IF EXISTS trg_profile_welcome_bonus ON public.profiles;

-- ② L'interruttore dei punti, una casa sola dentro il database.
CREATE OR REPLACE FUNCTION public.punti_fedelta_accesi()
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
    SELECT false
$$;

REVOKE EXECUTE ON FUNCTION public.punti_fedelta_accesi() FROM public, anon, authenticated;

-- ③ Nessun punto nuovo, da nessuna fonte, finche' l'interruttore e' spento.
CREATE OR REPLACE FUNCTION public.award_loyalty_points(
    p_user uuid,
    p_delta int,
    p_reason text,
    p_order uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF p_delta > 0 AND NOT public.punti_fedelta_accesi() THEN
        RETURN;
    END IF;

    INSERT INTO public.loyalty_accounts (user_id, points_balance, lifetime_earned)
    VALUES (p_user, GREATEST(0, p_delta), GREATEST(0, p_delta))
    ON CONFLICT (user_id) DO UPDATE SET
        points_balance = GREATEST(0, public.loyalty_accounts.points_balance + p_delta),
        lifetime_earned = public.loyalty_accounts.lifetime_earned + GREATEST(0, p_delta),
        tier = CASE
            WHEN public.loyalty_accounts.lifetime_earned + GREATEST(0, p_delta) >= 5000 THEN 'platinum'
            WHEN public.loyalty_accounts.lifetime_earned + GREATEST(0, p_delta) >= 2000 THEN 'gold'
            WHEN public.loyalty_accounts.lifetime_earned + GREATEST(0, p_delta) >= 500  THEN 'silver'
            ELSE 'bronze'
        END,
        updated_at = now();

    INSERT INTO public.loyalty_transactions (user_id, delta, reason, order_id)
    VALUES (p_user, p_delta, p_reason, p_order);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.award_loyalty_points(uuid, integer, text, uuid) FROM public, anon, authenticated;

-- ④ Nessun credito nuovo dai punti finche' l'interruttore e' spento.
CREATE OR REPLACE FUNCTION public.convert_loyalty_to_credit(p_points int)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid; v_bal int; v_cents int;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Devi accedere'; END IF;
  IF NOT public.punti_fedelta_accesi() THEN
    RAISE EXCEPTION 'I punti non sono ancora attivi: quelli che hai restano tuoi, ma per ora non si convertono in credito.';
  END IF;
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

REVOKE EXECUTE ON FUNCTION public.convert_loyalty_to_credit(int) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.convert_loyalty_to_credit(int) TO authenticated;

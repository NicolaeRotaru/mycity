-- 089_referral_reward_on_delivery.sql
--
-- Premio referral REALMENTE erogato. La pagina "Invita un amico" prometteva
-- "ricevi €5 di credito" ma `referrals.rewarded`/`status` non venivano MAI
-- scritti e nessun credito veniva accreditato al referrer.
--
-- Ora: quando l'ordine del REFERRED viene CONSEGNATO per la prima volta, il
-- REFERRER riceve il credito (reward_amount, default €5) nel proprio wallet, e
-- la riga referral viene marcata (rewarded=true + status='rewarded' → accende
-- anche leaderboard e achievement "ambasciatore"). "Consegnato" (non solo
-- "creato") per evitare l'abuso crea-ordine-poi-annulla / auto-invito.
--
-- Best-effort: un errore qui non deve mai bloccare la consegna. Idempotente sul
-- flag `rewarded` (un solo premio per amico invitato).

CREATE OR REPLACE FUNCTION public.reward_referrer_on_delivery()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ref public.referrals%ROWTYPE; v_cents int;
BEGIN
  IF NEW.delivery_status = 'DELIVERED' AND OLD.delivery_status IS DISTINCT FROM 'DELIVERED' THEN
    BEGIN
      -- Il buyer è stato invitato e il referrer non è ancora stato premiato?
      SELECT * INTO v_ref FROM public.referrals
        WHERE referred_id = NEW.user_id AND rewarded = false
        FOR UPDATE;
      IF FOUND THEN
        v_cents := GREATEST(0, COALESCE(round(v_ref.reward_amount * 100)::int, 500));
        UPDATE public.referrals
          SET rewarded = true, rewarded_at = now(), status = 'rewarded', converted_at = now()
          WHERE id = v_ref.id;
        IF v_cents > 0 THEN
          PERFORM public.wallet_credit(v_ref.referrer_id, v_cents, 'referral_reward', NEW.id::text);
          INSERT INTO public.notifications (user_id, title, body, link)
          VALUES (
            v_ref.referrer_id,
            '🎉 Premio invito ricevuto!',
            'Un amico che hai invitato ha completato il primo ordine: hai ricevuto €'
              || to_char(v_cents / 100.0, 'FM999990.00') || ' di credito.',
            '/profile/referral'
          );
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      NULL; -- best-effort: la consegna non deve mai fallire per il premio referral
    END;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_reward_referrer_on_delivery ON public.orders;
CREATE TRIGGER trg_reward_referrer_on_delivery
  AFTER UPDATE OF delivery_status ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.reward_referrer_on_delivery();

NOTIFY pgrst, 'reload schema';

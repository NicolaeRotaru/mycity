-- 092_referral_no_self_referral.sql
--
-- ANTI-FRODE referral: impedisce l'auto-referral (referrer = referred).
--
-- Contesto: la tabella referrals (015) e il trigger di premio
-- reward_referrer_on_delivery (089) accreditano €5 al referrer quando il primo
-- ordine del referred viene consegnato. Mancava però qualsiasi vincolo che
-- impedisse referrer_id = referred_id: un utente poteva auto-invitarsi e
-- accreditarsi il premio da solo. La policy INSERT imponeva solo
-- referred_id = auth.uid(), non l'altra metà.
--
-- Meccanismo: CHECK constraint a livello DB (vale anche per SQL diretto /
-- service_role: non aggirabile saltando l'app) + tightening della policy INSERT.
--
-- Idempotente.

-- Rimuove eventuali self-referral preesistenti (altrimenti l'ADD CONSTRAINT
-- fallirebbe). Sono righe non valide per definizione; un eventuale premio già
-- accreditato resta nel wallet_ledger (clawback fuori ambito di questa migrazione).
DELETE FROM public.referrals WHERE referrer_id = referred_id;

DO $$
BEGIN
  ALTER TABLE public.referrals
    ADD CONSTRAINT referrals_no_self_referral CHECK (referrer_id <> referred_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Difesa in profondità anche nella policy (oltre al CHECK).
DROP POLICY IF EXISTS "Authenticated users can create referral" ON public.referrals;
CREATE POLICY "Authenticated users can create referral" ON public.referrals
  FOR INSERT WITH CHECK (referred_id = auth.uid() AND referrer_id <> referred_id);

NOTIFY pgrst, 'reload schema';

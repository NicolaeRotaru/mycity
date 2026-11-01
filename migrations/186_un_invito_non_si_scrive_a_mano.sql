-- =============================================================================
-- 186 — Un invito non si scrive a mano
-- =============================================================================
-- IL DIFETTO. Il premio invito (089) accredita 5 euro di credito vero a chi ha
-- invitato, alla prima consegna dell'invitato. Chi e' «l'invitato di chi» lo
-- dice solo la tabella `referrals`, e la policy INSERT (015, ristretta dalla
-- 092) lascia a ogni utente collegato scrivere «mi ha invitato A»: basta che
-- referred_id sia lui e referrer_id un altro. Oggi la 168 spegne il premio con
-- punti_fedelta_accesi() = false; il giorno che gli inviti si riaccendono,
-- Bruno scrive referrals(referrer = Anna, referred = Bruno), il suo ordine
-- arriva a DELIVERED e Anna incassa 5 euro, per ogni account che Bruno apre.
--
-- COSA FA. Toglie al cliente (anon, authenticated) la scrittura su `referrals`:
-- via la policy INSERT e via il permesso INSERT/UPDATE/DELETE. La lettura delle
-- proprie righe resta (pagina «Invita un amico», export dei dati). Un invito
-- nasce solo dal server (service_role), che e' l'unico posto dove si potra'
-- controllare il codice invito prima di scriverlo. Il premio (089/168) non
-- cambia: un invito scritto dal server paga ancora, una volta sola.
--
-- COSA NON FA. Non tocca le righe gia' scritte ne' il credito gia' dato. La
-- pagina di registrazione (app/sign-up/page.tsx) scrive ancora l'invito dal
-- browser: da oggi quella scrittura viene rifiutata (prima gia' falliva quando
-- serve la conferma email, perche' non c'e' sessione). Chi riaccende gli inviti
-- deve spostare quella scrittura in una rotta del server.
--
-- RITORNO INDIETRO (down):
--   GRANT INSERT, UPDATE, DELETE ON public.referrals TO anon, authenticated;
--   CREATE POLICY "Authenticated users can create referral" ON public.referrals
--     FOR INSERT WITH CHECK (referred_id = auth.uid() AND referrer_id <> referred_id);
--   REVOKE INSERT (reward_amount), UPDATE (reward_amount) ON public.referrals
--     FROM anon, authenticated;   -- come la 119
-- Nessun dato viene toccato: sono solo permessi.
--
-- Idempotente: si puo' rilanciare.
-- =============================================================================

DROP POLICY IF EXISTS "Authenticated users can create referral" ON public.referrals;

REVOKE INSERT, UPDATE, DELETE ON public.referrals FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';

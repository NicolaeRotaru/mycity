-- I visitatori non leggono la tabella dei profili: lo dice una migrazione, non solo la produzione.
--
-- IL DIFETTO (R18-024). In produzione has_table_privilege('anon', 'public.profiles', 'SELECT') e'
-- falso; sul database ricostruito dalle migrazioni e' vero. Nessuna migrazione toglie SELECT su
-- profiles ad anon (le revoche scritte riguardano seller_public_profiles, coupons e zone_codes): la
-- differenza e' stata fatta a mano. Oggi le regole per riga non danno ai visitatori nessuna riga di
-- profiles, ma le prove certificano un permesso diverso da quello vero, e se un giorno una regola di
-- lettura su profiles si allargasse, le copie e il sito vero si comporterebbero in modo diverso.
--
-- LA CURA. La revoca, come in produzione. Sul sito vero non cambia niente (REVOKE di un permesso che
-- non c'e' non fa nulla).
--
-- PERCHE' NIENTE SI SPEGNE (controllato sul database ricostruito, 13/11/2026):
--   · le viste che un visitatore legge e che guardano profiles (seller_public_profiles,
--     shop_of_month_leaderboard, live_activity_public) girano coi permessi del creatore
--     (security_invoker = off): non chiedono SELECT a chi legge;
--   · le funzioni che leggono profiles sono tutte SECURITY DEFINER (is_admin, negozio_approvato, …);
--   · le pagine e le rotte pubbliche leggono i negozi da seller_public_profiles
--     (lib/queries/seller-public-profiles.ts) e i profili pubblici col client di servizio
--     (app/u/[handle]/page.tsx); il ripiego su profiles in fetchNomiPubblici scatta solo senza la
--     vista nomi_pubblici (migrazione 164);
--   · le regole FOR ALL degli amministratori che leggevano profiles coi permessi di chi chiede, su
--     tabelle che i visitatori leggono (eventi, negozio del mese, campagne), sono diventate regole
--     con public.is_admin() nella 422, che viene prima. Le altre regole che leggono profiles stanno
--     su tabelle che un visitatore non legge (audit_logs, contact_messages, disputes,
--     rider_sos_events, zone_codes): per lui un errore invece di zero righe.
-- authenticated non cambia: il cliente legge ancora il suo profilo.
--
-- REVERSIBILE: GRANT SELECT ON public.profiles TO anon (rimette la differenza col sito vero).
--
-- LA PROVA: tests/sql/rls/riparazione-r18-profili-chiusi-ai-visitatori.test.sql.

REVOKE SELECT ON public.profiles FROM anon;

NOTIFY pgrst, 'reload schema';

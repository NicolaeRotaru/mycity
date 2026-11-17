-- I visitatori non leggono la tabella dei profili: scritto qui, non solo in produzione.
--
-- IL DIFETTO (R30-022). Sul sito vero has_table_privilege('anon', 'public.profiles', 'SELECT')
-- vale false; sul database ricostruito dalle migrazioni vale true. Nessuna migrazione revoca SELECT
-- su profiles ad anon (le revoche scritte riguardano seller_public_profiles, coupons e zone_codes):
-- la differenza e' stata fatta a mano in produzione. Il permesso arriva dalla partenza di Supabase di
-- una volta (ALL ad anon su ogni tabella nuova, tests/sql/harness/00_shim_supabase.sql), e la 425 lo
-- dava gia' per tolto senza toglierlo. Oggi le regole per riga non danno ai visitatori nessuna riga di
-- profiles, ma le copie del sito e le prove SQL certificano un permesso diverso da quello vero: se un
-- giorno una regola di lettura su profiles si allarga, sulle copie i dati personali (IBAN, documenti,
-- saldo) diventano leggibili e sul sito vero no, o viceversa.
--
-- LA CURA. La revoca che il sito vero ha gia', scritta. REVOKE SELECT sulla tabella toglie anche
-- l'eventuale SELECT colonna per colonna. Il resto dei permessi di anon su profiles non si tocca:
-- la voce misura solo la lettura. authenticated non cambia: il cliente legge ancora il suo profilo.
--
-- PERCHE' NIENTE SI SPEGNE (sul database ricostruito, 17/11/2026: tutte le prove SQL verdi tranne i
-- due controlli di 19 e 34 che leggono profiles da visitatore e si aspettano zero righe invece del
-- rifiuto; la loro modifica viaggia con questa migrazione):
--   · le viste che un visitatore legge e che guardano profiles (seller_public_profiles,
--     shop_of_month_leaderboard, live_activity_public) girano coi permessi del creatore;
--   · le funzioni che leggono profiles per conto del visitatore sono SECURITY DEFINER
--     (is_admin, negozio_approvato, store_cards, …);
--   · le pagine pubbliche leggono i negozi da seller_public_profiles; le regole degli
--     amministratori sulle tabelle che i visitatori leggono usano public.is_admin() (422).
--
-- SUL SITO VERO non cambia niente: revocare un permesso che non c'e' non fa nulla. Si puo' rieseguire.
-- NON si applica a mano: lo decide Nicola, come ogni migrazione.
--
-- REVERSIBILE: GRANT SELECT ON public.profiles TO anon (riporterebbe le copie com'erano, e il sito
-- vero a un permesso che oggi non ha: da non fare).
--
-- LA PROVA: tests/sql/rls/riparazione-r30-profili-chiusi-ai-visitatori.test.sql pretende che anon non
-- abbia SELECT su profiles (ne' sulla tabella ne' su una colonna) e che il catalogo si veda lo stesso.

BEGIN;

REVOKE SELECT ON TABLE public.profiles FROM anon;

DO $$
BEGIN
  IF has_table_privilege('anon', 'public.profiles', 'SELECT')
     OR has_any_column_privilege('anon', 'public.profiles', 'SELECT') THEN
    RAISE EXCEPTION '541: anon legge ancora public.profiles dopo la revoca';
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';

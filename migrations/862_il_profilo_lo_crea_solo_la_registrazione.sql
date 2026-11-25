-- =============================================================================
-- 862 — Il profilo lo crea solo la registrazione, non il browser
-- =============================================================================
-- COS'ERA ROTTO. Su `public.profiles` c'era la regola di inserimento «Profile is
-- created on signup» (001), con un solo controllo: `auth.uid() = id`. La guardia
-- `enforce_profile_update_rules` (119, poi 365, 709, 861) scatta solo quando una
-- riga si CAMBIA (BEFORE UPDATE): sull'inserimento non c'e'. Quindi un utente
-- collegato che non ha ancora la sua riga poteva crearsela col client del
-- browser, con qualunque colonna: `role = 'admin'`, `is_approved = true`,
-- `approval_status = 'approved'`. Provato sul database ricostruito dalle
-- migrazioni: l'inserimento passava e lasciava `admin|true|approved`.
--
-- PERCHE' OGGI NON CAPITAVA DA SOLA. `handle_new_user` (trigger SECURITY DEFINER
-- su `auth.users`, ultima versione nella 421) crea la riga nella stessa
-- registrazione, e il ruolo lo sceglie lei: solo cliente, negozio o fattorino.
-- Bastava pero' un utente senza riga (riga cancellata, trigger fallito, utente
-- nato prima del trigger) per aprire la porta. In produzione il 25/11/2026 erano
-- 0 su 12.
--
-- LA RIPARAZIONE. Dal browser non si inserisce piu' nessun profilo. Due strati:
--   ① via la regola «Profile is created on signup»;
--   ② via il permesso INSERT ad `anon` e `authenticated`.
-- Tutti e due, non uno solo: senza la regola ma col permesso, la prova 14 (①bis)
-- torna rossa perche' resta un permesso di scrittura che nessuna regola governa;
-- col solo permesso tolto, una regola larga aspetterebbe il primo GRANT di
-- troppo. Chi crea la riga resta chi la creava gia':
--   · `handle_new_user`, SECURITY DEFINER: gira coi diritti del proprietario
--     della tabella, non di chi si registra;
--   · il server con la chiave di servizio (`service_role`), per esempio
--     /api/agenzia/nuova-attivita: il suo permesso non si tocca.
-- Nel codice del sito nessuna `insert`/`upsert` su `profiles` usa il client del
-- browser (cercato in app/, components/, lib/: l'unico `upsert` e' in
-- lib/agenzia/nuova-attivita.ts e usa la chiave di servizio).
--
-- Si puo' rieseguire. NON si applica a mano: lo decide Nicola, come ogni migrazione.
-- REVERSIBILE (riapre il difetto):
--   GRANT INSERT ON public.profiles TO authenticated;
--   CREATE POLICY "Profile is created on signup" ON public.profiles
--     FOR INSERT WITH CHECK ((SELECT auth.uid()) = id);
-- LA PROVA: tests/sql/rls/il-profilo-lo-crea-solo-la-registrazione.test.sql.
-- =============================================================================

BEGIN;

-- ① La regola che lasciava inserire la propria riga dal browser.
DROP POLICY IF EXISTS "Profile is created on signup" ON public.profiles;

-- ② Il permesso, anche se una regola nuova un giorno lo coprisse.
REVOKE INSERT ON public.profiles FROM anon, authenticated;

COMMIT;

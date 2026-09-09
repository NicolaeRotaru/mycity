-- ============================================================================
-- 156 — LA DATA DI NASCITA DI UN MINORENNE NON ENTRA PIÙ IN `profiles`
-- ============================================================================
-- 3/9/2026, misurato sul database ricostruito dalle migrazioni: un profilo con
-- ruolo `rider` ha scritto da solo una data di nascita di quindici anni fa, e
-- poi lo staff l'ha approvato. Risultato: «rider di 15 anni, stato approved,
-- approvato=true». Le condizioni d'uso, al punto 3, dicono diciotto anni.
--
-- Perché serve un vincolo qui e non basta il codice. Le porte che scrivono
-- `legal_birth_date` sono almeno due, e nessuna delle due passa da una rotta:
--
--   · app/rider/onboarding/page.tsx  → supabase.from('profiles').update(form)
--   · app/sell/page.tsx              → supabase.from('profiles').update({...})
--
-- Sono due `update` fatti dal browser con la chiave pubblica. Chiuso il
-- controllo del browser — e con gli strumenti da sviluppatore si chiude in dieci
-- secondi — non ne resta nessun altro. Il trigger che governa le scritture sul
-- profilo (`enforce_profile_update_rules`, migrazione 119) elenca
-- `legal_birth_date` fra i campi che una persona può cambiare di sé, ma non
-- guarda cosa ci scrive dentro.
--
-- Questo vincolo è l'unico punto che chiude anche le strade che nasceranno
-- domani: qualunque `INSERT` o `UPDATE`, da qualunque ruolo — compreso
-- `service_role` — con una data da minorenne, fallisce.
--
-- ⚠️ PRIMA DI APPLICARLA, IL CENSIMENTO (sola lettura, non cambia niente):
--
--     SELECT count(*) AS gia_dentro
--     FROM public.profiles
--     WHERE legal_birth_date IS NOT NULL
--       AND legal_birth_date > (CURRENT_DATE - INTERVAL '18 years');
--
--   Se torna 0, questa migrazione passa liscia. Se torna più di 0, si ferma di
--   proposito con un messaggio che dice quante righe sono: quelle vanno
--   guardate da una persona (sono minorenni già iscritti, non un errore di
--   battitura da sistemare in automatico), non sovrascritte da uno script.
--
-- ROLLBACK (una riga, nessun dato perso — il vincolo non riscrive niente):
--
--     ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_maggiore_eta;
--
-- Verificato su PostgreSQL 16.13 prima di consegnarla: un CHECK che usa
-- CURRENT_DATE viene accettato (non è un indice: qui l'immutabilità non è
-- richiesta), rifiuta chi ha 17 anni e 364 giorni e lascia passare chi compie
-- 18 anni oggi. Ed è sicuro nel tempo per costruzione: una riga che oggi passa
-- passerà anche domani, perché gli anni possono solo aumentare.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1) Se qualche minorenne è già dentro, ci si ferma con un messaggio chiaro.
--    Senza questo blocco l'errore sarebbe «check constraint is violated by some
--    row», che non dice quante righe sono né dove guardare.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  gia_dentro int;
BEGIN
  SELECT count(*) INTO gia_dentro
  FROM public.profiles
  WHERE legal_birth_date IS NOT NULL
    AND legal_birth_date > (CURRENT_DATE - INTERVAL '18 years');

  IF gia_dentro > 0 THEN
    RAISE EXCEPTION
      'Ci sono % profili con una data di nascita da minorenne. Vanno guardati da una persona prima di mettere il vincolo: sono iscritti veri, non errori di battitura. La query del censimento è nella testata di questa migrazione.',
      gia_dentro;
  END IF;
END;
$$;

-- ----------------------------------------------------------------------------
-- 2) Il vincolo. `IS NULL` passa: la data di nascita la riempiono solo il
--    fattorino e il venditore, un cliente che compra non la scrive mai e non
--    deve essere costretto a darcela per esistere.
-- ----------------------------------------------------------------------------
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_maggiore_eta;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_maggiore_eta
  CHECK (
    legal_birth_date IS NULL
    OR legal_birth_date <= (CURRENT_DATE - INTERVAL '18 years')
  );

COMMENT ON CONSTRAINT profiles_maggiore_eta ON public.profiles IS
  'Condizioni d''uso punto 3: per consegnare o vendere servono 18 anni compiuti. Il giorno del compleanno conta. La copia in TypeScript di questa regola è lib/maggiore-eta.ts; se cambia la soglia, cambiano tutte e due.';

COMMIT;

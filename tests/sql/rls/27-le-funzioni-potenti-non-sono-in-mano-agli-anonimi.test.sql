-- =============================================================================
-- Le funzioni potenti e le viste non sono in mano a chi non ha fatto l'accesso
-- =============================================================================
-- Gira contro un database ricostruito dalle migrazioni vere:
--   tests/sql/harness/apply.sh mycity_test
--   tests/sql/harness/run.sh   mycity_test
--
-- PERCHE' ESISTE, ACCANTO AL 10 E AL GUARDIANO IN TYPESCRIPT.
-- Il 10 chiede al catalogo se una funzione potente nuova e' aperta agli anonimi, e tiene una lista
-- bianca di ventidue nomi. Questo file fa tre cose che il 10 non fa:
--   · controlla le VISTE, non solo le funzioni — e' da li' che passava `referral_leaderboard`, che
--     ha `security_invoker = on` (quindi nessun avviso di Supabase la segnala) ma dentro chiama una
--     funzione coi permessi del creatore, e serviva nome e cognome di cinquanta persone a chiunque;
--   · verifica che il rimedio NON abbia spento il sito: le migrazioni 151 e 152 chiudono delle porte,
--     e la domanda che conta e' se la vetrina si vede ancora senza account. Un controllo che blinda e
--     rompe un flusso vero e' un danno, non una difesa;
--   · verifica che il tetto sugli annunci a pagamento conti PER CHI CHIAMA, provandolo davvero:
--     cinquanta richieste da un indirizzo devono diventare tre clic, e le persone dopo di lui devono
--     poter contare ancora.
--
-- Il gemello che gira senza database e' tests/unit/nessuna-funzione-potente-in-mano-a-chi-non-ha-l-account.test.ts:
-- legge le migrazioni e diventa rosso in CI, dove un Postgres non c'e'. Questo file e' la controprova
-- sul catalogo vero, per chi il database ce l'ha.
--
-- Tutto in transazione, ROLLBACK: non lascia dati.
-- =============================================================================

BEGIN;

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;

-- ---------------------------------------------------------------------------
-- ① Le quattro che nessuno chiama sono chiuse davvero, da tutti e due i rubinetti
-- ---------------------------------------------------------------------------
-- «Da tutti e due» e' il punto: `REVOKE … FROM anon` senza PUBLIC non chiude, e `REVOKE … FROM
-- public` senza anon nemmeno. `has_function_privilege` risponde sulla somma, che e' quello che conta.
INSERT INTO esiti
SELECT 'le quattro funzioni che nessuno chiama sono chiuse agli anonimi',
       count(*) = 0,
       CASE WHEN count(*) = 0 THEN 'tutte chiuse'
            ELSE 'ancora aperte: ' || string_agg(proname, ', ' ORDER BY proname) END
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('event_rsvp_count', 'get_referral_leaderboard',
                     'referral_reward_fisso', 'shop_of_month_vote_counts')
   AND has_function_privilege('anon', p.oid, 'EXECUTE');

-- ---------------------------------------------------------------------------
-- ② Nessuna vista con dati di persone e' leggibile da chi non ha l'account
-- ---------------------------------------------------------------------------
INSERT INTO esiti
SELECT 'le viste con dentro persone non sono in vetrina',
       count(*) = 0,
       CASE WHEN count(*) = 0 THEN 'nessun anonimo le legge'
            ELSE 'leggibili da anon: ' || string_agg(relname, ', ' ORDER BY relname) END
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind = 'v'
   AND c.relname IN ('referral_leaderboard', 'rider_consegne_storico',
                     'rider_reviews_ricevute', 'ordini_disponibili_rider')
   AND has_table_privilege('anon', c.oid, 'SELECT');

-- ---------------------------------------------------------------------------
-- ③ Ogni vista che gli anonimi leggono e' una scelta scritta, non un'eredita'
-- ---------------------------------------------------------------------------
-- La lista qui sotto sono le quattro vetrine pubbliche: girano coi permessi del creatore APPOSTA,
-- perche' sotto non c'e' nessuna regola che permetta la lettura pubblica (misurato: con
-- `security_invoker = true` si svuotano tutte e quattro). Una quinta vista che compare qui e' una
-- porta che si e' aperta da sola.
INSERT INTO esiti
SELECT 'nessuna vista nuova e'' finita in vetrina senza che nessuno lo decidesse',
       count(*) = 0,
       CASE WHEN count(*) = 0 THEN 'fuori lista: nessuna'
            ELSE 'fuori lista: ' || string_agg(relname, ', ' ORDER BY relname) END
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind = 'v'
   AND has_table_privilege('anon', c.oid, 'SELECT')
   AND NOT coalesce(
         (SELECT option_value::boolean FROM pg_options_to_table(c.reloptions)
           WHERE option_name = 'security_invoker'), false)
   AND c.relname NOT IN ('seller_public_profiles', 'shop_of_month_leaderboard',
                         'live_activity_public', 'sponsored_active_public');

-- ---------------------------------------------------------------------------
-- ④ Le vetrine pubbliche sono barriere: il filtro della vista viene per primo
-- ---------------------------------------------------------------------------
INSERT INTO esiti
SELECT 'le vetrine pubbliche non fanno passare avanti il filtro di chi chiede',
       count(*) = 0,
       CASE WHEN count(*) = 0 THEN 'tutte barriera'
            ELSE 'senza barriera: ' || string_agg(relname, ', ' ORDER BY relname) END
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind = 'v'
   AND c.relname IN ('seller_public_profiles', 'shop_of_month_leaderboard',
                     'live_activity_public', 'sponsored_active_public')
   AND NOT coalesce(
         (SELECT option_value::boolean FROM pg_options_to_table(c.reloptions)
           WHERE option_name = 'security_barrier'), false);

-- ---------------------------------------------------------------------------
-- ⑤ IL SITO SI VEDE ANCORA SENZA ACCOUNT (il controllo che tiene onesti gli altri)
-- ---------------------------------------------------------------------------
-- Quattro delle funzioni potenti aperte agli anonimi stanno DENTRO le regole di lettura: chiuderle
-- fa rispondere «permission denied» a chi apre il catalogo. Qui si prova il giro vero di un
-- visitatore senza account su un negozio approvato seminato apposta.
DO $$
DECLARE
  v_negozio uuid := '0f0f0f0f-0000-4000-8000-00000000f001';
  v_righe   int;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_negozio, 'vetrina-prova@example.invalid')
    ON CONFLICT (id) DO NOTHING;
  SET session_replication_role = replica;   -- i trigger di coerenza qui non servono
  INSERT INTO public.profiles (id, role, store_name, is_approved, approval_status)
  VALUES (v_negozio, 'seller', 'Negozio di prova', true, 'approved')
  ON CONFLICT (id) DO UPDATE SET role = 'seller', store_name = 'Negozio di prova',
                                 is_approved = true, approval_status = 'approved';
  SET session_replication_role = origin;

  SET LOCAL ROLE anon;
  SELECT count(*) INTO v_righe FROM public.seller_public_profiles WHERE id = v_negozio;
  RESET ROLE;
  INSERT INTO esiti VALUES ('un visitatore senza account vede ancora i negozi in vetrina',
    v_righe = 1, 'righe viste: ' || v_righe);

  SET LOCAL ROLE anon;
  PERFORM count(*) FROM public.products;   -- richiama negozio_approvato() dentro la regola
  PERFORM count(*) FROM public.store_cards(4, 50);
  RESET ROLE;
  INSERT INTO esiti VALUES ('il catalogo e le schede negozio rispondono senza account', true, 'nessun errore');
EXCEPTION WHEN insufficient_privilege THEN
  RESET ROLE;
  INSERT INTO esiti VALUES ('il catalogo e le schede negozio rispondono senza account', false,
    'permission denied: una revoca ha spento la vetrina — ' || SQLERRM);
END $$;

-- ---------------------------------------------------------------------------
-- ⑥ Il tetto sugli annunci conta per CHI CHIAMA, e non affama il conteggio vero
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_negozio  uuid := '0f0f0f0f-0000-4000-8000-00000000f001';
  v_prodotto uuid := '0f0f0f0f-0000-4000-8000-00000000f002';
  v_campagna uuid := '0f0f0f0f-0000-4000-8000-00000000f003';
  v_dopo_attacco int;
  v_dopo_persona int;
BEGIN
  SET session_replication_role = replica;
  INSERT INTO public.products (id, seller_id, name, price)
  VALUES (v_prodotto, v_negozio, 'Prodotto di prova', 3) ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.sponsored_listings (id, product_id, seller_id, placement, status, start_date, end_date)
  VALUES (v_campagna, v_prodotto, v_negozio, 'home_top', 'active', current_date, current_date + 30)
  ON CONFLICT (id) DO NOTHING;
  SET session_replication_role = origin;

  -- cinquanta richieste da un indirizzo solo
  SET LOCAL ROLE anon;
  SET LOCAL request.headers = '{"cf-connecting-ip":"203.0.113.7"}';
  PERFORM public.track_sponsored_click(v_campagna) FROM generate_series(1, 50);
  RESET ROLE;
  SELECT clicks INTO v_dopo_attacco FROM public.sponsored_listings WHERE id = v_campagna;

  -- una persona vera subito dopo, da un altro indirizzo
  SET LOCAL ROLE anon;
  SET LOCAL request.headers = '{"cf-connecting-ip":"203.0.113.8"}';
  PERFORM public.track_sponsored_click(v_campagna) FROM generate_series(1, 2);
  RESET ROLE;
  SELECT clicks INTO v_dopo_persona FROM public.sponsored_listings WHERE id = v_campagna;

  INSERT INTO esiti VALUES (
    'cinquanta clic da un indirizzo solo ne valgono tre',
    v_dopo_attacco = 3, 'clic contati: ' || v_dopo_attacco || ' (attesi 3)');
  INSERT INTO esiti VALUES (
    'dopo l''attacco il conteggio delle persone vere funziona ancora',
    v_dopo_persona = 5, 'clic contati: ' || v_dopo_persona || ' (attesi 5: 3 + 2)');
END $$;

-- ---------------------------------------------------------------------------
-- ⑦ Chi legge i tetti non e' il browser
-- ---------------------------------------------------------------------------
INSERT INTO esiti
SELECT 'la funzione che decide i tetti non e'' chiamabile dal browser',
       count(*) = 0,
       CASE WHEN count(*) = 0 THEN 'nessun ruolo del browser la puo'' chiamare'
            ELSE 'raggiungibile da: ' || string_agg(ruolo, ', ') END
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(ruolo)
 WHERE n.nspname = 'public'
   AND p.proname IN ('sponsored_sotto_tetto', 'chi_sta_contando')
   AND has_function_privilege(r.ruolo, p.oid, 'EXECUTE');

-- =============================================================================
-- Verdetto
-- =============================================================================
DO $$
DECLARE r record; rossi int;
BEGIN
  FOR r IN SELECT * FROM esiti ORDER BY nome LOOP
    RAISE INFO '%  %  — %', CASE WHEN r.ok THEN 'ok  ' ELSE 'ROTTO' END, r.nome, r.dettaglio;
  END LOOP;
  SELECT count(*) INTO rossi FROM esiti WHERE ok IS NOT TRUE;
  IF rossi > 0 THEN
    RAISE EXCEPTION '% controlli rossi in questo file', rossi;
  END IF;
END $$;

ROLLBACK;

-- La regola dell'amministratore non ferma piu' la lettura degli eventi.
--
-- IL DIFETTO (R18-018). Su marketplace_events la regola dell'amministratore e' FOR ALL
-- (034, righe 95-99), quindi vale anche per le letture, e la sua condizione legge
-- public.profiles coi permessi di chi chiede: EXISTS (SELECT 1 FROM public.profiles WHERE
-- id = auth.uid() AND role = 'admin'). Postgres valuta tutte le regole di lettura insieme: se
-- una fallisce per un permesso mancante, fallisce la domanda intera, anche se events_public_read
-- la lascerebbe passare. In produzione anon non ha SELECT su profiles (R18-024, migrazione 426):
-- un visitatore senza accesso apre /events e legge «Non riesco a leggere gli eventi».
--
-- La stessa costruzione (FOR ALL con la sottodomanda su profiles accanto a una lettura pubblica)
-- c'e' su altre due tabelle che i visitatori leggono:
--   · shop_of_month (034): «Negozio del mese» in home e nella sua pagina (lib/queries/negozio-del-mese.ts);
--   · cashback_campaigns (027): lettura pubblica delle campagne attive.
-- Le altre regole che leggono profiles coi permessi di chi chiede (rider_sos_admin_all,
-- zone_codes_admin_write, audit_admin_read, contact_admin_read, disputes_party_read) stanno su
-- tabelle che un visitatore non legge: per lui la risposta e' un errore invece di zero righe,
-- nessuna pagina si spegne. Restano come sono.
--
-- LA CURA. Su ognuna delle tre tabelle la regola FOR ALL lascia il posto a quattro regole TO
-- authenticated con public.is_admin() (SECURITY DEFINER, gia' usata da 28 regole, aperta ad anon
-- di proposito: 151): scrittura (INSERT, UPDATE, DELETE) e la lettura completa dell'amministratore,
-- che la pagina admin degli eventi usa per gli annullati (app/admin/events/page.tsx) e senza la
-- quale UPDATE e DELETE non troverebbero la riga. Chi non e' collegato non valuta nessuna delle
-- quattro: la sua lettura passa solo dalla regola pubblica, che resta com'e'.
-- Chi e' admin puo' fare esattamente quello che faceva prima; nessuno puo' di piu'.
--
-- REVERSIBILE: DROP delle dodici regole *_admin_read/_insert/_update/_delete e ricreazione delle
-- tre FOR ALL com'erano (034 righe 95-99 e la stessa forma per shop_of_month e cashback_campaigns).
--
-- LA PROVA: tests/sql/rls/riparazione-r18-eventi-da-visitatore.test.sql. Toglie ad anon la
-- lettura di profiles come in produzione, poi da visitatore legge eventi, negozio del mese e
-- campagne senza errori, e non scrive; l'amministratore scrive e vede gli annullati.

BEGIN;

-- I DROP IF EXISTS dei nomi nuovi non trovano niente la prima volta: niente avvisi a vuoto.
SET LOCAL client_min_messages = warning;

DO $$
DECLARE
  t text;
  vecchia text;
BEGIN
  FOR t, vecchia IN
    SELECT * FROM (VALUES
      ('marketplace_events', 'events_admin_write'),
      ('shop_of_month',      'shop_of_month_admin_write'),
      ('cashback_campaigns', 'cashback_campaigns_admin_write')
    ) AS v(t, vecchia)
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', vecchia, t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_admin_read', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_admin_insert', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_admin_update', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_admin_delete', t);

    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING ((SELECT public.is_admin()))',
                   t || '_admin_read', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_admin()))',
                   t || '_admin_insert', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()))',
                   t || '_admin_update', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING ((SELECT public.is_admin()))',
                   t || '_admin_delete', t);
  END LOOP;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';

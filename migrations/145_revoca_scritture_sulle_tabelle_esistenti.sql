-- Chiunque aveva il permesso di scrivere su una cinquantina di tabelle: a fermarlo c'era un solo strato.
--
-- IL DIFETTO (radiografia del 27/8/2026, R034). Contate sul database ricostruito dalle migrazioni,
-- le combinazioni tabella-permesso-ruolo in cui `anon` o `authenticated` avevano INSERT, UPDATE o
-- DELETE mentre per quel comando NON esisteva nessuna regola riga-per-riga erano 168.
--
-- Dentro c'erano le tabelle che contano: `orders` (inserimento e cancellazione), `order_items` (tutti
-- e tre), `wallet_ledger` (tutti e tre), `pending_checkouts`, `notifications`, `gift_cards`,
-- `order_delivery_codes`, `order_pickup_codes`, `site_settings`, `loyalty_accounts`,
-- `loyalty_transactions`, e la cancellazione dei profili.
--
-- OGGI NON ERA SFRUTTABILE, ed e' stato verificato tabella per tabella: la protezione riga-per-riga
-- e' accesa su tutte, e con la protezione accesa «nessuna regola» vuol dire «rifiuta tutto». Il
-- permesso pero' c'era, ed era l'UNICO strato a mancare. Basta una regola nuova scritta un po' larga,
-- o un `ALTER TABLE … DISABLE ROW LEVEL SECURITY` messo li' durante una riparazione, e la porta si
-- apre senza che nessuno l'abbia aperta.
--
-- LA CAUSA. Il permesso di partenza di Supabase e' `GRANT ALL` ad `anon` e `authenticated`. Le
-- migrazioni 114 (riga 442) e 119 (riga 375) hanno chiuso il rubinetto con `ALTER DEFAULT PRIVILEGES`,
-- che pero' vale solo per le tabelle FUTURE. Sulle tabelle che c'erano gia' non e' mai tornato
-- indietro nessuno: il ciclo della 114 (righe 428-438) gira su `relkind = 'v'`, cioe' sulle viste. Le
-- uniche revoche su tabelle erano a mano e coprivano quattro casi (114 su `orders` e solo per `anon`,
-- 115 su `newsletter_subscribers` e `consent_log`, 119 su `product_views_daily`).
--
-- LA RIPARAZIONE. Lo stesso ciclo della 114, ma sulle tabelle. Per ogni tabella di `public` e per
-- ciascuno dei due ruoli pubblici: si tolgono INSERT, UPDATE, DELETE, TRUNCATE e REFERENCES, e poi si
-- riconcede UNO PER UNO solo il comando che una regola permissiva copre davvero — la regola lo dice
-- da sola, in `pg_policies`, e il ruolo deve rientrare fra quelli a cui la regola si applica.
--
-- COSA NON SI TOCCA. La lettura (SELECT): quella la governano altre migrazioni, e togliere un SELECT
-- qui vorrebbe dire spegnere la vetrina. E `service_role`, cioe' il backend, resta come prima: e' lui
-- che scrive gli ordini.
--
-- TRUNCATE E REFERENCES NON LI GOVERNA NESSUNA REGOLA, MAI: la protezione riga-per-riga non guarda il
-- TRUNCATE. Quelli si tolgono e basta.
--
-- REVERSIBILE, ma con la testa: `GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;`
-- rimette esattamente la situazione di prima — cioe' il difetto.
--
-- LA PROVA: tests/sql/rls/14-le-porte-di-servizio-sono-chiuse.test.sql, controllo ①bis. E' il
-- controllo ① allargato da nove tabelle di servizio a tutte. Senza questa migrazione conta 334
-- permessi scoperti; con questa, zero. Il resto della cartella tests/sql/rls resta verde: e' la
-- verifica che nessuna revoca ha rotto una scrittura legittima.

DO $$
DECLARE
  t record;
  ruolo text;
  comandi text[];
BEGIN
  FOR t IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname = 'public'
       AND c.relkind IN ('r', 'p')   -- tabelle vere e tabelle partizionate; le viste le fa la 114
     ORDER BY c.relname
  LOOP
    FOREACH ruolo IN ARRAY ARRAY['anon', 'authenticated'] LOOP

      EXECUTE format(
        'REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES ON public.%I FROM %I',
        t.relname, ruolo);

      -- Quali comandi una regola permissiva governa davvero, per questo ruolo.
      -- Una regola `FOR ALL` vale per tutti e tre.
      SELECT array_agg(DISTINCT x.comando)
        INTO comandi
        FROM pg_policies p
        CROSS JOIN LATERAL unnest(
               CASE WHEN p.cmd = 'ALL' THEN ARRAY['INSERT', 'UPDATE', 'DELETE']
                    ELSE ARRAY[p.cmd] END
             ) AS x(comando)
       WHERE p.schemaname = 'public'
         AND p.tablename = t.relname
         AND p.permissive = 'PERMISSIVE'
         AND x.comando IN ('INSERT', 'UPDATE', 'DELETE')
         AND (p.roles @> ARRAY['public']::name[] OR p.roles @> ARRAY[ruolo]::name[]);

      IF comandi IS NOT NULL THEN
        EXECUTE format('GRANT %s ON public.%I TO %I',
                       array_to_string(comandi, ', '), t.relname, ruolo);
      END IF;

    END LOOP;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

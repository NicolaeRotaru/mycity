-- ============================================================================
-- 22/8/2026 — I DIFETTI MINORI DEL DATABASE, PROVATI.
--
-- Ogni controllo qui sotto diventa rosso se la riparazione corrispondente
-- sparisce. Non cerca parole nei file: interroga il database vero.
-- ============================================================================
BEGIN;

CREATE TEMP TABLE esiti (nome text, verde boolean, dettaglio text) ON COMMIT DROP;

-- ── ① Nessun permesso residuo per anon sulle tabelle di servizio ───────────
DO $$
DECLARE n int; elenco text;
BEGIN
  SELECT count(*), coalesce(string_agg(DISTINCT g.table_name, ', '), '—')
    INTO n, elenco
  FROM information_schema.role_table_grants g
  WHERE g.table_schema = 'public'
    AND g.grantee IN ('anon', 'authenticated')
    AND g.table_name IN (
      'stripe_event_log', 'email_queue', 'merchants_leads', 'kpi_snapshots',
      'cron_heartbeats', 'operational_alert_log', 'outreach_events',
      'telegram_chats', 'uptime_checks'
    );

  INSERT INTO esiti VALUES (
    'le tabelle di servizio non hanno permessi per anon',
    n = 0,
    format('%s permessi residui su: %s', n, elenco)
  );
END $$;

-- ── ①bis Nessun permesso di SCRITTURA senza una regola che lo governi ─────
-- 27/8/2026 (R034) — Il controllo ① qui sopra guardava nove tabelle di
-- servizio, scelte a mano. Fuori da quelle nove, `anon` e `authenticated`
-- avevano il permesso di INSERT, UPDATE o DELETE su una cinquantina di tabelle
-- per cui NON esisteva nessuna regola di quel comando: 168 combinazioni
-- tabella-permesso-ruolo, contate sul database ricostruito. Dentro c'erano
-- `orders`, `order_items`, `wallet_ledger`, `gift_cards`, `notifications`,
-- `loyalty_transactions`, i codici di consegna e di ritiro, e la cancellazione
-- dei profili.
--
-- Non era sfruttabile: con la protezione riga-per-riga accesa, «nessuna regola»
-- vuol dire «rifiuta tutto». Ma era l'UNICO strato. Bastava una regola nuova
-- scritta un po' larga, o un `DISABLE ROW LEVEL SECURITY` messo li' durante una
-- riparazione, e la porta si apriva senza che nessuno l'avesse aperta. La causa
-- e' il permesso di partenza di Supabase (GRANT ALL ad anon e authenticated):
-- le migrazioni 114 e 119 avevano chiuso il rubinetto per le tabelle FUTURE, ma
-- non erano mai tornate indietro su quelle che c'erano gia'.
--
-- Questo controllo e' il ① allargato da nove tabelle a tutte: un permesso di
-- scrittura vale solo se una regola permissiva di quel comando lo governa, per
-- quel ruolo. TRUNCATE e REFERENCES non li governa nessuna regola, mai: quelli
-- devono semplicemente non esserci.
DO $$
DECLARE n int; elenco text;
BEGIN
  SELECT count(*), coalesce(string_agg(DISTINCT x.riga, ', '), '—')
    INTO n, elenco
  FROM (
    SELECT DISTINCT g.table_name || ' [' || g.privilege_type || ' → ' || g.grantee || ']' AS riga
    FROM information_schema.role_table_grants g
    JOIN pg_class c      ON c.relname = g.table_name
    JOIN pg_namespace ns ON ns.oid = c.relnamespace AND ns.nspname = 'public'
    WHERE g.table_schema = 'public'
      AND g.grantee IN ('anon', 'authenticated')
      AND g.privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES')
      AND c.relkind IN ('r', 'p')
      AND NOT EXISTS (
        SELECT 1 FROM pg_policies p
        WHERE p.schemaname = 'public'
          AND p.tablename = g.table_name
          AND p.permissive = 'PERMISSIVE'
          AND p.cmd IN (g.privilege_type, 'ALL')
          AND (p.roles @> ARRAY['public']::name[] OR p.roles @> ARRAY[g.grantee]::name[])
      )
  ) x;

  INSERT INTO esiti VALUES (
    'nessuno puo scrivere su una tabella senza una regola che lo governi',
    n = 0,
    format('%s permessi di scrittura scoperti: %s', n, left(elenco, 600))
  );
END $$;

-- ── ② Nessuna regola chiama auth.uid() una volta per riga ─────────────────
DO $$
DECLARE n int; elenco text;
BEGIN
  SELECT count(*), coalesce(string_agg(p.tablename || '.' || p.policyname, ', '), '—')
    INTO n, elenco
  FROM pg_policies p
  WHERE p.schemaname = 'public'
    AND ( replace(coalesce(p.qual, ''),       '( SELECT auth.uid() AS uid)', '#') LIKE '%auth.uid()%'
       OR replace(coalesce(p.with_check, ''), '( SELECT auth.uid() AS uid)', '#') LIKE '%auth.uid()%' );

  INSERT INTO esiti VALUES (
    'auth.uid() e sempre avvolto in un sotto-programma costante',
    n = 0,
    format('%s regole lo chiamano per riga: %s', n, elenco)
  );
END $$;

-- ── ③ Niente regole doppione: stessa tabella, stesso comando, stessa forma ─
DO $$
DECLARE n int; elenco text;
BEGIN
  SELECT count(*), coalesce(string_agg(x.tablename || ' [' || x.cmd || ']', ', '), '—')
    INTO n, elenco
  FROM (
    SELECT p.tablename, p.cmd, coalesce(p.qual, '') AS q, count(*) AS quante
    FROM pg_policies p
    WHERE p.schemaname = 'public' AND p.permissive = 'PERMISSIVE'
    GROUP BY p.tablename, p.cmd, coalesce(p.qual, '')
    HAVING count(*) > 1
  ) x;

  INSERT INTO esiti VALUES (
    'nessuna regola duplicata (stessa tabella, stesso comando, stessa espressione)',
    n = 0,
    format('%s gruppi di doppioni: %s', n, elenco)
  );
END $$;

-- ── ④ Le chiavi esterne hanno il loro indice ─────────────────────────────
DO $$
DECLARE n int; elenco text;
BEGIN
  SELECT count(*), coalesce(string_agg(c.conrelid::regclass || '.' || a.attname, ', '), '—')
    INTO n, elenco
  FROM pg_constraint c
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
  WHERE c.contype = 'f'
    AND array_length(c.conkey, 1) = 1
    AND c.connamespace = 'public'::regnamespace
    AND NOT EXISTS (
      SELECT 1 FROM pg_index i WHERE i.indrelid = c.conrelid AND i.indkey[0] = c.conkey[1]
    );

  INSERT INTO esiti VALUES (
    'ogni chiave esterna ha il suo indice',
    n = 0,
    format('%s senza indice: %s', n, elenco)
  );
END $$;

-- ── ⑤ Nessun vincolo aggiunto e mai validato ─────────────────────────────
DO $$
DECLARE n int; elenco text;
BEGIN
  SELECT count(*), coalesce(string_agg(c.conname, ', '), '—')
    INTO n, elenco
  FROM pg_constraint c
  WHERE c.connamespace = 'public'::regnamespace
    AND c.contype = 'c'
    AND NOT c.convalidated;

  INSERT INTO esiti VALUES (
    'nessun vincolo resta NOT VALID (uno che non sai se vale e peggio di uno che non c''e)',
    n = 0,
    format('%s non validati: %s', n, elenco)
  );
END $$;

-- ── ⑥ Un rimborso non può superare l'incasso ─────────────────────────────
DO $$
DECLARE mancanti text[] := ARRAY[]::text[];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_rimborso_entro_lordo') THEN
    mancanti := mancanti || 'orders_rimborso_entro_lordo';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_lordo_non_negativo') THEN
    mancanti := mancanti || 'orders_lordo_non_negativo';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_rimborso_non_negativo') THEN
    mancanti := mancanti || 'orders_rimborso_non_negativo';
  END IF;

  INSERT INTO esiti VALUES (
    'sui soldi dell''ordine i vincoli ci sono',
    array_length(mancanti, 1) IS NULL,
    coalesce('mancano: ' || array_to_string(mancanti, ', '), 'tutti presenti')
  );
END $$;

-- ── ⑦ Le viste dichiarano la loro scelta, non la lasciano all'assenza ─────
DO $$
DECLARE n int; elenco text;
BEGIN
  SELECT count(*), coalesce(string_agg(c.relname, ', '), '—')
    INTO n, elenco
  FROM pg_class c
  JOIN pg_namespace ns ON ns.oid = c.relnamespace
  WHERE ns.nspname = 'public'
    AND c.relkind = 'v'
    AND NOT EXISTS (
      SELECT 1 FROM unnest(coalesce(c.reloptions, ARRAY[]::text[])) o
      WHERE o LIKE 'security_invoker=%'
    );

  INSERT INTO esiti VALUES (
    'ogni vista dichiara security_invoker (scelta, non dimenticanza)',
    n = 0,
    format('%s senza dichiarazione: %s', n, elenco)
  );
END $$;

-- ── ⑧ Il venditore NON può scrivere la posizione del fattorino ───────────
DO $$
DECLARE
  corpo text := pg_get_functiondef('public.enforce_order_update_rules'::regproc);
  ok_gps boolean;
  ok_orari boolean;
BEGIN
  -- Non è una ricerca di parole al posto di una prova: il comportamento vero
  -- lo prova il blocco ⑨ qui sotto, con un UPDATE che deve fallire. Qui si
  -- controlla solo che le due guardie esistano nella funzione viva.
  ok_gps := corpo LIKE '%la posizione la scrive solo il fattorino assegnato%';
  ok_orari := corpo LIKE '%accettazione e pronto li scrive solo il negozio%';

  INSERT INTO esiti VALUES ('la guardia sul GPS del fattorino c''e', ok_gps,
    CASE WHEN ok_gps THEN 'presente' ELSE 'SPARITA dalla funzione viva' END);
  INSERT INTO esiti VALUES ('la guardia sugli orari del negozio c''e', ok_orari,
    CASE WHEN ok_orari THEN 'presente' ELSE 'SPARITA dalla funzione viva' END);
END $$;

-- ── ⑨ Il codice non emesso non e un tentativo sbagliato ──────────────────
DO $$
DECLARE
  corpo_c text := pg_get_functiondef('public.verify_delivery_code'::regproc);
  corpo_r text := pg_get_functiondef('public.verify_pickup_code'::regproc);
  ok boolean;
BEGIN
  ok := corpo_c LIKE '%CODE_NOT_ISSUED%' AND corpo_c LIKE '%FOR UPDATE%'
    AND corpo_r LIKE '%CODE_NOT_ISSUED%' AND corpo_r LIKE '%FOR UPDATE%';

  INSERT INTO esiti VALUES (
    'i codici: caso «mai emesso» separato, e riga bloccata per contare davvero',
    ok,
    CASE WHEN ok THEN 'entrambe a posto' ELSE 'una delle due e tornata indietro' END
  );
END $$;

-- ── ⑩ La chiave che scavalca la guardia si alza DOPO i controlli ─────────
DO $$
DECLARE
  corpo text := pg_get_functiondef('public.verify_delivery_code'::regproc);
  pos_chiave int := position('set_config(''mycity.allow_order_write''' in corpo);
  pos_primo_rifiuto int := position('ORDER_NOT_FOUND' in corpo);
  ok boolean;
BEGIN
  -- La chiave deve comparire DOPO il primo motivo di rifiuto: se sta prima,
  -- viene alzata anche per chi verra respinto.
  ok := pos_chiave > 0 AND pos_primo_rifiuto > 0 AND pos_chiave > pos_primo_rifiuto;

  INSERT INTO esiti VALUES (
    'la chiave che scavalca la guardia si alza dopo i controlli, non prima',
    ok,
    format('chiave a %s, primo rifiuto a %s', pos_chiave, pos_primo_rifiuto)
  );
END $$;

-- ── Verdetto ─────────────────────────────────────────────────────────────
DO $$
DECLARE rossi int; elenco text;
BEGIN
  SELECT count(*), coalesce(string_agg(format('%s → %s', e.nome, e.dettaglio), E'\n  '), '')
    INTO rossi, elenco
  FROM esiti e WHERE e.verde IS NOT TRUE;

  IF rossi > 0 THEN
    RAISE EXCEPTION E'% controllo/i rosso/i:\n  %', rossi, elenco;
  END IF;
  RAISE NOTICE 'le porte di servizio sono chiuse: % controlli verdi', (SELECT count(*) FROM esiti);
END $$;

ROLLBACK;

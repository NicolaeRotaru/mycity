-- ============================================================================
-- 17/10/2026 — NESSUNA COLONNA TIENE L'IBAN DEL RIMBORSO.
--
-- Decisione di Nicola («Semplifica»): chi ha pagato in contanti riavrà i soldi
-- con un bonifico fatto a mano, e l'IBAN lo manda rispondendo all'email del
-- rimborso. La migrazione 162 (IBAN e intestatario sul reso, la tabella dei
-- bonifici dei reclami) è stata tolta, e l'informativa adesso dice: «nel nostro
-- database non c'è un campo per l'IBAN del rimborso».
--
-- Questa prova guarda lo schema ricostruito dalle migrazioni vere e pretende
-- che l'unica colonna con un IBAN o un intestatario sia quella del Venditore
-- (profiles.billing_iban, migrazione 021: il conto dove riceve i payout).
-- Rimetti la 162 e torna rossa.
-- ============================================================================
BEGIN;

CREATE TEMP TABLE esiti (nome text, verde boolean, dettaglio text) ON COMMIT DROP;

-- ── ① Nessuna colonna per l'IBAN o l'intestatario, fuori da quella del Venditore ─
DO $$
DECLARE
  n int;
  colonne text;
BEGIN
  SELECT count(*), coalesce(string_agg(format('%s.%s', c.table_name, c.column_name), ', ' ORDER BY c.table_name, c.column_name), '—')
    INTO n, colonne
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND (c.column_name ILIKE '%iban%' OR c.column_name ILIKE '%intestatario%')
    AND NOT (c.table_name = 'profiles' AND c.column_name = 'billing_iban');

  INSERT INTO esiti VALUES (
    'nessuna colonna tiene l''IBAN o l''intestatario di un rimborso',
    n = 0,
    format('trovate %s colonne: %s', n, colonne)
  );
END $$;

-- ── ② La controprova: la ricerca vede davvero le colonne ─────────────────────
-- Senza questa, uno schema vuoto o un filtro sbagliato darebbe un verde muto.
DO $$
DECLARE presente boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = 'profiles'
      AND c.column_name = 'billing_iban'
  ) INTO presente;

  INSERT INTO esiti VALUES (
    'la ricerca trova la colonna del Venditore',
    presente,
    CASE WHEN presente THEN 'profiles.billing_iban trovata' ELSE 'NON trovata: la prova non sta guardando niente' END
  );
END $$;

-- ── Verdetto ───────────────────────────────────────────────────────────────
DO $$
DECLARE rossi int; elenco text;
BEGIN
  SELECT count(*), coalesce(string_agg(format('%s → %s', e.nome, e.dettaglio), E'\n  '), '')
    INTO rossi, elenco
  FROM esiti e WHERE e.verde IS NOT TRUE;

  IF rossi > 0 THEN
    RAISE EXCEPTION E'% controllo/i rosso/i:\n  %', rossi, elenco;
  END IF;
  RAISE NOTICE 'nessuna colonna tiene l''IBAN del rimborso: % controlli verdi', (SELECT count(*) FROM esiti);
END $$;

ROLLBACK;

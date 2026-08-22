-- ============================================================================
-- 22/8/2026 — UN GUARDIANO PER TABELLA, NON DUE.
--
-- La migrazione 061 aveva creato `trg_enforce_profile_update`. La 119 ha
-- riscritto la funzione e creato `trg_enforce_profile_update_rules`, facendo il
-- DROP solo del nome nuovo. Sono rimasti due trigger BEFORE UPDATE su
-- `public.profiles` che chiamano la stessa funzione: la regola girava due volte
-- a ogni salvataggio di un profilo.
--
-- Questa prova conta i trigger e pretende che sia uno solo. Ricrea il trigger
-- vecchio e torna rossa.
-- ============================================================================
BEGIN;

CREATE TEMP TABLE esiti (nome text, verde boolean, dettaglio text) ON COMMIT DROP;

-- ── ① Un solo trigger BEFORE UPDATE su profiles che invoca la regola ────────
DO $$
DECLARE
  n int;
  nomi text;
BEGIN
  SELECT count(*), coalesce(string_agg(t.tgname, ', ' ORDER BY t.tgname), '—')
    INTO n, nomi
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace ns ON ns.oid = c.relnamespace
  JOIN pg_proc p ON p.oid = t.tgfoid
  WHERE ns.nspname = 'public'
    AND c.relname = 'profiles'
    AND NOT t.tgisinternal
    AND p.proname = 'enforce_profile_update_rules';

  INSERT INTO esiti VALUES (
    'un solo guardiano enforce_profile_update_rules su profiles',
    n = 1,
    format('trovati %s trigger: %s', n, nomi)
  );
END $$;

-- ── ② Il vecchio nome non esiste più ───────────────────────────────────────
DO $$
DECLARE presente boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public'
      AND c.relname = 'profiles'
      AND t.tgname = 'trg_enforce_profile_update'
  ) INTO presente;

  INSERT INTO esiti VALUES (
    'il trigger vecchio trg_enforce_profile_update non c''è più',
    NOT presente,
    CASE WHEN presente THEN 'c''è ancora: la 127 non è stata applicata' ELSE 'tolto' END
  );
END $$;

-- ── ③ La regola però c'è ancora: non ho spento il controllo ────────────────
DO $$
DECLARE presente boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public'
      AND c.relname = 'profiles'
      AND t.tgname = 'trg_enforce_profile_update_rules'
  ) INTO presente;

  INSERT INTO esiti VALUES (
    'la regola sui profili è ancora montata',
    presente,
    CASE WHEN presente THEN 'presente' ELSE 'SPARITA: ho tolto il controllo, non il doppione' END
  );
END $$;

-- ── Verdetto ───────────────────────────────────────────────────────────────
DO $$
DECLARE rossi int; elenco text;
BEGIN
  SELECT count(*), coalesce(string_agg(format('%s → %s', e.nome, e.dettaglio), E'\n  '), '')
    INTO rossi, elenco
  FROM esiti e WHERE NOT e.verde;

  IF rossi > 0 THEN
    RAISE EXCEPTION E'% controllo/i rosso/i:\n  %', rossi, elenco;
  END IF;
  RAISE NOTICE 'un solo guardiano per tabella: % controlli verdi', (SELECT count(*) FROM esiti);
END $$;

ROLLBACK;

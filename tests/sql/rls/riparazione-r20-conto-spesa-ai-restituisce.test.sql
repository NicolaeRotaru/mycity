-- =============================================================================
-- R20-002 (26/11/2026) — Il conto della spesa AI restituisce le prenotazioni
-- =============================================================================
-- In rete ogni chiamata al modello prenota la sua stima nel conto condiviso
-- (`registra_spesa_ai(giorno, stima)`), e a chiamata finita la restituisce
-- aggiungendo un numero negativo. Prima della migrazione 980 la funzione
-- ignorava i negativi: ogni prenotazione restava nel conto per sempre. Qui:
--   ① un negativo fa scendere il conto, e mai sotto zero;
--   ② la prenotazione di due copie a 99 su 100: la seconda vede la prima, la
--      restituisce, e il conto torna a 100 (non resta a 101);
--   ③ la funzione resta del solo server (SECURITY DEFINER, search_path fisso,
--      niente PUBLIC/anon/authenticated).
-- Senza la migrazione 980 questo file è ROSSO. Tutto in transazione, ROLLBACK.
-- =============================================================================

BEGIN;

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;

-- ── ① Un negativo restituisce, mai sotto zero ────────────────────────────────
DO $$
DECLARE dopo_spesa bigint; dopo_resa bigint; dopo_troppo bigint; letto bigint;
BEGIN
  dopo_spesa := public.registra_spesa_ai(DATE '2031-03-01', 100);
  dopo_resa := public.registra_spesa_ai(DATE '2031-03-01', -30);
  letto := public.spesa_ai_di_oggi(DATE '2031-03-01');
  INSERT INTO esiti VALUES ('una prenotazione restituita fa scendere il conto',
    dopo_spesa = 100 AND dopo_resa = 70 AND letto = 70,
    format('dopo la spesa %s, dopo la resa %s, letto %s', dopo_spesa, dopo_resa, letto));

  dopo_troppo := public.registra_spesa_ai(DATE '2031-03-01', -1000);
  INSERT INTO esiti VALUES ('restituire piu del conto lo porta a zero, non sotto',
    dopo_troppo = 0, format('dopo la resa grande %s', dopo_troppo));

  -- Un giorno senza riga: un negativo non crea un conto negativo.
  INSERT INTO esiti VALUES ('un negativo su un giorno nuovo resta a zero',
    public.registra_spesa_ai(DATE '2031-03-02', -5) = 0, 'giorno nuovo');
END $$;

-- ── ② Due copie a 99 su 100, una stima di 1 a testa ──────────────────────────
DO $$
DECLARE tetto bigint := 100; prima bigint; seconda bigint; finale bigint;
BEGIN
  PERFORM public.registra_spesa_ai(DATE '2031-03-03', 99);
  prima := public.registra_spesa_ai(DATE '2031-03-03', 1);    -- la copia A prenota
  seconda := public.registra_spesa_ai(DATE '2031-03-03', 1);  -- la copia B prenota
  IF seconda > tetto THEN
    PERFORM public.registra_spesa_ai(DATE '2031-03-03', -1);  -- B oltre il tetto: restituisce
  END IF;
  finale := public.spesa_ai_di_oggi(DATE '2031-03-03');
  INSERT INTO esiti VALUES ('di due copie a 99 su 100 passa solo la prima, e il conto resta al tetto',
    prima = 100 AND seconda = 101 AND finale = 100,
    format('A vede %s, B vede %s, alla fine %s', prima, seconda, finale));
END $$;

-- ── ③ Del solo server ────────────────────────────────────────────────────────
INSERT INTO esiti
SELECT 'registra_spesa_ai: SECURITY DEFINER con search_path fisso, non eseguibile da PUBLIC/anon/authenticated',
       count(*) = 1 AND bool_and(
         p.prosecdef
         AND coalesce(p.proconfig::text, '') LIKE '%search_path=%'
         AND p.proacl IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
         AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
         AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
         AND has_function_privilege('service_role', p.oid, 'EXECUTE')),
       string_agg(p.oid::regprocedure::text || ' acl=' || coalesce(p.proacl::text, 'predefinita'), ', ')
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'registra_spesa_ai';

-- ── Verdetto ──────────────────────────────────────────────────────────────────
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

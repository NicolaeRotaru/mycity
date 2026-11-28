-- =============================================================================
-- R02-002 (onda 2) — La spesa AI si prenota nel conto condiviso (migrations/999l)
-- =============================================================================
-- Tetto 100 centesimi.
--   ① 60 entra (totale 60); 50 non ci sta: -1 e niente scritto;
--   ② 40 entra giusto (100); poi nemmeno un centesimo (una prenotazione da 0 vale 1);
--   ③ restituire toglie, mai sotto zero; un giorno senza riga torna 0;
--   ④ anon e authenticated non chiamano le due funzioni; service_role si'.
-- Tutto in transazione, ROLLBACK.
-- =============================================================================

BEGIN;

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;

DELETE FROM public.ai_spend_daily WHERE giorno = DATE '2031-01-15';

INSERT INTO esiti SELECT '① 60 su un tetto di 100 entra',
  public.prenota_spesa_ai(DATE '2031-01-15', 60, 100) = 60, '';
INSERT INTO esiti SELECT '① 50 non ci sta: -1',
  public.prenota_spesa_ai(DATE '2031-01-15', 50, 100) = -1, '';
INSERT INTO esiti SELECT '① la prenotazione rifiutata non ha scritto niente',
  public.spesa_ai_di_oggi(DATE '2031-01-15') = 60, public.spesa_ai_di_oggi(DATE '2031-01-15')::text;
INSERT INTO esiti SELECT '② 40 entra giusto fino al tetto',
  public.prenota_spesa_ai(DATE '2031-01-15', 40, 100) = 100, '';
INSERT INTO esiti SELECT '② a tetto pieno nemmeno una prenotazione da zero (vale un centesimo)',
  public.prenota_spesa_ai(DATE '2031-01-15', 0, 100) = -1, '';
INSERT INTO esiti SELECT '③ restituire 40 riporta il conto a 60',
  public.restituisci_spesa_ai(DATE '2031-01-15', 40) = 60, '';
INSERT INTO esiti SELECT '③ restituire piu del conto non scende sotto zero',
  public.restituisci_spesa_ai(DATE '2031-01-15', 999) = 0, '';
INSERT INTO esiti SELECT '③ un giorno senza riga torna 0',
  public.restituisci_spesa_ai(DATE '2031-01-16', 5) = 0, '';

INSERT INTO esiti SELECT '④ anon non prenota',
  NOT has_function_privilege('anon', 'public.prenota_spesa_ai(date, bigint, bigint)', 'EXECUTE'), '';
INSERT INTO esiti SELECT '④ authenticated non prenota',
  NOT has_function_privilege('authenticated', 'public.prenota_spesa_ai(date, bigint, bigint)', 'EXECUTE'), '';
INSERT INTO esiti SELECT '④ anon non restituisce',
  NOT has_function_privilege('anon', 'public.restituisci_spesa_ai(date, bigint)', 'EXECUTE'), '';
INSERT INTO esiti SELECT '④ authenticated non restituisce',
  NOT has_function_privilege('authenticated', 'public.restituisci_spesa_ai(date, bigint)', 'EXECUTE'), '';
INSERT INTO esiti SELECT '④ service_role prenota e restituisce',
  has_function_privilege('service_role', 'public.prenota_spesa_ai(date, bigint, bigint)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.restituisci_spesa_ai(date, bigint)', 'EXECUTE'), '';

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

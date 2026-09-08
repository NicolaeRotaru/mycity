-- =============================================================================
-- Il registro attività non si copia il cognome legale (né il messaggio del buono)
-- =============================================================================
-- Il trigger `log_activity_change` scrive in `activity_events.metadata.changed`
-- il valore VECCHIO e quello NUOVO di ogni colonna cambiata, e oscura solo
-- quelle che `activity_key_sensibile` riconosce. La lista aveva `full_name`,
-- `nome`, `cognome` — e non aveva `first_name` né `last_name`: l'identità legale
-- di negozianti e fattorini finiva nel registro in chiaro, e ci restava
-- quattordici mesi anche dopo la cancellazione dell'account.
--
-- Qui si aggiorna DAVVERO ogni colonna personale e si guarda cosa è finito nel
-- registro. Non si cerca una parola in un file: si scrive nel database e si
-- rilegge quello che c'è dentro.
--
-- La regola sta in migrations/155. La stessa decisione è provata anche senza
-- database da tests/unit/il-registro-attivita-non-copia-il-cognome-legale.test.ts,
-- che rilegge le due espressioni dal file di migrazione e le esegue.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('a1111111-1111-1111-1111-111111111111', 'fattorino32@test.it', '{"role":"rider"}');

-- =============================================================================
-- 1. L'identità legale: nome, cognome, codice fiscale
-- =============================================================================
UPDATE public.profiles
   SET legal_first_name = 'Mario',
       legal_last_name  = 'Rossi',
       legal_fiscal_code = 'RSSMRA80A01G535X'
 WHERE id = 'a1111111-1111-1111-1111-111111111111';

DO $$
DECLARE diff jsonb; testo text;
BEGIN
  SELECT metadata->'changed' INTO diff
    FROM public.activity_events
   WHERE target_table = 'profiles'
     AND target_id = 'a1111111-1111-1111-1111-111111111111'
     AND metadata ? 'changed'
   ORDER BY created_at DESC
   LIMIT 1;

  testo := coalesce(diff::text, '');

  INSERT INTO esiti VALUES (
    'il nome legale non finisce nel registro',
    position('Mario' in testo) = 0,
    CASE WHEN position('Mario' in testo) = 0 THEN 'oscurato'
         ELSE 'il registro contiene: ' || left(testo, 300) END);

  INSERT INTO esiti VALUES (
    'il cognome legale non finisce nel registro',
    position('Rossi' in testo) = 0,
    CASE WHEN position('Rossi' in testo) = 0 THEN 'oscurato'
         ELSE 'il registro contiene: ' || left(testo, 300) END);

  INSERT INTO esiti VALUES (
    'il codice fiscale non finisce nel registro',
    position('RSSMRA80A01G535X' in testo) = 0,
    CASE WHEN position('RSSMRA80A01G535X' in testo) = 0 THEN 'oscurato'
         ELSE 'il registro contiene: ' || left(testo, 300) END);

  -- Il registro deve restare utile: la CHIAVE si vede sempre, sparisce il
  -- valore. Una regola che nasconde anche il nome della colonna cambiata
  -- renderebbe il registro inservibile, ed è l'altro modo di sbagliare.
  INSERT INTO esiti VALUES (
    'si vede comunque QUALE campo è cambiato',
    diff ? 'legal_last_name',
    coalesce(left(testo, 200), 'nessun diff scritto'));
END $$;

-- =============================================================================
-- 2. Le prove caricate dal fattorino: assicurazione e HACCP
-- =============================================================================
UPDATE public.profiles
   SET rider_insurance_url = 'kyc-docs/a1111111/assicurazione-mario-rossi.pdf',
       rider_haccp_url     = 'kyc-docs/a1111111/haccp-mario-rossi.pdf'
 WHERE id = 'a1111111-1111-1111-1111-111111111111';

DO $$
DECLARE testo text;
BEGIN
  SELECT coalesce((metadata->'changed')::text, '') INTO testo
    FROM public.activity_events
   WHERE target_table = 'profiles'
     AND target_id = 'a1111111-1111-1111-1111-111111111111'
     AND metadata ? 'changed'
   ORDER BY created_at DESC
   LIMIT 1;

  INSERT INTO esiti VALUES (
    'il percorso dei documenti del fattorino non finisce nel registro',
    position('assicurazione-mario-rossi' in testo) = 0
      AND position('haccp-mario-rossi' in testo) = 0,
    left(testo, 300));
END $$;

-- =============================================================================
-- 3. Il buono regalo: nome, email e messaggio di chi non è nostro cliente
-- =============================================================================
INSERT INTO public.gift_cards (code, amount_cents, balance_cents, buyer_id)
VALUES ('TEST-32-AAAA', 5000, 5000, 'a1111111-1111-1111-1111-111111111111');

UPDATE public.gift_cards
   SET recipient_name  = 'Anna Bianchi',
       recipient_email = 'anna.bianchi@example.it',
       message         = 'Buon compleanno, ti voglio bene'
 WHERE code = 'TEST-32-AAAA';

DO $$
DECLARE testo text;
BEGIN
  SELECT coalesce((metadata->'changed')::text, '') INTO testo
    FROM public.activity_events
   WHERE target_table = 'gift_cards'
     AND metadata ? 'changed'
   ORDER BY created_at DESC
   LIMIT 1;

  INSERT INTO esiti VALUES (
    'il destinatario del buono regalo non finisce nel registro',
    position('Anna Bianchi' in testo) = 0
      AND position('anna.bianchi@example.it' in testo) = 0,
    left(testo, 300));

  INSERT INTO esiti VALUES (
    'il messaggio privato non finisce nel registro',
    position('ti voglio bene' in testo) = 0,
    left(testo, 300));
END $$;

RESET mycity.allow_profile_write;

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
    RAISE EXCEPTION '% controlli su % sono rossi', rossi, (SELECT count(*) FROM esiti);
  END IF;
  RAISE INFO 'tutti verdi: % controlli', (SELECT count(*) FROM esiti);
END $$;

ROLLBACK;

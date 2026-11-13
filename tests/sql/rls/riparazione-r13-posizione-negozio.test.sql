-- =============================================================================
-- R13-006 — LA POSIZIONE DEL NEGOZIO NON FINISCE LONTANO DA PIACENZA.
-- =============================================================================
-- Il profilo del negozio scrive le coordinate dal browser, coi permessi del
-- negozio. Un punto trovato in un'altra città (Roma) passava, e il negozio non
-- riceveva più ordini. Qui si fa il tentativo vero, coi permessi veri.
-- Togli la migrazione 377 e la prova torna rossa.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('13006000-0000-0000-0000-000000000001', 'negozio-r13@test.it', '{"role":"seller"}'),
  ('13006000-0000-0000-0000-000000000002', 'negozio-vecchio-r13@test.it', '{"role":"seller"}');

UPDATE public.profiles
   SET is_approved = true, approval_status = 'approved', store_name = 'Bottega R13',
       store_address = 'Via Roma 1, Piacenza', store_lat = 45.05, store_lng = 9.69
 WHERE id = '13006000-0000-0000-0000-000000000001';

-- Un negozio salvato prima della regola sul vecchio punto di Roma: la riga c'è già.
ALTER TABLE public.profiles DISABLE TRIGGER USER;
UPDATE public.profiles
   SET is_approved = true, approval_status = 'approved', store_name = 'Bottega vecchia R13',
       store_address = 'Via Cavour 3', store_lat = 41.9028, store_lng = 12.4964
 WHERE id = '13006000-0000-0000-0000-000000000002';
ALTER TABLE public.profiles ENABLE TRIGGER USER;

RESET mycity.allow_profile_write;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"13006000-0000-0000-0000-000000000001","role":"authenticated"}';

-- ① Il negozio prova a salvarsi a Roma dal suo profilo: rifiutato.
DO $$
DECLARE rifiutato boolean := false; codice text := '—';
BEGIN
  BEGIN
    UPDATE public.profiles SET store_address = 'Via Roma 12', store_lat = 41.9, store_lng = 12.49
     WHERE id = '13006000-0000-0000-0000-000000000001';
  EXCEPTION WHEN OTHERS THEN
    rifiutato := true;
    codice := SQLSTATE;
  END;
  INSERT INTO esiti VALUES ('il negozio non si salva a Roma', rifiutato AND codice = '23514',
    format('rifiutato=%s codice=%s', rifiutato, codice));
END $$;

-- ② Si sposta dentro Piacenza: passa.
DO $$
DECLARE passato boolean := true; messaggio text := 'ok';
BEGIN
  BEGIN
    UPDATE public.profiles SET store_address = 'Via Calzolai 5, Piacenza', store_lat = 45.0515, store_lng = 9.6942
     WHERE id = '13006000-0000-0000-0000-000000000001';
  EXCEPTION WHEN OTHERS THEN
    passato := false;
    messaggio := SQLERRM;
  END;
  INSERT INTO esiti VALUES ('una posizione in centro si salva', passato, messaggio);
END $$;

-- ③ Il negozio salvato prima della regola cambia solo il telefono, con la posizione di sempre: passa.
SET LOCAL request.jwt.claims = '{"sub":"13006000-0000-0000-0000-000000000002","role":"authenticated"}';
DO $$
DECLARE passato boolean := true; messaggio text := 'ok';
BEGIN
  BEGIN
    UPDATE public.profiles SET store_phone = '3331234567', store_lat = 41.9028, store_lng = 12.4964
     WHERE id = '13006000-0000-0000-0000-000000000002';
  EXCEPTION WHEN OTHERS THEN
    passato := false;
    messaggio := SQLERRM;
  END;
  INSERT INTO esiti VALUES ('chi non cambia la posizione salva telefono e orari', passato, messaggio);
END $$;

-- ④ Nemmeno la chiave di servizio mette un negozio a Milano.
RESET ROLE;
DO $$
DECLARE rifiutato boolean := false; codice text := '—';
BEGIN
  BEGIN
    UPDATE public.profiles SET store_lat = 45.4642, store_lng = 9.19
     WHERE id = '13006000-0000-0000-0000-000000000001';
  EXCEPTION WHEN OTHERS THEN
    rifiutato := true;
    codice := SQLSTATE;
  END;
  INSERT INTO esiti VALUES ('nemmeno dal server un negozio va a Milano', rifiutato AND codice = '23514',
    format('rifiutato=%s codice=%s', rifiutato, codice));
END $$;

-- Verdetto
DO $$
DECLARE rossi int; elenco text;
BEGIN
  SELECT count(*), coalesce(string_agg(format('%s → %s', e.nome, e.dettaglio), E'\n  '), '')
    INTO rossi, elenco
  FROM esiti e WHERE e.ok IS NOT TRUE;
  IF rossi > 0 THEN
    RAISE EXCEPTION E'% controllo/i rosso/i:\n  %', rossi, elenco;
  END IF;
  RAISE NOTICE 'la posizione del negozio sta a Piacenza: % controlli verdi', (SELECT count(*) FROM esiti);
END $$;

ROLLBACK;

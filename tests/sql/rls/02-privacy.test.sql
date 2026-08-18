-- =============================================================================
-- Privacy — cosa si legge di una persona, e cosa resta scritto di lei
-- =============================================================================
-- Gira dopo tests/sql/harness/apply.sh. Transazione con ROLLBACK finale.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';
SET LOCAL mycity.allow_order_write   = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('11111111-1111-1111-1111-111111111111', 'negozio2@test.it',  '{"role":"seller"}'),
  ('22222222-2222-2222-2222-222222222222', 'fattorino2@test.it', '{"role":"rider"}'),
  ('33333333-3333-3333-3333-333333333333', 'cliente2@test.it',   '{"role":"buyer"}');

UPDATE public.profiles
   SET is_approved = true, approval_status = 'approved', store_name = 'Bottega'
 WHERE id = '11111111-1111-1111-1111-111111111111';
UPDATE public.profiles
   SET is_approved = true, approval_status = 'approved'
 WHERE id = '22222222-2222-2222-2222-222222222222';

-- Il cliente, coi suoi dati delicati addosso.
UPDATE public.profiles
   SET full_name = 'Maria Rossi', phone = '3331234567',
       legal_fiscal_code = 'RSSMRA80A01G535X', billing_iban = 'IT60X0542811101000000123456'
 WHERE id = '33333333-3333-3333-3333-333333333333';

-- Un ordine consegnato dal fattorino, con una recensione al fattorino.
INSERT INTO public.orders (id, user_id, seller_id, rider_id, total_price, payment_status, delivery_status,
                           delivery_full_name, delivery_phone, delivery_address)
VALUES ('d0000000-0000-0000-0000-00000000000d',
        '33333333-3333-3333-3333-333333333333',
        '11111111-1111-1111-1111-111111111111',
        '22222222-2222-2222-2222-222222222222',
        20.00, 'PAID', 'DELIVERED', 'Maria Rossi', '3331234567', 'Via Verdi 10');

INSERT INTO public.rider_reviews (rider_id, user_id, order_id, rating, comment)
VALUES ('22222222-2222-2222-2222-222222222222',
        '33333333-3333-3333-3333-333333333333',
        'd0000000-0000-0000-0000-00000000000d', 5, 'gentilissimo');

-- Una conversazione col messaggio del cliente.
INSERT INTO public.conversations (id, buyer_id, seller_id)
VALUES ('e0000000-0000-0000-0000-00000000000e',
        '33333333-3333-3333-3333-333333333333',
        '11111111-1111-1111-1111-111111111111');
INSERT INTO public.messages (id, conversation_id, sender_id, body)
VALUES ('f0000000-0000-0000-0000-00000000000f',
        'e0000000-0000-0000-0000-00000000000e',
        '33333333-3333-3333-3333-333333333333',
        'Buongiorno, l''ordine è per stasera?');

RESET mycity.allow_profile_write;
RESET mycity.allow_order_write;

-- =============================================================================
-- 1. Il fattorino non deve leggere codice fiscale e IBAN del suo cliente
-- =============================================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.profiles
   WHERE id = '33333333-3333-3333-3333-333333333333';
  INSERT INTO esiti VALUES ('il fattorino non legge la scheda del cliente', n = 0,
    'righe del cliente visibili al fattorino: ' || n || ' (la riga porta legal_fiscal_code e billing_iban)');
END $$;
RESET ROLE;
RESET request.jwt.claims;

-- =============================================================================
-- 2. Ma deve vedere le sue recensioni, col nome di chi le ha scritte
-- =============================================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
DO $$
DECLARE nome text; n int;
BEGIN
  SELECT count(*), min(autore_nome) INTO n, nome FROM public.rider_reviews_ricevute;
  INSERT INTO esiti VALUES ('il fattorino vede le sue recensioni col nome',
    n = 1 AND nome = 'Maria',
    'recensioni: ' || n || ' · nome mostrato: ' || coalesce(nome, 'nessuno'));
END $$;
RESET ROLE;
RESET request.jwt.claims;

-- =============================================================================
-- 3. Nella chat nessuno riscrive il messaggio di un altro
-- =============================================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
DO $$
DECLARE tocc int;
BEGIN
  BEGIN
    UPDATE public.messages SET body = 'testo riscritto dal negoziante'
     WHERE id = 'f0000000-0000-0000-0000-00000000000f';
    GET DIAGNOSTICS tocc = ROW_COUNT;
    INSERT INTO esiti VALUES ('il messaggio dell''altro non si riscrive', tocc = 0,
      'messaggi riscritti: ' || tocc);
  EXCEPTION WHEN others THEN
    INSERT INTO esiti VALUES ('il messaggio dell''altro non si riscrive', SQLSTATE = '42501',
      'errore ' || SQLSTATE);
  END;
END $$;
RESET ROLE;
RESET request.jwt.claims;

-- =============================================================================
-- 4. «L'ho letto» funziona ancora, tramite la funzione dedicata
-- =============================================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
DO $$
DECLARE n int;
BEGIN
  BEGIN
    SELECT public.mark_conversation_read('e0000000-0000-0000-0000-00000000000e') INTO n;
    INSERT INTO esiti VALUES ('segnare come letto funziona', n = 1,
      'messaggi segnati come letti: ' || n);
  EXCEPTION WHEN others THEN
    INSERT INTO esiti VALUES ('segnare come letto funziona', false,
      'errore ' || SQLSTATE || ': ' || SQLERRM);
  END;
END $$;
RESET ROLE;
RESET request.jwt.claims;

-- =============================================================================
-- 5. Una conversazione di altri non si segna come letta
-- =============================================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
DO $$
BEGIN
  BEGIN
    PERFORM public.mark_conversation_read('e0000000-0000-0000-0000-00000000000e');
    INSERT INTO esiti VALUES ('la chat di altri resta chiusa', false,
      'un estraneo alla conversazione ha potuto segnarla come letta');
  EXCEPTION WHEN others THEN
    INSERT INTO esiti VALUES ('la chat di altri resta chiusa', SQLSTATE = '42501',
      'respinto: ' || SQLSTATE);
  END;
END $$;
RESET ROLE;
RESET request.jwt.claims;

-- =============================================================================
-- 6. Il registro delle attività non conserva telefono e indirizzo in chiaro
-- =============================================================================
SET LOCAL mycity.allow_profile_write = '1';
UPDATE public.profiles
   SET phone = '3339999999', full_name = 'Maria Bianchi'
 WHERE id = '33333333-3333-3333-3333-333333333333';
RESET mycity.allow_profile_write;

DO $$
DECLARE trovati text := ''; ev record;
BEGIN
  FOR ev IN
    SELECT metadata FROM public.activity_events
     WHERE metadata::text LIKE '%3339999999%' OR metadata::text LIKE '%Maria Bianchi%'
  LOOP
    trovati := trovati || 'una riga con dati in chiaro ';
  END LOOP;
  INSERT INTO esiti VALUES ('il registro non conserva telefono e nome in chiaro',
    trovati = '',
    CASE WHEN trovati = '' THEN 'oscurati' ELSE trovati END);
END $$;

-- =============================================================================
-- 7. Alla newsletter non si iscrive nessuno dal browser
-- =============================================================================
SET LOCAL ROLE anon;
DO $$
BEGIN
  BEGIN
    INSERT INTO public.newsletter_subscribers (email) VALUES ('vittima@altrui.it');
    INSERT INTO esiti VALUES ('alla newsletter si iscrive solo il server', false,
      'un anonimo ha iscritto l''indirizzo di un altro');
  EXCEPTION WHEN others THEN
    INSERT INTO esiti VALUES ('alla newsletter si iscrive solo il server', SQLSTATE = '42501',
      'respinto: ' || SQLSTATE);
  END;
END $$;
RESET ROLE;

-- =============================================================================
-- 8. Il registro dei consensi esiste e non è manomettibile dal browser
-- =============================================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';
DO $$
BEGIN
  BEGIN
    INSERT INTO public.consent_log (user_id, categoria, valore)
    VALUES ('33333333-3333-3333-3333-333333333333', 'analytics', true);
    INSERT INTO esiti VALUES ('il consenso lo scrive solo il server', false,
      'un utente ha scritto da sé nel registro dei consensi');
  EXCEPTION WHEN others THEN
    INSERT INTO esiti VALUES ('il consenso lo scrive solo il server', SQLSTATE = '42501',
      'respinto: ' || SQLSTATE);
  END;
END $$;
RESET ROLE;
RESET request.jwt.claims;

-- =============================================================================
-- Verdetto
-- =============================================================================
DO $$
DECLARE r record; rossi int;
BEGIN
  FOR r IN SELECT * FROM esiti ORDER BY nome LOOP
    RAISE INFO '%  %  — %', CASE WHEN r.ok THEN 'ok  ' ELSE 'ROTTO' END, r.nome, r.dettaglio;
  END LOOP;
  SELECT count(*) INTO rossi FROM esiti WHERE NOT ok;
  IF rossi > 0 THEN
    RAISE EXCEPTION '% controlli su % sono rossi', rossi, (SELECT count(*) FROM esiti);
  END IF;
  RAISE INFO 'tutti verdi: % controlli', (SELECT count(*) FROM esiti);
END $$;

ROLLBACK;

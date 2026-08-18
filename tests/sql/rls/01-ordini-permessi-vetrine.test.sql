-- =============================================================================
-- Ordini, permessi e vetrine pubbliche — cosa può fare chi non dovrebbe
-- =============================================================================
-- Gira contro un database ricostruito dalle migrazioni vere:
--   tests/sql/harness/apply.sh mycity_test
--   tests/sql/harness/run.sh   mycity_test
--
-- Ogni controllo è un comportamento, non una parola cercata in un file: apre
-- una sessione col ruolo di un estraneo e prova a fare il danno. Se il danno
-- riesce, il controllo è rosso.
--
-- Tutto in una transazione con ROLLBACK finale: non lascia niente dietro.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';
SET LOCAL mycity.allow_order_write   = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated;

-- ------------------------------------------------------------------ personaggi
-- Il negoziante, il fattorino, il cliente e un estraneo con un account.
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('11111111-1111-1111-1111-111111111111', 'negozio@test.it',  '{"role":"seller"}'),
  ('22222222-2222-2222-2222-222222222222', 'fattorino@test.it', '{"role":"rider"}'),
  ('33333333-3333-3333-3333-333333333333', 'cliente@test.it',   '{"role":"buyer"}'),
  ('44444444-4444-4444-4444-444444444444', 'estraneo@test.it',  '{"role":"buyer"}'),
  ('55555555-5555-5555-5555-555555555555', 'altronegozio@test.it', '{"role":"seller"}');

-- Il negoziante e il fattorino sono approvati dallo staff (qui a mano).
UPDATE public.profiles
   SET is_approved = true, approval_status = 'approved', store_name = 'Bottega di prova'
 WHERE id IN ('11111111-1111-1111-1111-111111111111', '55555555-5555-5555-5555-555555555555');
UPDATE public.profiles
   SET is_approved = true, approval_status = 'approved'
 WHERE id = '22222222-2222-2222-2222-222222222222';

-- Un ordine pronto, senza fattorino assegnato, con i dati di casa del cliente.
INSERT INTO public.orders (
  id, user_id, seller_id, total_price, payment_status, delivery_status,
  delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip
) VALUES (
  'a0000000-0000-0000-0000-00000000000a',
  '33333333-3333-3333-3333-333333333333',
  '11111111-1111-1111-1111-111111111111',
  42.00, 'PAID', 'READY',
  'Maria Rossi', '3331234567', 'Via Verdi 10', 'Piacenza', '29121'
);

-- Un ordine consegnato del cliente, per la prova sulle recensioni.
INSERT INTO public.orders (
  id, user_id, seller_id, total_price, payment_status, delivery_status
) VALUES (
  'b0000000-0000-0000-0000-00000000000b',
  '33333333-3333-3333-3333-333333333333',
  '11111111-1111-1111-1111-111111111111',
  10.00, 'PAID', 'DELIVERED'
);

-- Un coupon attivo e una campagna sponsorizzata, per le prove di lettura.
INSERT INTO public.coupons (code, type, value, active)
VALUES ('PROVA10', 'PERCENT', 10, true);

-- Una campagna sponsorizzata attiva, coi suoi conti dentro.
INSERT INTO public.sponsored_listings (
  seller_id, placement, start_date, end_date,
  daily_budget_cents, spent_cents, impressions, clicks, status
) VALUES (
  '11111111-1111-1111-1111-111111111111', 'home_top',
  current_date - 1, current_date + 7, 5000, 1234, 900, 12, 'active'
);

RESET mycity.allow_profile_write;
RESET mycity.allow_order_write;

-- =============================================================================
-- 1. Un visitatore senza account non deve leggere gli ordini
-- =============================================================================
SET LOCAL ROLE anon;
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.orders;
  INSERT INTO esiti VALUES (
    'senza account non si leggono gli ordini', n = 0,
    'righe visibili: ' || n || ' (dentro ci sono nome, telefono e indirizzo di casa)');
END $$;
RESET ROLE;

-- =============================================================================
-- 2. Un visitatore senza account non deve modificare i dati di consegna
-- =============================================================================
SET LOCAL ROLE anon;
DO $$
DECLARE tocc int; det text;
BEGIN
  BEGIN
    UPDATE public.orders SET delivery_city = 'Dirottata'
     WHERE id = 'a0000000-0000-0000-0000-00000000000a';
    GET DIAGNOSTICS tocc = ROW_COUNT;
    det := 'righe modificate: ' || tocc;
    INSERT INTO esiti VALUES ('senza account non si tocca la consegna', tocc = 0, det);
  EXCEPTION WHEN others THEN
    -- Vale solo un rifiuto di sicurezza (42501). Qualsiasi altro errore è la
    -- macchina che si rompe prima di arrivare al punto pericoloso: non è una
    -- difesa, è un guasto che nasconde la falla.
    INSERT INTO esiti VALUES ('senza account non si tocca la consegna', SQLSTATE = '42501',
      CASE WHEN SQLSTATE = '42501' THEN 'respinto' ELSE 'errore ' || SQLSTATE || ': ' || SQLERRM END);
  END;
END $$;
RESET ROLE;

-- =============================================================================
-- 3. Un cliente qualunque non deve potersi prendere l'ordine di un altro
-- =============================================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';
DO $$
DECLARE tocc int;
BEGIN
  BEGIN
    UPDATE public.orders
       SET rider_id = '44444444-4444-4444-4444-444444444444', delivery_status = 'ASSIGNED'
     WHERE id = 'a0000000-0000-0000-0000-00000000000a';
    GET DIAGNOSTICS tocc = ROW_COUNT;
    INSERT INTO esiti VALUES ('solo un fattorino approvato prende un ordine', tocc = 0,
      'righe modificate da un cliente qualunque: ' || tocc);
  EXCEPTION WHEN others THEN
    INSERT INTO esiti VALUES ('solo un fattorino approvato prende un ordine', SQLSTATE = '42501',
      CASE WHEN SQLSTATE = '42501' THEN 'respinto' ELSE 'errore ' || SQLSTATE || ': ' || SQLERRM END);
  END;
END $$;
RESET ROLE;
RESET request.jwt.claims;

-- =============================================================================
-- 4. Il fattorino non deve scriversi da solo quanto farsi pagare
-- =============================================================================
SET LOCAL mycity.allow_order_write = '1';
UPDATE public.orders
   SET rider_id = '22222222-2222-2222-2222-222222222222', delivery_status = 'ASSIGNED'
 WHERE id = 'a0000000-0000-0000-0000-00000000000a';
RESET mycity.allow_order_write;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
DO $$
DECLARE tocc int;
BEGIN
  BEGIN
    UPDATE public.orders SET rider_fee_cents = 99000
     WHERE id = 'a0000000-0000-0000-0000-00000000000a';
    GET DIAGNOSTICS tocc = ROW_COUNT;
    INSERT INTO esiti VALUES ('il fattorino non si scrive il compenso', tocc = 0,
      'righe modificate: ' || tocc || ' (990 euro decisi da lui)');
  EXCEPTION WHEN others THEN
    INSERT INTO esiti VALUES ('il fattorino non si scrive il compenso', SQLSTATE = '42501',
      CASE WHEN SQLSTATE = '42501' THEN 'respinto' ELSE 'errore ' || SQLSTATE || ': ' || SQLERRM END);
  END;
END $$;
RESET ROLE;
RESET request.jwt.claims;

-- =============================================================================
-- 5. Rimborsi, credito e spese di consegna non si scrivono dal browser
-- =============================================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
DO $$
DECLARE tocc int; aperti text := '';
BEGIN
  BEGIN
    UPDATE public.orders SET refunded_amount_cents = 5000
     WHERE id = 'a0000000-0000-0000-0000-00000000000a';
    GET DIAGNOSTICS tocc = ROW_COUNT;
    IF tocc > 0 THEN aperti := aperti || 'refunded_amount_cents '; END IF;
  EXCEPTION WHEN others THEN
    IF SQLSTATE <> '42501' THEN aperti := aperti || 'refunded_amount_cents(' || SQLSTATE || ') '; END IF;
  END;
  BEGIN
    UPDATE public.orders SET wallet_applied_cents = 5000
     WHERE id = 'a0000000-0000-0000-0000-00000000000a';
    GET DIAGNOSTICS tocc = ROW_COUNT;
    IF tocc > 0 THEN aperti := aperti || 'wallet_applied_cents '; END IF;
  EXCEPTION WHEN others THEN
    IF SQLSTATE <> '42501' THEN aperti := aperti || 'wallet_applied_cents(' || SQLSTATE || ') '; END IF;
  END;
  BEGIN
    -- Un valore DIVERSO da quello presente, altrimenti la riga non cambia e
    -- l'aggiornamento passa senza provare niente.
    UPDATE public.orders SET delivery_fee_cents = 777
     WHERE id = 'a0000000-0000-0000-0000-00000000000a';
    GET DIAGNOSTICS tocc = ROW_COUNT;
    IF tocc > 0 THEN aperti := aperti || 'delivery_fee_cents '; END IF;
  EXCEPTION WHEN others THEN
    IF SQLSTATE <> '42501' THEN aperti := aperti || 'delivery_fee_cents(' || SQLSTATE || ') '; END IF;
  END;
  INSERT INTO esiti VALUES ('i campi dei soldi sono chiusi al browser', aperti = '',
    CASE WHEN aperti = '' THEN 'tutti chiusi' ELSE 'ancora scrivibili: ' || aperti END);
END $$;
RESET ROLE;
RESET request.jwt.claims;

-- =============================================================================
-- 6. Il negoziante DEVE poter far avanzare il suo ordine
--    (il difetto opposto: un campo cancellato nel trigger bloccava tutto)
-- =============================================================================
SET LOCAL mycity.allow_order_write = '1';
INSERT INTO public.orders (id, user_id, seller_id, total_price, payment_status, delivery_status)
VALUES ('c0000000-0000-0000-0000-00000000000c',
        '33333333-3333-3333-3333-333333333333',
        '11111111-1111-1111-1111-111111111111', 15.00, 'PAID', 'NEW');
RESET mycity.allow_order_write;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
DO $$
DECLARE tocc int;
BEGIN
  BEGIN
    UPDATE public.orders SET delivery_status = 'ACCEPTED', accepted_at = now()
     WHERE id = 'c0000000-0000-0000-0000-00000000000c';
    GET DIAGNOSTICS tocc = ROW_COUNT;
    INSERT INTO esiti VALUES ('il negoziante accetta il suo ordine', tocc = 1,
      'righe aggiornate: ' || tocc);
  EXCEPTION WHEN others THEN
    INSERT INTO esiti VALUES ('il negoziante accetta il suo ordine', false,
      'bloccato da: ' || SQLERRM);
  END;
END $$;
RESET ROLE;
RESET request.jwt.claims;

-- =============================================================================
-- 7. Chi si registra come venditore NON deve risultare già approvato
-- =============================================================================
INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES ('66666666-6666-6666-6666-666666666666', 'furbo@test.it', '{"role":"seller"}');
DO $$
DECLARE appr boolean; stato text;
BEGIN
  SELECT is_approved, approval_status INTO appr, stato
    FROM public.profiles WHERE id = '66666666-6666-6666-6666-666666666666';
  INSERT INTO esiti VALUES ('registrarsi non vale approvazione',
    appr IS NOT TRUE AND coalesce(stato, 'pending') = 'pending',
    'is_approved=' || coalesce(appr::text, 'null') || ' approval_status=' || coalesce(stato, 'null'));
END $$;

-- =============================================================================
-- 8. I codici sconto non si scaricano senza account
-- =============================================================================
SET LOCAL ROLE anon;
DO $$
DECLARE n int;
BEGIN
  BEGIN
    SELECT count(*) INTO n FROM public.coupons;
    INSERT INTO esiti VALUES ('i codici sconto non sono un elenco pubblico', n = 0,
      'coupon leggibili senza account: ' || n);
  EXCEPTION WHEN others THEN
    INSERT INTO esiti VALUES ('i codici sconto non sono un elenco pubblico', true,
      'respinto: ' || SQLSTATE);
  END;
END $$;
RESET ROLE;

-- =============================================================================
-- 9. I dati economici delle campagne sponsorizzate non sono pubblici
-- =============================================================================
SET LOCAL ROLE anon;
DO $$
DECLARE conti int := -1; annunci int := -1;
BEGIN
  BEGIN
    SELECT count(*) INTO conti FROM public.sponsored_listings;
  EXCEPTION WHEN others THEN conti := 0;   -- rifiutato: va bene
  END;
  BEGIN
    SELECT count(*) INTO annunci FROM public.sponsored_active_public;
  EXCEPTION WHEN others THEN annunci := -1;
  END;
  -- I conti no, l'annuncio sì: la vetrina deve continuare a mostrarlo.
  INSERT INTO esiti VALUES ('budget e speso delle campagne non sono pubblici',
    conti = 0 AND annunci = 1,
    'righe con i conti visibili: ' || conti || ' · annunci visibili: ' || annunci);
END $$;
RESET ROLE;

-- =============================================================================
-- 10. Le vetrine pubbliche non si riscrivono, e leggono con i permessi di chi chiama
-- =============================================================================
SET LOCAL ROLE anon;
DO $$
DECLARE tocc int;
BEGIN
  BEGIN
    UPDATE public.seller_public_profiles SET store_name = 'Nome rubato'
     WHERE id = '11111111-1111-1111-1111-111111111111';
    GET DIAGNOSTICS tocc = ROW_COUNT;
    INSERT INTO esiti VALUES ('la vetrina pubblica non si riscrive', tocc = 0,
      'righe modificate senza account: ' || tocc);
  EXCEPTION WHEN others THEN
    INSERT INTO esiti VALUES ('la vetrina pubblica non si riscrive', true,
      'respinto: ' || SQLSTATE);
  END;
END $$;
RESET ROLE;

-- Nessuna vista dello schema pubblico deve essere scrivibile da anon o da un
-- utente qualunque. Il controllo è su TUTTE le viste, non su un elenco scritto
-- a mano: i grant di default di Supabase rendono scrivibile ogni vista nuova,
-- quindi la prossima vista aggiunta da qualcuno fa diventare rosso questo
-- controllo invece di aprire un buco in silenzio.
DO $$
DECLARE scrivibili text;
BEGIN
  SELECT string_agg(DISTINCT table_name || ' (' || grantee || ')', ', ')
    INTO scrivibili
    FROM information_schema.role_table_grants g
   WHERE table_schema = 'public'
     AND grantee IN ('anon', 'authenticated')
     AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
     AND EXISTS (
       SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'v' AND c.relname = g.table_name
     );
  INSERT INTO esiti VALUES ('nessuna vista pubblica è scrivibile',
    scrivibili IS NULL,
    coalesce('ancora scrivibili: ' || scrivibili, 'tutte in sola lettura'));
END $$;

-- =============================================================================
-- 11. Non si recensisce un negozio da cui non si è comprato
-- =============================================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';
DO $$
DECLARE riuscito boolean := false;
BEGIN
  BEGIN
    INSERT INTO public.store_reviews (user_id, store_id, order_id, rating, comment)
    VALUES ('33333333-3333-3333-3333-333333333333',
            '55555555-5555-5555-5555-555555555555',   -- un ALTRO negozio
            'b0000000-0000-0000-0000-00000000000b', 1, 'mai comprato qui');
    riuscito := true;
  EXCEPTION WHEN others THEN riuscito := false;
  END;
  INSERT INTO esiti VALUES ('si recensisce solo il negozio da cui hai comprato', NOT riuscito,
    CASE WHEN riuscito THEN 'recensione a un negozio estraneo ACCETTATA'
         ELSE 'respinta' END);
END $$;
RESET ROLE;
RESET request.jwt.claims;

-- =============================================================================
-- 12. Nessuna policy lasciata aperta a tutti sulle tabelle con dati di persone
-- =============================================================================
DO $$
DECLARE aperte text;
BEGIN
  SELECT string_agg(tablename || '.' || policyname, ', ') INTO aperte
    FROM pg_policies
   WHERE schemaname = 'public'
     AND cmd = 'SELECT'
     AND coalesce(qual, '') IN ('true')
     AND tablename IN ('store_reviews', 'group_participants', 'reviews', 'orders', 'profiles');
  INSERT INTO esiti VALUES ('niente policy con "sempre vero" sui dati delle persone',
    aperte IS NULL, coalesce('ancora aperte: ' || aperte, 'nessuna'));
END $$;

-- =============================================================================
-- 13. La vista fantasma seller_storefronts non deve esistere
-- =============================================================================
DO $$
BEGIN
  INSERT INTO esiti VALUES ('nessuna vista fuori dalle migrazioni',
    to_regclass('public.seller_storefronts') IS NULL,
    CASE WHEN to_regclass('public.seller_storefronts') IS NULL THEN 'assente'
         ELSE 'presente: espone il codice invito di ogni negozio' END);
END $$;

-- =============================================================================
-- 14. Chiusa la porta, la funzione deve funzionare: il codice sconto si applica
--     ancora a chi ha un account
-- =============================================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';
DO $$
DECLARE r jsonb;
BEGIN
  BEGIN
    SELECT public.check_coupon('PROVA10', 100) INTO r;
    INSERT INTO esiti VALUES ('il codice sconto si applica ancora',
      (r ->> 'ok')::boolean AND (r ->> 'discount')::numeric = 10,
      'risposta: ' || coalesce(r::text, 'niente'));
  EXCEPTION WHEN others THEN
    INSERT INTO esiti VALUES ('il codice sconto si applica ancora', false,
      'errore ' || SQLSTATE || ': ' || SQLERRM);
  END;
END $$;
RESET ROLE;
RESET request.jwt.claims;

-- =============================================================================
-- 15. Senza account la funzione dei codici non si può nemmeno chiamare
-- =============================================================================
SET LOCAL ROLE anon;
DO $$
BEGIN
  BEGIN
    PERFORM public.check_coupon('PROVA10', 100);
    INSERT INTO esiti VALUES ('senza account non si provano i codici', false,
      'la funzione ha risposto a un anonimo');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO esiti VALUES ('senza account non si provano i codici', true, 'respinta');
  WHEN others THEN
    INSERT INTO esiti VALUES ('senza account non si provano i codici', SQLSTATE = '42501',
      'errore ' || SQLSTATE);
  END;
END $$;
RESET ROLE;

-- =============================================================================
-- 16. La home continua a mostrare l'attività — senza nomi di clienti
-- =============================================================================
SET LOCAL ROLE anon;
DO $$
DECLARE righe int := -1; colonne text;
BEGIN
  BEGIN
    SELECT count(*) INTO righe FROM public.live_activity_public;
  EXCEPTION WHEN others THEN righe := -1;
  END;
  SELECT string_agg(column_name, ', ') INTO colonne
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'live_activity_public'
     AND column_name IN ('delivery_full_name', 'delivery_phone', 'delivery_address', 'user_id');
  INSERT INTO esiti VALUES ('la home vede l''attività ma non i clienti',
    righe > 0 AND colonne IS NULL,
    'righe visibili: ' || righe || ' · dati personali nella vista: ' || coalesce(colonne, 'nessuno'));
END $$;
RESET ROLE;

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

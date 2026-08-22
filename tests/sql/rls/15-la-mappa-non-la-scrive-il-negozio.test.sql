-- =============================================================================
-- 22/8/2026 — LA POSIZIONE DEL FATTORINO LA SCRIVE CHI CONSEGNA.
-- =============================================================================
-- La lista dei campi che un client può toccare comprendeva rider_lat, rider_lng
-- e rider_position_updated_at — ma i controlli su CHI scrive riguardavano solo
-- rider_id e delivery_status. Il venditore poteva quindi scrivere la posizione
-- del fattorino sul proprio ordine: la mappa che il cliente guarda mentre
-- aspetta mostrava il fattorino dove non è.
--
-- Non si perdono soldi. Si perde la sola cosa che chiediamo al cliente mentre
-- aspetta: credere a quella mappa.
--
-- Questa prova fa il tentativo VERO, coi permessi veri, e pretende il rifiuto.
-- Togli le due guardie dalla funzione e torna rossa.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';
SET LOCAL mycity.allow_order_write   = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('11111111-1111-1111-1111-111111111111', 'negozio@test.it',   '{"role":"seller"}'),
  ('22222222-2222-2222-2222-222222222222', 'fattorino@test.it', '{"role":"rider"}'),
  ('33333333-3333-3333-3333-333333333333', 'cliente@test.it',   '{"role":"buyer"}');

UPDATE public.profiles
   SET is_approved = true, approval_status = 'approved', store_name = 'Bottega di prova',
       store_address = 'Via Roma 1', store_lat = 45.05, store_lng = 9.69
 WHERE id = '11111111-1111-1111-1111-111111111111';
UPDATE public.profiles SET is_approved = true, approval_status = 'approved'
 WHERE id = '22222222-2222-2222-2222-222222222222';

-- Un ordine già preso in carico dal fattorino.
INSERT INTO public.orders (
  id, user_id, seller_id, rider_id, total_price, payment_status, delivery_status,
  delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip,
  rider_fee_cents
) VALUES (
  'a0000000-0000-0000-0000-00000000000a',
  '33333333-3333-3333-3333-333333333333',
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
  42.00, 'PAID', 'PICKED_UP',
  'Maria Rossi', '3331234567', 'Via Verdi 10', 'Piacenza', '29121',
  300
);

RESET mycity.allow_order_write;

-- ---------------------------------------------------------------------------
-- ① Il VENDITORE prova a scrivere la posizione del fattorino: deve fallire.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

DO $$
DECLARE rifiutato boolean := false; codice text := '—';
BEGIN
  BEGIN
    UPDATE public.orders
       SET rider_lat = 45.9999, rider_lng = 9.9999, rider_position_updated_at = now()
     WHERE id = 'a0000000-0000-0000-0000-00000000000a';
  EXCEPTION WHEN OTHERS THEN
    rifiutato := true;
    codice := SQLSTATE;
  END;

  INSERT INTO esiti VALUES (
    'il negozio NON puo scrivere la posizione del fattorino',
    rifiutato AND codice = '42501',
    format('rifiutato=%s codice=%s', rifiutato, codice)
  );
END $$;

-- ---------------------------------------------------------------------------
-- ② Il FATTORINO assegnato invece deve poterla scrivere: non ho rotto il giro.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

DO $$
DECLARE passato boolean := true; messaggio text := 'ok';
BEGIN
  BEGIN
    UPDATE public.orders
       SET rider_lat = 45.0500, rider_lng = 9.6900, rider_position_updated_at = now()
     WHERE id = 'a0000000-0000-0000-0000-00000000000a';
  EXCEPTION WHEN OTHERS THEN
    passato := false;
    messaggio := SQLERRM;
  END;

  INSERT INTO esiti VALUES (
    'il fattorino assegnato la scrive senza problemi',
    passato,
    messaggio
  );
END $$;

-- ---------------------------------------------------------------------------
-- ③ Il FATTORINO non puo scrivere gli orari del negozio.
-- ---------------------------------------------------------------------------
DO $$
DECLARE rifiutato boolean := false; codice text := '—';
BEGIN
  BEGIN
    UPDATE public.orders
       SET accepted_at = now(), ready_at = now()
     WHERE id = 'a0000000-0000-0000-0000-00000000000a';
  EXCEPTION WHEN OTHERS THEN
    rifiutato := true;
    codice := SQLSTATE;
  END;

  INSERT INTO esiti VALUES (
    'il fattorino NON puo scrivere accettazione e pronto del negozio',
    rifiutato AND codice = '42501',
    format('rifiutato=%s codice=%s', rifiutato, codice)
  );
END $$;

-- ---------------------------------------------------------------------------
-- Verdetto
-- ---------------------------------------------------------------------------
RESET ROLE;
DO $$
DECLARE rossi int; elenco text;
BEGIN
  SELECT count(*), coalesce(string_agg(format('%s → %s', e.nome, e.dettaglio), E'\n  '), '')
    INTO rossi, elenco
  FROM esiti e WHERE NOT e.ok;

  IF rossi > 0 THEN
    RAISE EXCEPTION E'% controllo/i rosso/i:\n  %', rossi, elenco;
  END IF;
  RAISE NOTICE 'la mappa non la scrive il negozio: % controlli verdi', (SELECT count(*) FROM esiti);
END $$;

ROLLBACK;

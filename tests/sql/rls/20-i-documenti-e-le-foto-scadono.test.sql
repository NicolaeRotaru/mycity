-- =============================================================================
-- Quello che teniamo di una persona ha una scadenza, e la scadenza funziona
-- =============================================================================
-- Gira dopo tests/sql/harness/apply.sh. Transazione con ROLLBACK finale.
--
-- 27/8/2026 (R056, R058, R066) — TRE FUNZIONI CHE DICEVANO E NON FACEVANO.
--
-- · `documenti_da_cancellare_respinti` nasce (migrazione 119) con sopra scritto
--   «azzera i riferimenti e restituisce i percorsi dei file». Era dichiarata
--   LANGUAGE sql STABLE: un elenco e basta, che non azzerava niente. Carta
--   d'identita', selfie e patente di chi era stato RESPINTO restavano nel
--   profilo e nello storage senza scadenza — documenti di persone con cui non
--   e' mai nato nessun rapporto.
-- · Le due foto della consegna in contanti — i contanti e il pacco lasciato
--   sulla porta di casa — non avevano nessuna scadenza: non esisteva proprio
--   una funzione che le potasse.
-- · `pota_consent_log` azzerava il solo indirizzo di rete e diceva 12 mesi,
--   mentre il lavoro notturno ne azzerava due (indirizzo e programma di
--   navigazione) e diceva 24. Due regole scritte in due posti, con due numeri.
--
-- Questi controlli chiamano le funzioni e guardano il database DOPO: se una
-- torna a essere un elenco che non cancella niente, qui diventa rosso.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';
SET LOCAL mycity.allow_order_write   = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'respinto@test.it',  '{"role":"seller"}'),
  ('bbbbbbbb-0000-0000-0000-00000000000b', 'fresco@test.it',    '{"role":"seller"}'),
  ('cccccccc-0000-0000-0000-00000000000c', 'fattorino@test.it', '{"role":"rider"}'),
  ('dddddddd-0000-0000-0000-00000000000d', 'cliente@test.it',   '{"role":"buyer"}');

-- Un venditore respinto cento giorni fa, coi documenti ancora addosso.
UPDATE public.profiles
   SET approval_status = 'rejected',
       approved_at = now() - interval '100 days',
       kyc_id_doc_front_url = 'aaaaaaaa/carta-fronte.jpg',
       kyc_id_doc_back_url  = 'aaaaaaaa/carta-retro.jpg',
       kyc_selfie_url       = 'aaaaaaaa/selfie.jpg',
       rider_license_url    = 'aaaaaaaa/patente.jpg',
       rider_insurance_url  = 'aaaaaaaa/polizza.pdf',
       rider_haccp_url      = 'aaaaaaaa/haccp.pdf'
 WHERE id = 'aaaaaaaa-0000-0000-0000-00000000000a';

-- Un venditore respinto ieri: i suoi documenti NON si toccano ancora (puo'
-- ancora fare ricorso e rimandare le carte).
UPDATE public.profiles
   SET approval_status = 'rejected',
       approved_at = now() - interval '1 day',
       kyc_id_doc_front_url = 'bbbbbbbb/carta-fronte.jpg'
 WHERE id = 'bbbbbbbb-0000-0000-0000-00000000000b';

-- =============================================================================
-- 1. I documenti di chi e' stato respinto spariscono davvero
-- =============================================================================
DO $$
DECLARE
  righe int;
  percorsi_tornati text[];
  rimasti text;
BEGIN
  SELECT count(*), max(percorsi) INTO righe, percorsi_tornati
    FROM public.documenti_da_cancellare_respinti(90);

  INSERT INTO esiti VALUES ('la funzione restituisce i percorsi dei file da cancellare',
    righe = 1 AND array_length(percorsi_tornati, 1) = 6,
    coalesce(righe::text, '0') || ' profili, ' ||
    coalesce(array_length(percorsi_tornati, 1)::text, '0') || ' file');

  SELECT concat_ws(' ', kyc_id_doc_front_url, kyc_id_doc_back_url, kyc_selfie_url,
                        rider_license_url, rider_insurance_url, rider_haccp_url)
    INTO rimasti
    FROM public.profiles WHERE id = 'aaaaaaaa-0000-0000-0000-00000000000a';

  INSERT INTO esiti VALUES ('dopo la chiamata il profilo respinto non punta piu a nessun documento',
    coalesce(rimasti, '') = '',
    CASE WHEN coalesce(rimasti, '') = '' THEN 'sei colonne azzerate'
         ELSE 'restano: ' || rimasti END);
END $$;

DO $$
DECLARE ancora text;
BEGIN
  SELECT kyc_id_doc_front_url INTO ancora
    FROM public.profiles WHERE id = 'bbbbbbbb-0000-0000-0000-00000000000b';
  INSERT INTO esiti VALUES ('chi e stato respinto ieri tiene i suoi documenti',
    ancora IS NOT NULL,
    coalesce(ancora, 'cancellati troppo presto'));
END $$;

-- =============================================================================
-- 2. Le foto della consegna in contanti hanno una scadenza
-- =============================================================================
INSERT INTO public.orders (id, user_id, rider_id, total_price, payment_status, delivery_status,
                           delivered_at, cash_confirmed_at,
                           cash_photo_url, delivery_photo_url, cash_signature_url)
VALUES ('e1111111-0000-0000-0000-00000000000e',
        'dddddddd-0000-0000-0000-00000000000d',
        'cccccccc-0000-0000-0000-00000000000c',
        20.00, 'PAID', 'DELIVERED',
        now() - interval '100 days', now() - interval '100 days',
        'cccccccc/e1111111/cash-1.jpg', 'cccccccc/e1111111/delivery-1.jpg',
        'cccccccc/e1111111/firma-1.png'),
       ('e2222222-0000-0000-0000-00000000000e',
        'dddddddd-0000-0000-0000-00000000000d',
        'cccccccc-0000-0000-0000-00000000000c',
        15.00, 'PAID', 'DELIVERED',
        now() - interval '3 days', now() - interval '3 days',
        'cccccccc/e2222222/cash-1.jpg', 'cccccccc/e2222222/delivery-1.jpg', NULL);

DO $$
DECLARE
  righe int;
  percorsi_tornati text[];
  vecchio text;
  recente text;
BEGIN
  SELECT count(*), max(percorsi) INTO righe, percorsi_tornati
    FROM public.foto_consegna_da_cancellare(90);

  INSERT INTO esiti VALUES ('la funzione restituisce le foto della consegna da cancellare',
    righe = 1 AND array_length(percorsi_tornati, 1) = 3,
    coalesce(righe::text, '0') || ' ordini, ' ||
    coalesce(array_length(percorsi_tornati, 1)::text, '0') || ' file');

  SELECT concat_ws(' ', cash_photo_url, delivery_photo_url, cash_signature_url)
    INTO vecchio FROM public.orders WHERE id = 'e1111111-0000-0000-0000-00000000000e';
  INSERT INTO esiti VALUES ('sull ordine di cento giorni fa non resta nessuna foto',
    coalesce(vecchio, '') = '',
    CASE WHEN coalesce(vecchio, '') = '' THEN 'tre colonne azzerate'
         ELSE 'restano: ' || vecchio END);

  SELECT cash_photo_url INTO recente
    FROM public.orders WHERE id = 'e2222222-0000-0000-0000-00000000000e';
  INSERT INTO esiti VALUES ('la consegna di tre giorni fa tiene la sua prova',
    recente IS NOT NULL,
    coalesce(recente, 'cancellata troppo presto: senza prova non si difende un reclamo'));
END $$;

-- =============================================================================
-- 3. Il registro dei consensi: un numero solo, e toglie tutti e due i dati
-- =============================================================================
INSERT INTO public.consent_log (user_id, categoria, valore, ip, user_agent, created_at) VALUES
  ('dddddddd-0000-0000-0000-00000000000d', 'analytics', true, '1.2.3.4', 'Mozilla/5.0 vecchio', now() - interval '30 months'),
  ('dddddddd-0000-0000-0000-00000000000d', 'analytics', true, '5.6.7.8', 'Mozilla/5.0 recente', now() - interval '2 months');

DO $$
DECLARE ripulite int; vecchia record; recente record;
BEGIN
  -- Senza argomenti: il numero di mesi vive dentro la funzione, in un posto solo.
  SELECT public.pota_consent_log() INTO ripulite;

  SELECT ip, user_agent INTO vecchia FROM public.consent_log
   WHERE created_at < now() - interval '25 months' LIMIT 1;
  SELECT ip, user_agent INTO recente FROM public.consent_log
   WHERE created_at > now() - interval '6 months' LIMIT 1;

  INSERT INTO esiti VALUES ('del consenso di trenta mesi fa resta la prova, non chi era',
    vecchia.ip IS NULL AND vecchia.user_agent IS NULL,
    'ip=' || coalesce(vecchia.ip, 'vuoto') || ' programma=' || coalesce(vecchia.user_agent, 'vuoto'));

  INSERT INTO esiti VALUES ('il consenso di due mesi fa non viene toccato',
    recente.ip IS NOT NULL,
    coalesce(recente.ip, 'azzerato troppo presto'));
END $$;

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

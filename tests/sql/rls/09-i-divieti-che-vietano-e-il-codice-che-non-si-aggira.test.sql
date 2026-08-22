-- =============================================================================
-- I divieti vietano davvero, e il codice di consegna non si aggira (migrazione 125)
-- =============================================================================
-- Gira contro un database ricostruito dalle migrazioni vere:
--   tests/sql/harness/apply.sh mycity_test
--   tests/sql/harness/run.sh   mycity_test
--
-- Due difetti bloccanti trovati dalla radiografia del 21/8/2026.
--
-- ① IL DIVIETO CHE NON VIETAVA. Le migrazioni scrivevano
--    `REVOKE EXECUTE ... FROM anon, authenticated` e lasciavano in piedi il
--    permesso che arriva a tutti da `PUBLIC`. Misurato in produzione: 19
--    funzioni potenti eseguibili senza account, fra cui `accumula_rimborso`,
--    cioe' il numero che il sito sottrae dai guadagni del negozio.
--
-- ② IL CODICE CHE SI AGGIRAVA CON «NIENTE». Il confronto era
--    `stored_code != trim(p_code)`: con `p_code` NULL il risultato non e' falso,
--    e' SCONOSCIUTO, e un IF che riceve sconosciuto non scatta. La funzione
--    tirava dritto fino a scrivere «consegnato», che sblocca il bonifico al
--    negozio e la paga del fattorino.
--
-- Senza la 125 questa prova e' ROSSA su entrambi. Tutto in transazione, ROLLBACK.
-- =============================================================================

BEGIN;

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- ① Le funzioni che non devono stare in mano al browser
-- ---------------------------------------------------------------------------
-- L'elenco e' scritto per nome apposta: una funzione nuova che nasce aperta non
-- entra qui da sola, ma una di queste che si riapre diventa rossa subito. Le
-- funzioni pubbliche per mestiere (vetrine, conteggi, tracciamento) NON sono in
-- lista: quella e' un'esenzione dichiarata, non un'omissione.
INSERT INTO esiti
SELECT 'nessun anonimo puo'' chiamare ' || f.nome,
       NOT has_function_privilege('anon', f.oid, 'EXECUTE'),
       'anon: ' || has_function_privilege('anon', f.oid, 'EXECUTE')::text
  FROM (
    SELECT p.oid, p.proname AS nome
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN (
         'accumula_rimborso',
         'consolida_visite_prodotto',
         'documenti_da_cancellare_respinti',
         'pota_consent_log',
         'visite_prodotti_venditore',
         'verify_delivery_code',
         'verify_pickup_code',
         'confirm_pickup_by_seller'
       )
  ) f;

-- I soldi non li tocca nemmeno chi ha fatto l'accesso: solo il server.
INSERT INTO esiti
SELECT 'nemmeno un utente con account puo'' chiamare accumula_rimborso',
       NOT has_function_privilege('authenticated', p.oid, 'EXECUTE'),
       'authenticated: ' || has_function_privilege('authenticated', p.oid, 'EXECUTE')::text
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'accumula_rimborso';

-- ---------------------------------------------------------------------------
-- ② Il codice di consegna con «niente» dentro
-- ---------------------------------------------------------------------------
SET LOCAL mycity.allow_profile_write = '1';
SET LOCAL mycity.allow_order_write   = '1';

INSERT INTO auth.users (id, email) VALUES
  ('b0000000-0000-0000-0000-000000000051', 'negozio-125@example.com'),
  ('b0000000-0000-0000-0000-0000000000b1', 'cliente-125@example.com'),
  ('b0000000-0000-0000-0000-000000000071', 'fattorino-125@example.com')
ON CONFLICT DO NOTHING;

INSERT INTO public.profiles (id, role, is_approved, approval_status) VALUES
  ('b0000000-0000-0000-0000-000000000051', 'seller', true, 'approved'),
  ('b0000000-0000-0000-0000-0000000000b1', 'buyer',  true, 'approved'),
  ('b0000000-0000-0000-0000-000000000071', 'rider',  true, 'approved')
ON CONFLICT (id) DO UPDATE
  SET role = EXCLUDED.role, is_approved = EXCLUDED.is_approved, approval_status = EXCLUDED.approval_status;

INSERT INTO public.orders (id, user_id, seller_id, rider_id, total_price, payment_status, delivery_status)
VALUES ('b0000000-0000-0000-0000-000000000001',
        'b0000000-0000-0000-0000-0000000000b1',
        'b0000000-0000-0000-0000-000000000051',
        'b0000000-0000-0000-0000-000000000071',
        20.00, 'PAID', 'OUT_FOR_DELIVERY');

INSERT INTO public.order_delivery_codes (order_id, code)
VALUES ('b0000000-0000-0000-0000-000000000001', '654321')
ON CONFLICT (order_id) DO UPDATE SET code = EXCLUDED.code, verified_at = NULL, attempts = 0, locked_until = NULL;

SET LOCAL role = authenticated;
SET LOCAL request.jwt.claims = '{"sub":"b0000000-0000-0000-0000-000000000071","role":"authenticated"}';

INSERT INTO esiti
SELECT 'un codice NULLO non consegna l''ordine',
       (r ->> 'ok')::boolean IS NOT TRUE,
       'risposta: ' || r::text
  FROM (SELECT public.verify_delivery_code('b0000000-0000-0000-0000-000000000001', NULL) AS r) t;

INSERT INTO esiti
SELECT 'un codice VUOTO non consegna l''ordine',
       (r ->> 'ok')::boolean IS NOT TRUE,
       'risposta: ' || r::text
  FROM (SELECT public.verify_delivery_code('b0000000-0000-0000-0000-000000000001', '   ') AS r) t;

RESET ROLE;

INSERT INTO esiti
SELECT 'dopo i due tentativi vuoti l''ordine NON e'' consegnato',
       delivery_status <> 'DELIVERED',
       'stato: ' || delivery_status
  FROM public.orders WHERE id = 'b0000000-0000-0000-0000-000000000001';

-- E il codice giusto deve continuare a funzionare: un freno che blocca tutto
-- non e' un freno, e' un guasto.
SET LOCAL role = authenticated;
SET LOCAL request.jwt.claims = '{"sub":"b0000000-0000-0000-0000-000000000071","role":"authenticated"}';

INSERT INTO esiti
SELECT 'il codice giusto consegna ancora',
       (r ->> 'ok')::boolean IS TRUE,
       'risposta: ' || r::text
  FROM (SELECT public.verify_delivery_code('b0000000-0000-0000-0000-000000000001', '654321') AS r) t;

RESET ROLE;

-- ---------------------------------------------------------------------------
SELECT nome, CASE WHEN ok THEN 'ok' ELSE 'ROTTO' END AS esito, dettaglio FROM esiti ORDER BY nome;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM esiti WHERE ok IS NOT TRUE;
  IF n > 0 THEN
    RAISE EXCEPTION '% controlli falliti su divieti e codice di consegna', n;
  END IF;
END $$;

ROLLBACK;

-- =============================================================================
-- La pulizia notturna dei documenti dell'iscrizione a metà regge sul database
-- costruito da TUTTE le migrazioni, con la chiave di servizio
-- =============================================================================
--   tests/sql/harness/apply.sh mycity_test && tests/sql/harness/run.sh mycity_test
--
-- Il passo `documenti-kyc-iscrizione-a-meta` (lib/privacy/potature-ritenzione.ts) fa,
-- attraverso PostgREST e col ruolo service_role:
--   1. DELETE FROM documenti_iscrizione_a_meta WHERE caricati_at < <30 giorni fa>
--      (la vista della 171: il grilletto azzera le sei colonne del profilo e mette i
--      percorsi in coda; passa dal guardiano dei profili e dal registro attività);
--   2. kyc_file_da_togliere_prendi() — prende la coda e la svuota;
--   3. se lo storage rifiuta, kyc_file_da_togliere_rimetti() (215) rimette in coda.
-- Le prove vitest lo fingono, e la 171 la provano su uno schema ridotto: qui gira
-- sullo schema vero, coi grilletti veri di profiles, e con lo stesso ruolo e le
-- stesse credenziali che mette PostgREST. Se domani una migrazione rompe uno dei
-- tre passi (un permesso tolto a service_role, il guardiano dei profili che non
-- riconosce più il server), la notte torna rossa e qui diventa rosso prima.
-- ROLLBACK finale.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
-- Quello che vede la notte, scritto da service_role (non dal proprietario della prova).
CREATE TEMP TABLE notte_tolte (n int) ON COMMIT DROP;
CREATE TEMP TABLE notte_presi (user_id uuid, percorsi text[]) ON COMMIT DROP;
CREATE TEMP TABLE notte_ripresi (user_id uuid, percorsi text[]) ON COMMIT DROP;
GRANT ALL ON notte_tolte, notte_presi, notte_ripresi TO service_role;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('17117100-0000-0000-0000-000000000001', 'r02-meta-vecchio@test.it',  '{"role":"rider"}'),
  ('17117100-0000-0000-0000-000000000002', 'r02-meta-fresco@test.it',   '{"role":"rider"}'),
  ('17117100-0000-0000-0000-000000000003', 'r02-meta-inviato@test.it',  '{"role":"seller"}'),
  ('17117100-0000-0000-0000-000000000004', 'r02-meta-dal-nome@test.it', '{"role":"rider"}');

-- ① fermo a metà da 40 giorni (la data viene dallo storage): si toglie
-- ② ha caricato 10 giorni fa: sta ancora compilando, resta
-- ③ ha caricato 40 giorni fa ma ha inviato la richiesta: aspetta lo staff, resta
-- ④ il file nel secchio non c'è più, la data si legge dal nome (45 giorni fa): si toglie
UPDATE public.profiles SET approval_status = 'pending', approval_requested_at = NULL, kyc_provider_checked_at = NULL,
       kyc_id_doc_front_url = '17117100-0000-0000-0000-000000000001/id_front-1000000000000.jpg',
       kyc_selfie_url       = '17117100-0000-0000-0000-000000000001/selfie-1000000000001.jpg'
 WHERE id = '17117100-0000-0000-0000-000000000001';
UPDATE public.profiles SET approval_status = 'pending', approval_requested_at = NULL, kyc_provider_checked_at = NULL,
       kyc_selfie_url = '17117100-0000-0000-0000-000000000002/selfie-1000000000002.jpg'
 WHERE id = '17117100-0000-0000-0000-000000000002';
UPDATE public.profiles SET approval_status = 'pending', approval_requested_at = now() - interval '39 days',
       kyc_provider_checked_at = NULL,
       kyc_id_doc_front_url = '17117100-0000-0000-0000-000000000003/id_front-1000000000003.jpg'
 WHERE id = '17117100-0000-0000-0000-000000000003';
UPDATE public.profiles SET approval_status = 'pending', approval_requested_at = NULL, kyc_provider_checked_at = NULL,
       rider_license_url = '17117100-0000-0000-0000-000000000004/rider_license-'
                           || (extract(epoch FROM now() - interval '45 days') * 1000)::bigint || '.jpg'
 WHERE id = '17117100-0000-0000-0000-000000000004';

INSERT INTO storage.buckets (id, name, public) VALUES ('kyc-docs', 'kyc-docs', false) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.objects (bucket_id, name, created_at) VALUES
  ('kyc-docs', '17117100-0000-0000-0000-000000000001/id_front-1000000000000.jpg', now() - interval '41 days'),
  ('kyc-docs', '17117100-0000-0000-0000-000000000001/selfie-1000000000001.jpg',   now() - interval '40 days'),
  ('kyc-docs', '17117100-0000-0000-0000-000000000002/selfie-1000000000002.jpg',   now() - interval '10 days'),
  ('kyc-docs', '17117100-0000-0000-0000-000000000003/id_front-1000000000003.jpg', now() - interval '40 days');

DELETE FROM public.kyc_file_da_togliere;

-- =============================================================================
-- La notte, come la manda PostgREST: ruolo service_role, credenziali del server,
-- e nessuna scorciatoia della prova.
-- =============================================================================
SET LOCAL mycity.allow_profile_write = '';
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

WITH pgrst_source AS (
  DELETE FROM public.documenti_iscrizione_a_meta
   WHERE public.documenti_iscrizione_a_meta.caricati_at < (now() - interval '30 days')
  RETURNING 1
)
INSERT INTO notte_tolte SELECT count(*) FROM pgrst_source;

INSERT INTO notte_presi SELECT * FROM public.kyc_file_da_togliere_prendi();

-- Lo storage rifiuta i file di ④: tornano in coda, e la notte dopo li riprende.
SELECT public.kyc_file_da_togliere_rimetti(user_id, percorsi)
  FROM notte_presi WHERE user_id = '17117100-0000-0000-0000-000000000004';
INSERT INTO notte_ripresi SELECT * FROM public.kyc_file_da_togliere_prendi();

RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);

-- =============================================================================
-- Cosa ha fatto
-- =============================================================================
INSERT INTO esiti
SELECT 'la cancellazione dalla vista con la chiave di servizio toglie i due fermi a metà',
       n = 2, n || ' profili'
  FROM notte_tolte;

INSERT INTO esiti
SELECT 'la coda presa porta i percorsi giusti, per profilo',
       count(*) = 2
       AND bool_and(CASE user_id
             WHEN '17117100-0000-0000-0000-000000000001' THEN cardinality(percorsi) = 2
             WHEN '17117100-0000-0000-0000-000000000004' THEN cardinality(percorsi) = 1
             ELSE false END),
       count(*) || ' righe'
  FROM notte_presi;

INSERT INTO esiti
SELECT 'i profili fermi a metà non puntano più a nessun documento',
       bool_and(cardinality(array_remove(ARRAY[kyc_id_doc_front_url, kyc_id_doc_back_url, kyc_selfie_url,
                rider_license_url, rider_insurance_url, rider_haccp_url], NULL)) = 0),
       string_agg(right(id::text, 1) || '=' || coalesce(kyc_id_doc_front_url, kyc_selfie_url, rider_license_url, 'vuoto'), ' ')
  FROM public.profiles
 WHERE id IN ('17117100-0000-0000-0000-000000000001', '17117100-0000-0000-0000-000000000004');

INSERT INTO esiti
SELECT 'chi sta ancora caricando e chi ha inviato la richiesta tengono i documenti',
       count(*) = 2, count(*) || ' profili ancora coi documenti'
  FROM public.profiles
 WHERE id IN ('17117100-0000-0000-0000-000000000002', '17117100-0000-0000-0000-000000000003')
   AND coalesce(kyc_selfie_url, kyc_id_doc_front_url) IS NOT NULL;

INSERT INTO esiti
SELECT 'i file rifiutati dallo storage tornano in coda e la notte dopo li riprende',
       count(*) = 1 AND bool_and(user_id = '17117100-0000-0000-0000-000000000004'),
       count(*) || ' righe riprese'
  FROM notte_ripresi;

INSERT INTO esiti
SELECT 'dopo la notte la coda è vuota e la vista non ha più nessuno oltre i 30 giorni',
       (SELECT count(*) FROM public.kyc_file_da_togliere) = 0
       AND (SELECT count(*) FROM public.documenti_iscrizione_a_meta
             WHERE caricati_at < now() - interval '30 days') = 0,
       'coda=' || (SELECT count(*) FROM public.kyc_file_da_togliere);

INSERT INTO esiti
SELECT 'da fuori nessuno cancella dalla vista né prende la coda',
       NOT bool_or(has_table_privilege(r, 'public.documenti_iscrizione_a_meta', 'DELETE')
                   OR has_table_privilege(r, 'public.documenti_iscrizione_a_meta', 'SELECT')
                   OR has_function_privilege(r, 'public.kyc_file_da_togliere_prendi()', 'EXECUTE')),
       ''
  FROM unnest(ARRAY['anon', 'authenticated']) AS r;

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

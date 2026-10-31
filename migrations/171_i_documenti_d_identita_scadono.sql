-- =============================================================================
-- 171 — I DOCUMENTI DI CHI SI FERMA A META' ISCRIZIONE SCADONO DOPO 30 GIORNI
-- =============================================================================
-- 31/10/2026. Scelta di Nicola dello stesso giorno (registro dei fatti,
-- `kyc.documenti-iscrizione-a-meta`): «I documenti d'identita' di chi carica
-- carta e selfie e poi non finisce l'iscrizione si cancellano dopo 30 giorni.
-- Se torna, li ricarica.»
--
-- IL BUCO. `approval_status` nasce 'pending' (migrations/021) e l'unica
-- potatura sui documenti (migrations/135) guarda solo i RESPINTI. Chi carica
-- carta d'identita' e selfie (o patente, polizza, attestato HACCP del
-- fattorino) e poi abbandona resta 'pending' per sempre: nessuna scadenza,
-- nessun cancellatore, e nessun rapporto contrattuale che giustifichi di
-- tenere quelle fotografie (art. 5.1.e GDPR). E' la popolazione piu' numerosa:
-- ogni iscrizione lasciata a meta'.
--
-- CHI E' «A META'». Tutte e tre le condizioni:
--   ① `approval_status = 'pending'` — non approvato, non respinto (i respinti
--      restano alla regola dei 90 giorni della 135, come prima);
--   ② la richiesta non e' mai partita: `approval_requested_at` e' vuoto (lo
--      scrive l'invio del modulo del negoziante, app/api/seller/apply) E
--      `kyc_provider_checked_at` e' vuoto (lo scrive l'invio del fattorino,
--      app/api/kyc/start-check). Chi ha inviato e aspetta l'amministratore NON
--      e' a meta': i suoi documenti servono a decidere, e qui non si toccano;
--   ③ il documento PIU' RECENTE e' stato caricato da piu' di 30 giorni. Si
--      guarda il piu' recente, non il primo: chi ha caricato il fronte 40
--      giorni fa e il retro ieri sta ancora compilando.
--
-- QUANDO E' STATO CARICATO. Non c'e' una colonna con la data: la si legge da
-- `storage.objects.created_at`, cioe' dall'ora vera in cui il file e' entrato
-- nel secchio `kyc-docs`. Se il file nel secchio non c'e' piu' (resta solo il
-- percorso nel profilo), la data si legge dal nome, che la rotta di
-- caricamento scrive sempre cosi': `<utente>/<tipo>-<millisecondi>.<est>`.
-- Un percorso senza nessuna delle due date non si giudica e non si tocca.
--
-- COSA FA. Come la 135: azzera le sei colonne UNA RIGA ALLA VOLTA e
-- restituisce i percorsi vecchi, perche' il database non parla con lo storage
-- e i file li toglie la potatura della notte (lib/privacy/potature-ritenzione.ts,
-- passo `documenti-kyc-iscrizione-a-meta`). Il profilo resta: e' l'account
-- della persona, non il suo documento.
--
-- DUE VOLTE, O IN CONCORRENZA. L'UPDATE rimette nel WHERE le tre condizioni e
-- i percorsi letti: se tra la lettura e l'azzeramento la persona invia la
-- richiesta o carica un documento nuovo, la riga cambia, il WHERE non vale
-- piu' e quel profilo si lascia stare (ci si riprova la notte dopo). Rigirata
-- subito, la funzione non trova niente: le colonne sono gia' vuote.
--
-- IL CONTO SENZA CANCELLARE. `contaPotature` (il riassunto prima della notte)
-- non puo' chiamare la funzione che cancella; chiama
-- legge la vista `documenti_iscrizione_a_meta` con un conto PostgREST (una
-- SELECT, come le altre potature): la regola vive in un posto solo, la vista,
-- e la funzione che cancella legge la stessa vista.
--
-- Idempotente: CREATE OR REPLACE e REVOKE.
-- Rollback: DROP FUNCTION documenti_da_cancellare_iscrizione_a_meta(int);
--           DROP VIEW documenti_iscrizione_a_meta (nessun dato toccato).
-- =============================================================================

CREATE OR REPLACE VIEW public.documenti_iscrizione_a_meta
WITH (security_invoker = true) AS
  SELECT p.id AS profilo,
         d.file,
         (SELECT max(coalesce(
                   (SELECT o.created_at
                      FROM storage.objects o
                     WHERE o.bucket_id = 'kyc-docs' AND o.name = f.percorso
                     ORDER BY o.created_at DESC
                     LIMIT 1),
                   to_timestamp((substring(f.percorso FROM '-([0-9]{13})\.[^/.]*$'))::bigint / 1000.0)
                 ))
            FROM unnest(d.file) AS f(percorso)) AS caricati_at
    FROM public.profiles p
   CROSS JOIN LATERAL (
     SELECT array_remove(ARRAY[
              p.kyc_id_doc_front_url, p.kyc_id_doc_back_url, p.kyc_selfie_url,
              p.rider_license_url, p.rider_insurance_url, p.rider_haccp_url
            ], NULL) AS file
   ) d
   WHERE p.approval_status = 'pending'
     AND p.approval_requested_at IS NULL
     AND p.kyc_provider_checked_at IS NULL
     AND cardinality(d.file) > 0;

CREATE OR REPLACE FUNCTION public.documenti_da_cancellare_iscrizione_a_meta(p_giorni int DEFAULT 30)
RETURNS TABLE (user_id uuid, percorsi text[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  v_azzerate int;
BEGIN
  FOR r IN
    SELECT d.profilo, d.file
      FROM public.documenti_iscrizione_a_meta d
     WHERE d.caricati_at < now() - make_interval(days => greatest(p_giorni, 1))
  LOOP
    UPDATE public.profiles
       SET kyc_id_doc_front_url = NULL,
           kyc_id_doc_back_url  = NULL,
           kyc_selfie_url       = NULL,
           rider_license_url    = NULL,
           rider_insurance_url  = NULL,
           rider_haccp_url      = NULL
     WHERE id = r.profilo
       AND approval_status = 'pending'
       AND approval_requested_at IS NULL
       AND kyc_provider_checked_at IS NULL
       AND array_remove(ARRAY[
             kyc_id_doc_front_url, kyc_id_doc_back_url, kyc_selfie_url,
             rider_license_url, rider_insurance_url, rider_haccp_url
           ], NULL) = r.file;
    GET DIAGNOSTICS v_azzerate = ROW_COUNT;
    CONTINUE WHEN v_azzerate = 0;
    user_id  := r.profilo;
    percorsi := r.file;
    RETURN NEXT;
  END LOOP;
END;
$$;

-- Una funzione nasce con EXECUTE concesso a PUBLIC (vedi 135): si toglie a
-- PUBLIC, o la porta resta aperta. Le chiama solo il lavoro notturno, con la
-- chiave di servizio.
REVOKE EXECUTE ON FUNCTION public.documenti_da_cancellare_iscrizione_a_meta(int) FROM PUBLIC, anon, authenticated;
-- La vista mostra percorsi di documenti d'identita': la legge solo la chiave di
-- servizio (security_invoker: chi legge usa i propri permessi, migrations/152).
REVOKE ALL ON public.documenti_iscrizione_a_meta FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.documenti_iscrizione_a_meta TO service_role;

NOTIFY pgrst, 'reload schema';

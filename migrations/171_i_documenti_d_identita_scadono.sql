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
-- COME SI CANCELLA. La regola vive in UN posto: la vista
-- `documenti_iscrizione_a_meta`. La potatura della notte
-- (lib/privacy/potature-ritenzione.ts, passo `documenti-kyc-iscrizione-a-meta`)
-- fa `DELETE FROM documenti_iscrizione_a_meta WHERE caricati_at < <30 giorni fa>`.
-- Il trigger INSTEAD OF qui sotto, riga per riga, azzera le sei colonne del
-- profilo e mette i percorsi vecchi nella coda `kyc_file_da_togliere`; poi la
-- notte prende la coda (`kyc_file_da_togliere_prendi`) e toglie i file dal
-- secchio, perche' il database non parla con lo storage. Prima le colonne,
-- poi i file, come la 135: il caso peggiore e' un file orfano, mai un profilo
-- che punta a una fotografia sparita. Il profilo resta: e' l'account della
-- persona, non il suo documento.
--
-- IL CONTO SENZA CANCELLARE. `contaPotature` trasforma ogni `delete` in una
-- lettura con gli stessi filtri: qui conta le righe della vista piu' vecchie
-- di 30 giorni, cioe' esattamente quelle che la notte cancellerebbe.
--
-- DUE VOLTE, O IN CONCORRENZA. Il trigger rimette nel WHERE le tre condizioni
-- e i percorsi letti: se tra la lettura e l'azzeramento la persona invia la
-- richiesta o carica un documento nuovo, la riga cambia, il WHERE non vale
-- piu', il trigger restituisce NULL e quel profilo si lascia stare (ci si
-- riprova la notte dopo). Rigirata subito, la vista e' vuota. La coda si
-- svuota con un DELETE ... RETURNING: due notti insieme non prendono la stessa
-- riga. Se la presa riesce ma lo storage rifiuta, i percorsi finiscono nel
-- registro e la potatura risulta fallita (come la 135).
--
-- Idempotente: CREATE ... IF NOT EXISTS / OR REPLACE, DROP TRIGGER IF EXISTS.
-- Rollback: DROP TRIGGER documenti_iscrizione_a_meta_si_toglie ON documenti_iscrizione_a_meta;
--           DROP FUNCTION documenti_iscrizione_a_meta_togli(); DROP FUNCTION kyc_file_da_togliere_prendi();
--           DROP VIEW documenti_iscrizione_a_meta; DROP TABLE kyc_file_da_togliere
--           (solo a coda vuota: dentro ci sono percorsi di file ancora da togliere).
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

-- La coda dei file gia' staccati dal profilo e non ancora tolti dal secchio.
CREATE TABLE IF NOT EXISTS public.kyc_file_da_togliere (
  id        bigserial   PRIMARY KEY,
  profilo   uuid        NOT NULL,
  percorsi  text[]      NOT NULL,
  messo_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.kyc_file_da_togliere ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.documenti_iscrizione_a_meta_togli()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.profiles
     SET kyc_id_doc_front_url = NULL,
         kyc_id_doc_back_url  = NULL,
         kyc_selfie_url       = NULL,
         rider_license_url    = NULL,
         rider_insurance_url  = NULL,
         rider_haccp_url      = NULL
   WHERE id = OLD.profilo
     AND approval_status = 'pending'
     AND approval_requested_at IS NULL
     AND kyc_provider_checked_at IS NULL
     AND array_remove(ARRAY[
           kyc_id_doc_front_url, kyc_id_doc_back_url, kyc_selfie_url,
           rider_license_url, rider_insurance_url, rider_haccp_url
         ], NULL) = OLD.file;
  IF NOT FOUND THEN
    RETURN NULL; -- il profilo e' cambiato nel frattempo: non si tocca, e non si conta
  END IF;
  INSERT INTO public.kyc_file_da_togliere (profilo, percorsi) VALUES (OLD.profilo, OLD.file);
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS documenti_iscrizione_a_meta_si_toglie ON public.documenti_iscrizione_a_meta;
CREATE TRIGGER documenti_iscrizione_a_meta_si_toglie
  INSTEAD OF DELETE ON public.documenti_iscrizione_a_meta
  FOR EACH ROW EXECUTE FUNCTION public.documenti_iscrizione_a_meta_togli();

-- Prende (e toglie dalla coda) i percorsi da cancellare dal secchio kyc-docs.
-- Stessa forma della 135 (user_id, percorsi): la notte li legge allo stesso modo.
CREATE OR REPLACE FUNCTION public.kyc_file_da_togliere_prendi()
RETURNS TABLE (user_id uuid, percorsi text[])
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.kyc_file_da_togliere q
   RETURNING q.profilo, q.percorsi;
$$;

-- Una funzione nasce con EXECUTE concesso a PUBLIC (vedi 135): si toglie a
-- PUBLIC, o la porta resta aperta. Le usa solo il lavoro notturno, con la
-- chiave di servizio.
REVOKE EXECUTE ON FUNCTION public.documenti_iscrizione_a_meta_togli() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.kyc_file_da_togliere_prendi() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kyc_file_da_togliere_prendi() TO service_role;
-- La vista e la coda mostrano percorsi di documenti d'identita': solo la chiave
-- di servizio (security_invoker: chi legge usa i propri permessi, migrations/152).
REVOKE ALL ON public.documenti_iscrizione_a_meta FROM PUBLIC, anon, authenticated;
GRANT SELECT, DELETE ON public.documenti_iscrizione_a_meta TO service_role;
REVOKE ALL ON public.kyc_file_da_togliere FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';

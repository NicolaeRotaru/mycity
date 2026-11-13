-- =============================================================================
-- 320 — IL RIFIUTO HA LA SUA ORA (R08-007)
-- =============================================================================
-- Per far partire i 90 giorni della potatura dei documenti dei respinti, il
-- rifiuto scriveva `approved_at = adesso`, mentre `approved_by` restava quello
-- dell'approvazione di prima. La colonna aveva così due significati: per chi è
-- approvato la data dell'approvazione, per chi è respinto la data del rifiuto.
-- Chi un giorno contasse i negozi approvati per mese da `approved_at` conterebbe
-- anche i respinti, con accanto un approvatore che non li ha mai approvati.
--
-- Qui il rifiuto prende una colonna sua, `rejected_at`, e la potatura conta da
-- quella. `approved_at` torna a voler dire una cosa sola.
--
-- ① la colonna, protetta come tutte le altre: la guardia dei profili
--   (enforce_profile_update_rules, migrations/119) lascia scrivere a una persona
--   solo le colonne della sua lista, e `rejected_at` non c'è;
-- ② i respinti di oggi: la loro ora del rifiuto sta in `approved_at` (lo scriveva
--   la rotta di moderazione). La si copia, così nessuno perde né guadagna giorni.
--   `approved_at` dei respinti NON si tocca: per chi era stato approvato prima di
--   essere respinto potrebbe essere ancora la data vera dell'approvazione, e
--   distinguere i due casi da qui non si può;
-- ③ la potatura (ultima versione: migrations/135, permessi in 125) conta da
--   `rejected_at`; per le righe respinte senza la colonna riempita resta il
--   ripiego su `approved_at`, che è quello che faceva fino a oggi.
--
-- Il codice che scrive `rejected_at` (app/api/admin/users/[id]/moderate) regge
-- anche prima di questa migrazione: se la colonna non c'è, ripete il rifiuto con
-- `approved_at` come prima.
-- =============================================================================

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS rejected_at timestamptz;

COMMENT ON COLUMN public.profiles.rejected_at IS
  'Ora dell''ultimo rifiuto della richiesta (negozio o fattorino). La potatura dei documenti dei respinti conta i 90 giorni da qui. approved_at resta la data dell''approvazione.';

UPDATE public.profiles
   SET rejected_at = approved_at
 WHERE approval_status = 'rejected'
   AND rejected_at IS NULL
   AND approved_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.documenti_da_cancellare_respinti(p_giorni int DEFAULT 90)
RETURNS TABLE (user_id uuid, percorsi text[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.id AS profilo,
           array_remove(ARRAY[
             p.kyc_id_doc_front_url, p.kyc_id_doc_back_url, p.kyc_selfie_url,
             p.rider_license_url, p.rider_insurance_url, p.rider_haccp_url
           ], NULL) AS file
      FROM public.profiles p
     WHERE p.approval_status = 'rejected'
       AND coalesce(p.rejected_at, p.approved_at) IS NOT NULL
       AND coalesce(p.rejected_at, p.approved_at) < now() - make_interval(days => greatest(p_giorni, 1))
       AND coalesce(p.kyc_id_doc_front_url, p.kyc_id_doc_back_url, p.kyc_selfie_url,
             p.rider_license_url, p.rider_insurance_url, p.rider_haccp_url) IS NOT NULL
  LOOP
    UPDATE public.profiles
       SET kyc_id_doc_front_url = NULL,
           kyc_id_doc_back_url  = NULL,
           kyc_selfie_url       = NULL,
           rider_license_url    = NULL,
           rider_insurance_url  = NULL,
           rider_haccp_url      = NULL
     WHERE id = r.profilo;
    user_id  := r.profilo;
    percorsi := r.file;
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.documenti_da_cancellare_respinti(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.documenti_da_cancellare_respinti(int) TO service_role;

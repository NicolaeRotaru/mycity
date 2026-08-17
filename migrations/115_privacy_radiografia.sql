-- =============================================================================
-- 115 — Privacy: cosa finiva dove non doveva
-- =============================================================================
-- Cosa ripara:
--   1. il fattorino leggeva l'INTERA riga del cliente — codice fiscale, IBAN,
--      documenti KYC — quando gli serviva solo il nome su una recensione
--   2. il registro delle attività copiava telefono, indirizzi e nomi in chiaro:
--      la lista dei campi da oscurare confrontava i nomi per uguaglianza esatta,
--      quindi `phone` passava, `delivery_phone` passava, `store_address` passava
--   3. nella chat, chi partecipava poteva RISCRIVERE il messaggio dell'altro
--   4. alla newsletter si poteva iscrivere l'indirizzo di un altro, e non
--      restava alcuna prova di quando e come fosse stato dato il consenso
--   5. del consenso ai cookie non restava traccia da nessuna parte: solo nel
--      browser di chi lo dava, quindi cancellabile e non dimostrabile
--
-- Prova: tests/sql/rls/02-privacy.test.sql
-- Idempotente.
-- =============================================================================

BEGIN;

-- =========================================================
-- 1) IL FATTORINO E IL NOME DEL CLIENTE
-- =========================================================
-- La policy dava al fattorino la riga intera di profiles del suo cliente: e' un
-- filtro per RIGA, non per colonna, quindi con essa arrivavano anche IBAN,
-- codice fiscale e indirizzi dei documenti. Le pagine del fattorino non ne
-- avevano bisogno: i recapiti per la consegna stanno già sull'ordine. Serviva
-- solo il nome di chi lascia una recensione.
DROP POLICY IF EXISTS "Riders can view buyer of assigned orders" ON public.profiles;

-- Le recensioni ricevute, col solo nome di battesimo di chi le ha scritte.
-- La vista filtra da sé sul fattorino che chiama.
CREATE OR REPLACE VIEW public.rider_reviews_ricevute AS
  SELECT r.id,
         r.rider_id,
         r.rating,
         r.comment,
         r.created_at,
         nullif(split_part(coalesce(p.full_name, ''), ' ', 1), '') AS autore_nome
    FROM public.rider_reviews r
    LEFT JOIN public.profiles p ON p.id = r.user_id
   WHERE r.rider_id = (SELECT auth.uid());

COMMENT ON VIEW public.rider_reviews_ricevute IS
  'Recensioni del fattorino che chiama, col solo nome di battesimo dell''autore.';

REVOKE ALL     ON public.rider_reviews_ricevute FROM anon, authenticated;
GRANT  SELECT  ON public.rider_reviews_ricevute TO authenticated;

-- =========================================================
-- 2) REGISTRO ATTIVITÀ — oscurare per somiglianza, non per uguaglianza
-- =========================================================
-- Prima: `IF v_key = ANY(v_redact)`, con una lista di undici nomi esatti. Cosi'
-- `iban` veniva oscurato ma `business_iban` no, `phone` non era nemmeno in
-- lista, e ogni colonna nuova nasceva in chiaro. Ora si guarda se il nome
-- CONTIENE una parola sensibile: le colonne future sono coperte da subito.
CREATE OR REPLACE FUNCTION public.activity_key_sensibile(p_key text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_key ~* '(password|token|secret|iban|bic|swift|card|cvv|fiscal|tax|vat|piva|birth|resid|phone|mobile|tel|address|indirizz|email|mail|sdi|pec|kyc|selfie|licen|document|doc_|signature|firma|lat|lng|zip|cap$|full_name|nome|cognome|note)';
$$;

DO $$
DECLARE
  src text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO src FROM pg_proc
   WHERE proname = 'log_activity_change' AND pronamespace = 'public'::regnamespace
   LIMIT 1;

  IF src IS NULL THEN
    RAISE NOTICE 'log_activity_change assente: niente da riscrivere';
    RETURN;
  END IF;

  -- Sostituzione puntuale del confronto, senza riscrivere tutta la funzione:
  -- il resto del corpo (categorie, riassunti, filtri) resta quello che è.
  src := replace(src,
    'IF v_key = ANY(v_redact) THEN',
    'IF v_key = ANY(v_redact) OR public.activity_key_sensibile(v_key) THEN');

  EXECUTE src;
END $$;

-- =========================================================
-- 3) CHAT — nessuno riscrive il messaggio di un altro
-- =========================================================
-- La policy permetteva l'UPDATE su qualunque messaggio della conversazione, con
-- `with_check` vuoto: il negoziante poteva cambiare il testo scritto dal cliente
-- (e viceversa) senza lasciare traccia. L'unica cosa che serve aggiornare sul
-- messaggio di un altro è «l'ho letto»: passa da una funzione dedicata.
DROP POLICY IF EXISTS "messages_update_read" ON public.messages;
CREATE POLICY "messages_update_own" ON public.messages
  FOR UPDATE TO authenticated
  USING (sender_id = (SELECT auth.uid()))
  WITH CHECK (sender_id = (SELECT auth.uid()));

CREATE OR REPLACE FUNCTION public.mark_conversation_read(p_conversation_id uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := (SELECT auth.uid());
  toccati int;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'serve un account' USING ERRCODE = '42501';
  END IF;

  -- Solo chi è parte della conversazione, e solo il campo «letto il».
  IF NOT EXISTS (
    SELECT 1 FROM public.conversations c
     WHERE c.id = p_conversation_id
       AND (c.buyer_id = uid OR c.seller_id = uid)
  ) THEN
    RAISE EXCEPTION 'conversazione non tua' USING ERRCODE = '42501';
  END IF;

  UPDATE public.messages
     SET read_at = now()
   WHERE conversation_id = p_conversation_id
     AND sender_id <> uid
     AND read_at IS NULL;
  GET DIAGNOSTICS toccati = ROW_COUNT;
  RETURN toccati;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.mark_conversation_read(uuid) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.mark_conversation_read(uuid) TO authenticated, service_role;

-- =========================================================
-- 4) NEWSLETTER — con la prova del consenso, e non per conto di altri
-- =========================================================
-- Prima chiunque, anche senza account, poteva iscrivere l'indirizzo di un altro,
-- e della volontà di iscriversi non restava nessuna prova: né quando, né da
-- dove, né su quale versione dell'informativa.
ALTER TABLE public.newsletter_subscribers
  ADD COLUMN IF NOT EXISTS confirm_token         text,
  ADD COLUMN IF NOT EXISTS confirmed_at          timestamptz,
  ADD COLUMN IF NOT EXISTS consent_ip            text,
  ADD COLUMN IF NOT EXISTS consent_source        text,
  ADD COLUMN IF NOT EXISTS consent_text_version  text,
  ADD COLUMN IF NOT EXISTS unsubscribed_at       timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS newsletter_confirm_token_idx
  ON public.newsletter_subscribers (confirm_token)
  WHERE confirm_token IS NOT NULL;

-- L'iscrizione passa solo dal server, che manda l'email di conferma: il browser
-- non scrive più direttamente su questa tabella.
DROP POLICY IF EXISTS "Anyone can subscribe" ON public.newsletter_subscribers;
REVOKE INSERT, UPDATE, DELETE ON public.newsletter_subscribers FROM anon, authenticated;

-- Finché non confermano, gli iscritti non sono attivi.
ALTER TABLE public.newsletter_subscribers
  ALTER COLUMN active SET DEFAULT false;

-- =========================================================
-- 5) CONSENSO AI COOKIE — una prova che resta
-- =========================================================
-- Prima viveva solo nel browser di chi lo dava (localStorage + un cookie): se
-- svuotava la cronologia, il consenso spariva e non era dimostrabile.
CREATE TABLE IF NOT EXISTS public.consent_log (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  anon_id        text,
  categoria      text NOT NULL CHECK (categoria IN ('necessari', 'analytics', 'marketing', 'privacy_terms')),
  valore         boolean NOT NULL,
  versione_testo text,
  ip             text,
  user_agent     text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS consent_log_user_idx    ON public.consent_log (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS consent_log_anon_idx    ON public.consent_log (anon_id, created_at DESC);

ALTER TABLE public.consent_log ENABLE ROW LEVEL SECURITY;

-- Ci scrive solo il server (la rotta /api/consent col client di servizio).
-- L'interessato può rileggere il proprio storico; lo staff tutto.
DROP POLICY IF EXISTS consent_log_read_own ON public.consent_log;
CREATE POLICY consent_log_read_own ON public.consent_log
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR public.is_admin());

REVOKE INSERT, UPDATE, DELETE ON public.consent_log FROM anon, authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- 115b — Gli interruttori delle notifiche devono avere un effetto
-- =============================================================================
-- Le quattro preferenze (notif_order_updates, notif_promos, notif_groups,
-- notif_newsletter) esistevano nel profilo e comparivano nelle impostazioni, ma
-- nessuno le leggeva: nessun cron, nessuna rotta, nessun trigger. Chi spegneva
-- «promozioni» continuava a riceverle. Mancava il pezzo per capire di che tipo
-- fosse una notifica: ora ogni notifica porta la sua categoria.
BEGIN;

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'order'
  CHECK (category IN ('order', 'promo', 'group', 'newsletter', 'system'));

CREATE INDEX IF NOT EXISTS notifications_category_idx
  ON public.notifications (category, pushed_at);

-- Chi riceve cosa, in una funzione sola: la usano l'invio delle push e chi
-- accoda le notifiche, così la regola sta scritta in un posto.
CREATE OR REPLACE FUNCTION public.vuole_notifica(p_user_id uuid, p_category text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE p_category
           WHEN 'promo'      THEN coalesce(p.notif_promos, true)
           WHEN 'group'      THEN coalesce(p.notif_groups, true)
           WHEN 'newsletter' THEN coalesce(p.notif_newsletter, true)
           WHEN 'order'      THEN coalesce(p.notif_order_updates, true)
           ELSE true   -- 'system': avvisi di servizio, non si disattivano
         END
    FROM public.profiles p
   WHERE p.id = p_user_id;
$$;

REVOKE EXECUTE ON FUNCTION public.vuole_notifica(uuid, text) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.vuole_notifica(uuid, text) TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- 940_la_ricerca_per_email_la_fa_il_database.sql
--
-- 26/11/2026 (R08-003) — OGNI RICERCA NEL PANNELLO UTENTI RILEGGEVA TUTTE LE
-- EMAIL DEGLI ISCRITTI.
--
-- /admin/users trova una persona anche per email, ma l'email vive in
-- auth.users. Per cercarla la pagina chiedeva a `admin_list_user_emails()`
-- (migrazione 074) TUTTO auth.users e filtrava nel browser: a ogni ricerca le
-- email di tutti gli iscritti viaggiavano fino alla pagina, e la funzione
-- rileggeva tutta la tabella. Va bene con pochi iscritti, non con decine di
-- migliaia.
--
-- Qui la stessa funzione ha una seconda forma, con due argomenti:
--
--   admin_list_user_emails(p_termine text, p_ids uuid[])
--
-- · cerca il testo DENTRO il database, fra email e telefoni (contiene, senza
--   distinguere maiuscole; `%` e `_` contano come lettere, niente jolly) e
--   restituisce solo chi corrisponde: al massimo 200, il tetto della ricerca
--   della pagina; sotto le due lettere non cerca niente;
-- · aggiunge i contatti dei profili che la pagina ha già trovato per nome
--   (`p_ids`, al massimo 500), così anche quelle righe mostrano l'email.
--
-- GLI STESSI CONTROLLI DELLA FORMA SENZA ARGOMENTI: SECURITY DEFINER con
-- search_path fisso (vuoto: ogni nome è scritto per intero), solo gli
-- amministratori (is_admin(), altrimenti 42501 «forbidden»), esecuzione tolta a
-- PUBLIC e ad anon, data a authenticated (che poi passa da is_admin()) e al
-- server. Un utente qualunque che la chiama riceve l'errore, non una riga.
--
-- Nessun valore di default sugli argomenti, apposta: con i default la chiamata
-- senza argomenti (l'elenco dei più recenti, l'esportazione) diventerebbe
-- ambigua fra le due forme. La forma senza argomenti resta com'è.
--
-- Non si applica da sola: la applica Nicola. Finché non c'è, la pagina riceve
-- «funzione non trovata» (PGRST202) e torna alla lettura di prima.

CREATE OR REPLACE FUNCTION public.admin_list_user_emails(p_termine text, p_ids uuid[])
RETURNS TABLE (
  id                 uuid,
  email              text,
  phone              text,
  last_sign_in_at    timestamptz,
  email_confirmed_at timestamptz,
  created_at         timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_testo text := lower(btrim(coalesce(p_termine, '')));
  v_ids   uuid[] := (coalesce(p_ids, '{}'::uuid[]))[1:500];
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  RETURN QUERY
    WITH per_testo AS (
      SELECT t.id AS uid
        FROM auth.users t
       WHERE length(v_testo) >= 2
         AND (strpos(lower(coalesce(t.email::text, '')), v_testo) > 0
              OR strpos(lower(coalesce(t.phone::text, '')), v_testo) > 0)
       ORDER BY t.created_at DESC NULLS LAST
       LIMIT 200
    )
    SELECT u.id, u.email::text, u.phone::text, u.last_sign_in_at, u.email_confirmed_at, u.created_at
      FROM auth.users u
     WHERE u.id IN (SELECT pt.uid FROM per_testo pt)
        OR u.id = ANY (v_ids);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_user_emails(text, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_user_emails(text, uuid[]) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_list_user_emails(text, uuid[]) IS
  'R08-003: la ricerca per email/telefono del pannello utenti, fatta nel database. Solo admin (is_admin), restituisce solo le corrispondenze (max 200) e i contatti degli id dati (max 500).';

NOTIFY pgrst, 'reload schema';

-- 364_una_domanda_si_segnala_e_si_nasconde.sql
--
-- 12/11/2026 (R12-021) — LE DOMANDE SOTTO I PRODOTTI SI PUBBLICANO SUBITO, NON
-- SI POTEVANO SEGNALARE UNA PER UNA E NESSUNO POTEVA TOGLIERLE.
--
-- Una domanda entra con is_public = true (027) ed e' subito visibile a tutti,
-- firmata col nome dell'autore. La segnalazione accettava solo prodotto,
-- negozio, recensione e messaggio; e nessuna regola lasciava all'amministratore
-- nascondere una domanda (product_questions: aggiorna solo il negozio del
-- prodotto). Un testo offensivo o un numero di telefono restavano online, e il
-- DSA chiede una strada di segnalazione e di rimozione.
--
-- Qui il database:
--   ① accetta il tipo «domanda» nelle segnalazioni;
--   ② lascia all'amministratore leggere e nascondere (is_public = false) una
--      domanda, con la regola esplicita (il guardiano 'domanda_non_si_riscrive'
--      lo lascia gia' passare, ma senza una policy l'UPDATE non toccava niente).
-- Il pulsante «Segnala» sulla domanda e il comando nel pannello stanno nei
-- file del sito (components/Segnala.tsx, app/api/segnalazioni, la pagina
-- admin): vedi il referto R12.
-- Non si applica da sola: la applica Nicola.

ALTER TABLE public.segnalazioni DROP CONSTRAINT IF EXISTS segnalazioni_tipo_check;
ALTER TABLE public.segnalazioni
  ADD CONSTRAINT segnalazioni_tipo_check
  CHECK (tipo = ANY (ARRAY['prodotto', 'negozio', 'recensione', 'messaggio', 'domanda']));

DROP POLICY IF EXISTS qa_admin_legge ON public.product_questions;
CREATE POLICY qa_admin_legge ON public.product_questions
  FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS qa_admin_nasconde ON public.product_questions;
CREATE POLICY qa_admin_nasconde ON public.product_questions
  FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

COMMENT ON POLICY qa_admin_nasconde ON public.product_questions IS
  'R12-021: l amministratore nasconde una domanda segnalata (is_public = false). Il testo non lo riscrive nessuno: lo vieta gia il guardiano, tranne a lui.';

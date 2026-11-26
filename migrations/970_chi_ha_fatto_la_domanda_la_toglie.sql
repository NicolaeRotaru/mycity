-- 970_chi_ha_fatto_la_domanda_la_toglie.sql
--
-- 26/11/2026 — CHI HA FATTO UNA DOMANDA SOTTO UN PRODOTTO NON POTEVA TOGLIERLA.
--
-- Una domanda entra pubblica (027), firmata col nome di battesimo dell'autore
-- (vista nomi_pubblici, 164). Se l'autore ci scrive per sbaglio il telefono, o
-- cambia idea, non aveva nessuna strada: product_questions non ha una regola di
-- cancellazione, e nemmeno il permesso DELETE (145 e 425 danno a authenticated
-- solo INSERT e UPDATE). Nasconderla puo' solo l'amministratore (364).
--
-- Qui l'autore, e solo lui, cancella una sua domanda:
--   · la regola guarda solo author_id: un altro cliente, il negozio del
--     prodotto o un visitatore non cancellano niente;
--   · la riga va letta per toglierla (la richiesta la cerca per id): una domanda
--     che l'amministratore ha gia' nascosto non la vede piu' nemmeno l'autore, e
--     resta com'e' per chi esamina la segnalazione;
--   · con la domanda va via anche la risposta del negozio, che senza la domanda
--     non si capisce.
-- Il pulsante sta in components/ProductQA.tsx, solo sulle domande proprie.
--
-- Si puo' rieseguire. NON si applica a mano: lo decide Nicola, come ogni migrazione.
-- REVERSIBILE: DROP POLICY qa_autore_toglie ON public.product_questions;
--             REVOKE DELETE ON public.product_questions FROM authenticated;
-- LA PROVA: tests/sql/rls/riparazione-r16-domanda-tolta-dall-autore.test.sql.

BEGIN;

DROP POLICY IF EXISTS qa_autore_toglie ON public.product_questions;
CREATE POLICY qa_autore_toglie ON public.product_questions
  FOR DELETE TO authenticated
  USING ((SELECT auth.uid()) = author_id);

COMMENT ON POLICY qa_autore_toglie ON public.product_questions IS
  'Chi ha fatto la domanda la cancella (970). Nessun altro: il negozio risponde, l amministratore nasconde (364).';

GRANT DELETE ON public.product_questions TO authenticated;

COMMIT;

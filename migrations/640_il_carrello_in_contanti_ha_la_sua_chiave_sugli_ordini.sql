-- =============================================================================
-- 640 — IL CARRELLO IN CONTANTI HA LA SUA CHIAVE SUGLI ORDINI (R02-002)
-- =============================================================================
--
-- NON APPLICATA. La applica Nicola.
--
-- ── Cosa c'e' che non va, in parole semplici ─────────────────────────────────
-- Un carrello pagato con la carta si ritrova dalla sessione di pagamento
-- (`stripe_session_id`, uguale su tutti gli ordini del carrello). Un carrello
-- in contanti no: sugli ordini non c'e' niente che li leghi. Si ritrova solo
-- dalla riga della tabella contro il doppio clic (`cod_checkout_attempts`).
-- Se quella riga manca (la rotta della cassa non l'ha potuta scrivere) o non
-- si legge, il sito tratta ogni ordine come un carrello da solo:
--   · un negozio rifiuta e la consegna degli altri negozi non si rifa'
--     (lib/ordini/annulla.ts, `ricalcolaLaConsegnaDelGiro`);
--   · il freno della veloce sposta un ordine solo e dice al cliente un conto a
--     meta' (lib/ordini/veloce-non-confermata.ts).
-- Pane 15 € + frutta 12 € in contanti, senza la riga: il forno rifiuta, e la
-- frutta resta a 1 € di consegna invece di 3. Oggi lo sanno gli amministratori,
-- ma la regola non scatta.
--
-- ── Cosa fa ──────────────────────────────────────────────────────────────────
-- Aggiunge `orders.carrello_contanti` (testo, vuoto di norma): la stessa chiave
-- su tutti gli ordini nati dallo stesso invio della cassa in contanti. La
-- scrive la rotta dei contanti (app/api/orders/cod/route.ts) con la chiave
-- del carrello che ha gia'. Chi cerca il carrello e non trova la riga del
-- tentativo cerca gli ordini dello stesso cliente con la stessa chiave.
-- L'indice (user_id, carrello_contanti) serve proprio a quella ricerca, ed e'
-- parziale: gli ordini senza chiave (la carta, i vecchi) non ci entrano.
--
-- Il codice regge anche prima di questa migrazione: se la colonna non c'e'
-- (42703 / PGRST204) fa come prima, senza guasti.
--
-- Permessi: nessuno nuovo. La colonna non e' fra quelle che il guardiano degli
-- ordini (`enforce_order_update_rules`, 179) lascia scrivere dal browser: la
-- scrive solo il server. La legge chi legge gia' l'ordine.
--
-- ── Che rischio ha ───────────────────────────────────────────────────────────
-- Nessuno sui dati: una colonna nuova vuota e un indice. Riapplicabile.
-- Sulla tabella degli ordini l'ALTER prende un blocco breve (colonna senza
-- valore predefinito: nessuna riscrittura della tabella).
-- REVERSIBILE:
--   DROP INDEX IF EXISTS public.orders_user_carrello_contanti_idx;
--   ALTER TABLE public.orders DROP COLUMN IF EXISTS carrello_contanti;
-- e il codice torna da solo a fare come prima.
-- La prova: tests/sql/rls/riparazione-r02-carrello-contanti.test.sql
-- =============================================================================

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS carrello_contanti text;

COMMENT ON COLUMN public.orders.carrello_contanti IS
  'Chiave del carrello in contanti: uguale su tutti gli ordini nati dallo stesso invio della cassa (la scrive solo il server). Vuota sugli ordini con la carta e su quelli nati prima della 640.';

CREATE INDEX IF NOT EXISTS orders_user_carrello_contanti_idx
  ON public.orders (user_id, carrello_contanti)
  WHERE carrello_contanti IS NOT NULL;

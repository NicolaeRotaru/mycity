-- 149_la_scheda_prodotto_ha_una_misura.sql
--
-- 30/8/2026 (R158) — NOME E DESCRIZIONE DEL PRODOTTO NON AVEVANO NESSUN LIMITE.
--
-- `products.name` e `products.description` nascono in 001 come `text` senza
-- vincolo. Chi CREA un prodotto dalle foto tronca (`draftFromVision`: 120 e
-- 4000), chi lo MODIFICA no — ne' la strada dell'assistente (`resolveAiPatch`)
-- ne', soprattutto, la pagina di modifica del negoziante, che scrive diritta su
-- Supabase senza passare da nessuna delle due. Un nome di diecimila caratteri
-- appesantisce elenchi, ricerca, email di conferma e pagina pubblica del
-- negozio, e non c'era niente che lo impedisse da nessuna porta.
--
-- I due numeri sono gli stessi che usa il codice (lib/products/aiPatch.ts:
-- MAX_NOME_PRODOTTO, MAX_DESCRIZIONE_PRODOTTO).
--
-- PERCHE' `NOT VALID`: le righe gia' scritte non vengono ricontrollate. Un
-- vincolo validato all'indietro fallirebbe l'intera migrazione se anche una
-- sola scheda vecchia fosse fuori misura, e quella e' una decisione da prendere
-- sui dati veri, non a scatola chiusa. `NOT VALID` vale su ogni INSERT e su ogni
-- UPDATE da qui in avanti: chiude la porta senza rompere il passato. Quando si
-- sara' guardato il catalogo vero, un `VALIDATE CONSTRAINT` lo rende pieno.
--
-- Idempotente: si puo' rieseguire.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'products_name_lunghezza'
          AND conrelid = 'public.products'::regclass
    ) THEN
        ALTER TABLE public.products
            ADD CONSTRAINT products_name_lunghezza
            CHECK (char_length(name) <= 120) NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'products_description_lunghezza'
          AND conrelid = 'public.products'::regclass
    ) THEN
        ALTER TABLE public.products
            ADD CONSTRAINT products_description_lunghezza
            CHECK (description IS NULL OR char_length(description) <= 4000) NOT VALID;
    END IF;
END $$;

NOTIFY pgrst, 'reload schema';

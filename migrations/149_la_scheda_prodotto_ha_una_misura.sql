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
-- PERCHE' VALIDATO E NON `NOT VALID` (corretto il 31/8/2026).
-- La prima versione lasciava i due vincoli `NOT VALID` per non far fallire la
-- migrazione su una scheda vecchia fuori misura. Ragionamento sensato, ma va
-- contro una regola che in questa casa esiste gia' ed e' sorvegliata:
-- tests/sql/rls/14-le-porte-di-servizio-sono-chiuse.test.sql pretende che
-- «nessun vincolo resta NOT VALID», perche' un vincolo che non sai se vale e'
-- peggio di uno che non c'e': ti fa credere protetto un catalogo che non lo e'.
-- Ha bloccato la CI, ed e' giusto cosi'.
--
-- Quindi: prima si rimettono a misura le righe fuori norma, DICENDO quante sono,
-- poi si valida. Una scheda con un nome piu' lungo di 120 caratteri e' gia' rotta
-- oggi — non si legge negli elenchi, non entra nelle email — quindi accorciarla
-- non toglie niente a nessuno; e il taglio si vede nel registro della migrazione
-- invece di succedere in silenzio.

-- Idempotente: si puo' rieseguire.

DO $$
DECLARE
    nomi_tagliati int;
    descrizioni_tagliate int;
BEGIN
    -- Prima la misura, e detta ad alta voce: se domani questa migrazione gira
    -- sul catalogo vero, dal registro si sa esattamente cosa ha toccato.
    WITH tagliati AS (
        UPDATE public.products
           SET name = left(name, 120)
         WHERE char_length(name) > 120
        RETURNING 1
    ) SELECT count(*) INTO nomi_tagliati FROM tagliati;

    WITH tagliate AS (
        UPDATE public.products
           SET description = left(description, 4000)
         WHERE description IS NOT NULL AND char_length(description) > 4000
        RETURNING 1
    ) SELECT count(*) INTO descrizioni_tagliate FROM tagliate;

    IF nomi_tagliati > 0 OR descrizioni_tagliate > 0 THEN
        RAISE NOTICE 'rimessi a misura: % nomi oltre 120 caratteri, % descrizioni oltre 4000',
            nomi_tagliati, descrizioni_tagliate;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'products_name_lunghezza'
          AND conrelid = 'public.products'::regclass
    ) THEN
        ALTER TABLE public.products
            ADD CONSTRAINT products_name_lunghezza
            CHECK (char_length(name) <= 120) NOT VALID;
    END IF;
    -- Separato dall'ADD apposta: `VALIDATE` prende un lock leggero e si puo'
    -- rieseguire senza danno anche quando il vincolo e' gia' pieno.
    ALTER TABLE public.products VALIDATE CONSTRAINT products_name_lunghezza;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'products_description_lunghezza'
          AND conrelid = 'public.products'::regclass
    ) THEN
        ALTER TABLE public.products
            ADD CONSTRAINT products_description_lunghezza
            CHECK (description IS NULL OR char_length(description) <= 4000) NOT VALID;
    END IF;
    ALTER TABLE public.products VALIDATE CONSTRAINT products_description_lunghezza;
END $$;

NOTIFY pgrst, 'reload schema';

-- =========================================================
-- LA FOTO DI UNA CATEGORIA SI CAMBIA SENZA RIPUBBLICARE IL SITO
-- =========================================================
-- 8/9/2026 (lotto gravi, corsia 17).
--
-- COSA SUCCEDE OGGI. Le tessere delle categorie in home mostravano undici foto
-- d'archivio Pexels scritte a mano dentro `components/CategoryShowcase.tsx`.
-- Non erano cambiabili da nessuna parte: la tabella `categories` ha slug, nome,
-- icona, genitore (migrazione 002) piu' ordine ed evidenza (migrazione 076), e
-- nient'altro. Per sostituire UNA foto — per esempio con la vetrina vera di un
-- negozio di Piacenza — bisognava riscrivere il codice e ripubblicare il sito.
--
-- COSA AGGIUNGE QUESTA. Una colonna sola, `image_url`, dove va l'indirizzo della
-- foto della categoria. Vuota su tutte le righe esistenti: finche' nessuno la
-- riempie, la tessera resta il gradiente del marchio con l'icona e il nome —
-- che e' esattamente quello che si vede adesso, e non e' una foto di un negozio
-- che non e' nostro.
--
-- IL PALETTO. `image_url` finisce dentro l'attributo `src` di un'immagine su una
-- pagina pubblica. Sono ammessi solo un indirizzo `https://` o un percorso del
-- sito che comincia per `/`; e' escluso `//altro-sito/…`, che sembra un percorso
-- del sito ma e' un indirizzo esterno travestito. La stessa regola vive in
-- `lib/immagine-categoria.ts` (che controlla anche il dominio, perche' quello lo
-- sa solo il browser): questa e' la seconda cintura, per cio' che entra nella
-- tabella da una strada che non passa dal codice del sito.
--
-- Additiva e idempotente: si puo' applicare due volte di fila senza rompere
-- niente. Nessun dato esistente viene modificato. La lettura resta pubblica
-- (policy "Anyone can view categories" della 002); la scrittura non ha policy e
-- passa dall'API admin con la chiave di servizio, come per le altre colonne.
--
-- COSA NON FA. Non mette nessuna foto: le foto vere dei negozi di Piacenza sono
-- materia prima che va scattata e caricata, non si generano da qui. E non
-- aggiunge il campo nel pannello: `app/api/admin/categories/route.ts` filtra i
-- campi in arrivo con uno schema, quindi finche' `image_url` non e' in
-- quell'elenco la colonna si riempie solo dal database. Sono due righe, in due
-- file che stanno fuori dal territorio di questa corsia.
--
-- APPLICARLA E' UNA FIRMA DI NICOLA (rosso): tocca lo schema della produzione.

ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS image_url text;

COMMENT ON COLUMN public.categories.image_url IS
  'Foto della tessera di categoria in home. Vuota = si vede il gradiente del marchio. Solo https:// o percorso del sito (/...).';

ALTER TABLE public.categories
  DROP CONSTRAINT IF EXISTS categories_image_url_format;
ALTER TABLE public.categories
  ADD CONSTRAINT categories_image_url_format
  CHECK (
    image_url IS NULL
    OR image_url ~ '^https://[^/\s]+(/|$)'
    OR image_url ~ '^/[^/]'
  );

ALTER TABLE public.categories
  DROP CONSTRAINT IF EXISTS categories_image_url_length;
ALTER TABLE public.categories
  ADD CONSTRAINT categories_image_url_length
  CHECK (image_url IS NULL OR char_length(image_url) <= 500);

NOTIFY pgrst, 'reload schema';

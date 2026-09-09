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
-- IL PALETTO DI PRIMA SI SCAVALCAVA CON UN CARATTERE INVISIBILE.
-- La regola era `image_url ~ '^/[^/]'`: comincia per barra, e il secondo
-- carattere non e' una barra. Sembra chiudere `//altro-sito/…`, e infatti lo
-- chiude. Ma il browser, prima di leggere un indirizzo, TOGLIE tabulazioni, a
-- capo e ritorni carrello — e tratta la barra rovescia come una barra. Quindi
-- passavano di qui, e finivano nel `src` di una pagina pubblica:
--
--     /<TAB>//evil.com/x.jpg      il browser legge   https://evil.com/x.jpg
--     /<A CAPO>//evil.com/x.jpg   il browser legge   https://evil.com/x.jpg
--     /<RITORNO>//evil.com/x.jpg  il browser legge   https://evil.com/x.jpg
--     /\evil.com/x.jpg            il browser legge   https://evil.com/x.jpg
--
-- Non e' teorico: provato l'8/9/2026 su Postgres 16 (il vincolo li accettava
-- tutti e quattro, e la riga entrava davvero in tabella) e riletto col
-- medesimo lettore di indirizzi dei browser, che per tutti e quattro risponde
-- `host: evil.com`. Cioe' esattamente il caso che questo paletto dice di
-- bloccare, entrato per la porta di servizio.
--
-- La regola adesso e' in due pezzi: ① nell'indirizzo non ci puo' stare NESSUN
-- carattere di controllo (`[[:cntrl:]]` — tabulazione, a capo, ritorno
-- carrello e compagnia): un indirizzo d'immagine vero non ne contiene mai, e
-- toglierli tutti spegne l'intera classe invece dei tre casi noti; ② dopo la
-- barra iniziale non ci puo' stare ne' una barra ne' una barra rovescia. Lo
-- stesso vale per il nome del dominio dopo `https://`: niente barra rovescia,
-- cosi' quello che il database chiama dominio e quello che il browser chiama
-- dominio sono la stessa cosa.
--
-- TUTTO DENTRO UNA TRANSAZIONE, E NON E' UN VEZZO.
-- Questo file toglie il vincolo (`DROP CONSTRAINT IF EXISTS`) e subito dopo lo
-- rimette (`ADD CONSTRAINT`). Senza BEGIN, quelle due righe sono due cose
-- separate: la prima si salva da sola. Se fra l'una e l'altra entra una riga
-- che il vincolo nuovo non accetta — la scrive l'API admin con la chiave di
-- servizio, che in quella finestra non trova nessun paletto — l'ADD si ferma
-- con
--     ERROR: check constraint "categories_image_url_format" ... is violated by some row
-- e la tabella resta SENZA vincolo. Per sempre, e senza che nessuno se ne
-- accorga: il file si e' fermato a meta' e la meta' che ha fatto danno e' gia'
-- committata.
--
-- Provato l'8/9/2026 su Postgres 16, secondo giro del file con una riga sporca
-- messa dentro nella finestra: il vincolo del formato e' sparito, la riga
-- `//sito-esterno.example/foto.png` e' rimasta in tabella, e subito dopo la
-- colonna ha accettato `javascript:alert(1)`. Con BEGIN/COMMIT lo stesso
-- identico giro finisce con il vincolo VECCHIO ancora al suo posto e la riga
-- sporca fuori: o il paletto si sostituisce tutto intero, o non si tocca.
-- Vale anche se chi lancia il file dimentica `ON_ERROR_STOP`: a transazione
-- abortita, il COMMIT finale si comporta da ROLLBACK.
--
-- E c'e' un secondo regalo, che e' il motivo per cui la finestra si chiude
-- davvero e non solo quasi: dentro la transazione il DROP tiene il lucchetto
-- pesante (ACCESS EXCLUSIVE) sulla tabella fino al COMMIT, quindi in quel
-- momento nessun altro collegamento puo' infilare la riga sporca. Prima
-- poteva.
--
-- Additiva e idempotente: si puo' applicare due volte di fila senza rompere
-- niente. Nessun dato esistente viene modificato. La lettura resta pubblica
-- (policy "Anyone can view categories" della 002); la scrittura non ha policy e
-- passa dall'API admin con la chiave di servizio, come per le altre colonne.
--
-- SE SI FERMA DICENDO «is violated by some row», in tabella c'e' gia' un
-- indirizzo che il paletto nuovo non accetta (per esempio quello entrato da una
-- vecchia applicazione a meta'). La colonna nasce vuota su tutte le righe,
-- quindi basta guardare chi non lo e':
--
--     SELECT id, slug, image_url FROM public.categories WHERE image_url IS NOT NULL;
--
-- Si corregge o si svuota quella riga (`image_url = NULL` = la tessera torna al
-- gradiente, che e' lo stato normale di oggi) e si rilancia il file. Non lo fa
-- da solo apposta: cancellare dati di nascosto dentro una migrazione e' peggio
-- del problema che risolve.
--
-- COSA NON FA. Non mette nessuna foto: le foto vere dei negozi di Piacenza sono
-- materia prima che va scattata e caricata, non si generano da qui. E non
-- aggiunge il campo nel pannello: `app/api/admin/categories/route.ts` filtra i
-- campi in arrivo con uno schema, quindi finche' `image_url` non e' in
-- quell'elenco la colonna si riempie solo dal database. Sono due righe, in due
-- file che stanno fuori dal territorio di questa corsia.
--
-- APPLICARLA E' UNA FIRMA DI NICOLA (rosso): tocca lo schema della produzione.

BEGIN;

-- Le due regole qui sotto contengono una barra rovescia, e come il database la
-- legge dipende da una bandierina di configurazione del server
-- (`standard_conforming_strings`). Accesa — ed e' accesa di fabbrica dal 2010,
-- Supabase compresa — `'\\'` e' UNA barra rovescia e la regola e' quella
-- scritta. Spenta, la coppia si mangia da sola: resta `^/[^/\]`, che e' una
-- regola con la parentesi quadra mai chiusa.
--
-- E qui viene il brutto, misurato l'8/9/2026 su Postgres 16: la migrazione con
-- la bandierina spenta NON si ferma. Si applica tutta, con due WARNING che
-- nessuno legge, e il vincolo nasce con dentro la regola illeggibile. Il conto
-- arriva dopo, al primo che salva la foto di una categoria:
--     ERROR: invalid regular expression: brackets [] not balanced
-- cioe' il pannello categorie che smette di salvare, per un motivo che non
-- c'entra niente con quello che sta facendo.
--
-- Questa riga toglie di mezzo la dipendenza dalla configurazione del server che
-- riceve il file. `LOCAL` = vale dentro questa transazione e basta.
SET LOCAL standard_conforming_strings = on;

ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS image_url text;

COMMENT ON COLUMN public.categories.image_url IS
  'Foto della tessera di categoria in home. Vuota = si vede il gradiente del marchio. Solo https:// o percorso del sito (/...), senza caratteri di controllo.';

ALTER TABLE public.categories
  DROP CONSTRAINT IF EXISTS categories_image_url_format;
ALTER TABLE public.categories
  ADD CONSTRAINT categories_image_url_format
  CHECK (
    image_url IS NULL
    OR (
      -- ① Nessun carattere di controllo: sono quelli che il browser toglie
      --    prima di leggere l'indirizzo, e che trasformano un percorso di casa
      --    nostra in un indirizzo di un altro sito.
      image_url !~ '[[:cntrl:]]'
      AND (
        -- ② `https://dominio` — nel dominio niente barra rovescia, che il
        --    browser leggerebbe come una barra spostando il dominio vero piu'
        --    in la'. Il dominio ammesso lo decide `lib/immagine-categoria.ts`:
        --    qui si guarda solo la forma.
        image_url ~ '^https://[^/\\\s]+(/|$)'
        -- ③ …oppure un percorso di casa nostra: barra, e dopo ne' una barra
        --    ne' una barra rovescia.
        OR image_url ~ '^/[^/\\]'
      )
    )
  );

ALTER TABLE public.categories
  DROP CONSTRAINT IF EXISTS categories_image_url_length;
ALTER TABLE public.categories
  ADD CONSTRAINT categories_image_url_length
  CHECK (image_url IS NULL OR char_length(image_url) <= 500);

-- Dentro la transazione questo avviso parte al COMMIT: se la migrazione cade,
-- nessuno annuncia a PostgREST uno schema che non e' cambiato.
NOTIFY pgrst, 'reload schema';

COMMIT;

-- =========================================================
-- RITORNO INDIETRO (rollback)
-- =========================================================
-- SE SI E' FERMATA A META': non c'e' niente da fare. La transazione cade tutta
-- e il database e' rimasto identico a prima — colonna e vincoli com'erano, riga
-- sporca fuori. Si sistema il motivo (vedi «is violated by some row» qui sopra)
-- e si rilancia.
--
-- SE E' PASSATA e si vuole tornare indietro, prima si guarda se qualcuno ha
-- gia' messo delle foto:
--
--   SELECT count(*) FROM public.categories WHERE image_url IS NOT NULL;
--
--   · Righe > 0 → togliere la colonna butta via le foto scelte a mano, e non
--     tornano da sole. Se il problema e' solo il paletto, si tolgono i due
--     vincoli e si lascia la colonna:
--
--       BEGIN;
--       ALTER TABLE public.categories DROP CONSTRAINT IF EXISTS categories_image_url_format;
--       ALTER TABLE public.categories DROP CONSTRAINT IF EXISTS categories_image_url_length;
--       NOTIFY pgrst, 'reload schema';
--       COMMIT;
--
--     ⚠️ Cosi' la colonna resta senza seconda cintura: da quel momento l'unico
--     controllo e' `lib/immagine-categoria.ts`, cioe' il codice del sito. Va
--     bene per un'ora, non per un mese.
--
--   · Nessuna riga piena (e' lo stato del giorno in cui questa nasce: la
--     colonna e' vuota su tutte e 72 le categorie) → si toglie tutto, e non si
--     perde niente:
--
--       BEGIN;
--       ALTER TABLE public.categories DROP CONSTRAINT IF EXISTS categories_image_url_format;
--       ALTER TABLE public.categories DROP CONSTRAINT IF EXISTS categories_image_url_length;
--       ALTER TABLE public.categories DROP COLUMN IF EXISTS image_url;
--       NOTIFY pgrst, 'reload schema';
--       COMMIT;
--
--     Il codice regge il ritorno indietro senza toccarlo: `fotoDiCategoria`
--     dichiara `image_url` come `unknown` proprio perche' la colonna puo' non
--     esserci, e in quel caso risponde «nessuna foto» — cioe' la tessera col
--     gradiente, che e' quello che si vede oggi.
-- =========================================================

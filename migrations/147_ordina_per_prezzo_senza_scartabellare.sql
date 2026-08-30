-- «Ordina per prezzo» faceva scorrere tutto il catalogo, ogni volta.
--
-- IL DIFETTO (radiografia del 27/8/2026, R074). Il sito offre «ordina per prezzo» e i filtri prezzo
-- minimo/massimo su ogni griglia di prodotti — home, categorie, vetrina del negozio, risultati di
-- ricerca (lib/queries/griglia-prodotti.ts, righe 107-118). Su `products` c'erano nove indici e
-- nessuno conteneva `price`: cercato con `grep -i price` su tutte le 139 migrazioni, zero righe.
--
-- Misurato sul database ricostruito dalle migrazioni, con ventimila prodotti dentro e le statistiche
-- aggiornate, il piano di esecuzione della lettura piu' calda del sito era:
--   Limit → Sort (Sort Key: price) → Seq Scan on products
-- cioe': leggi tutto il catalogo, ordinalo tutto in memoria, e poi tieni le prime ventiquattro righe.
--
-- QUANTO PESA, ONESTAMENTE. Finche' i prodotti sono qualche migliaio non si vede: PostgreSQL ordina
-- in memoria in pochi millisecondi. Il costo si materializza esattamente quando il catalogo diventa
-- interessante — un supermercato o una ferramenta che importa il suo listino basta ad arrivare alle
-- decine di migliaia — e in Supabase e' processore che si paga a consumo.
--
-- LA RIPARAZIONE. Due indici PARZIALI, cioe' che contengono solo le righe in vendita: sono quelle e
-- solo quelle che il sito ordina per prezzo. Parziali costano poco anche in scrittura, perche' un
-- prodotto in bozza o esaurito non entra nemmeno.
--
--   · `products_status_price_idx` — «ordina per prezzo» su tutto il catalogo, e i filtri da/a.
--   · `products_category_price_idx` — la stessa cosa dentro una categoria, che e' la strada da cui
--     arriva chi naviga invece di cercare.
--
-- Col secondo indice il piano diventa `Index Scan using products_category_price_idx`, senza nessun
-- ordinamento in memoria; e con la regola di lettura pubblica accesa (il ruolo `anon`) l'indice viene
-- usato lo stesso, con il controllo «il negozio e' approvato?» applicato sopra.
--
-- REVERSIBILE: `DROP INDEX public.products_status_price_idx;` e
-- `DROP INDEX public.products_category_price_idx;`.
--
-- LA PROVA: tests/sql/rls/26-ordina-per-prezzo-senza-scartabellare.test.sql — ventimila prodotti veri
-- e il piano di esecuzione letto dal database. Senza questa migrazione e' rosso.

CREATE INDEX IF NOT EXISTS products_status_price_idx
  ON public.products (status, price)
  WHERE status = 'available';

CREATE INDEX IF NOT EXISTS products_category_price_idx
  ON public.products (category_id, price)
  WHERE status = 'available';

NOTIFY pgrst, 'reload schema';

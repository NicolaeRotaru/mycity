-- Le taglie e le giacenze si leggevano anche dei prodotti che nessuno doveva ancora vedere.
--
-- IL DIFETTO (radiografia del 27/8/2026, R033). La regola di lettura di `product_variants` era
-- `USING (true)` (080, riga 45), con sopra scritto: «le varianti seguono la visibilita' del prodotto
-- (che e' gia' gated dalla RLS di products)». Non e' cosi'. In PostgreSQL i permessi si applicano
-- tabella per tabella: chi chiede direttamente `product_variants` non passa mai da `products`, e la
-- lettura di `product_variants` era concessa anche ad `anon`, cioe' alla chiave pubblica che ha ogni
-- browser.
--
-- Misurato sul database ricostruito dalle migrazioni: un negozio NON approvato, con un prodotto in
-- stato `draft` e una variante «Grande» da 7 pezzi. Letto col ruolo `anon`: prodotti visti 0,
-- varianti viste 1 — con l'etichetta e la giacenza dentro.
--
-- COSA USCIVA: l'identificativo del prodotto, le opzioni (taglie, colori, pezzature), l'etichetta e
-- la giacenza in tempo reale. Anche dei prodotti che il negozio sta ancora preparando. Un concorrente
-- leggeva il magazzino delle botteghe di Piacenza e vedeva in anticipo cosa stanno per mettere in
-- vendita. Al negoziante avevamo promesso l'opposto: i suoi dati restano suoi.
--
-- LA RIPARAZIONE. La variante chiede al prodotto se e' in vetrina, ma non con una domanda annidata:
-- quella verrebbe eseguita coi permessi di chi guarda ed e' esattamente l'errore che il 27/8 aveva
-- reso invisibile tutto il catalogo (vedi 129). Si riusa `public.prodotto_in_vetrina`, la funzione a
-- permessi di definizione creata nella 129 riga 57, che risponde solo si' o no e non restituisce
-- nessuna riga.
--
-- IL NEGOZIO CONTINUA A VEDERE LE SUE. La regola `product_variants_modify` (080, riga 51) e' `FOR
-- ALL` e in PostgreSQL una regola `FOR ALL` vale anche in lettura; le regole permissive si sommano.
-- Quindi il venditore vede le varianti dei propri prodotti anche in bozza, ed e' quello che serve
-- alla pagina «modifica prodotto» (lib/products/persistVariants.ts). Il controllo ⑬ della prova lo
-- verifica: una riparazione che chiude la porta anche al proprietario non e' una riparazione.
--
-- E L'AMMINISTRATORE PURE, ED E' LA PARTE CHE STAVA PER FAR DANNI. La pagina
-- `app/admin/products/[id]/edit/page.tsx` carica le varianti dal browser con la sessione
-- dell'amministratore, non con la chiave di servizio. Con la sola regola nuova, su un prodotto in
-- bozza avrebbe letto zero varianti — e al salvataggio il confronto insert/update/delete di
-- `saveProductVariantsServer` avrebbe letto quel vuoto come «l'amministratore le ha tolte» e le
-- avrebbe cancellate davvero. Per questo la regola ha lo stesso ramo che ha gia' `products`
-- («Admins can read all products», `USING (is_admin())`): tre porte, le stesse tre di prima.
--
-- L'INDICE CHE SERVE C'E' GIA': `product_variants_product_id_idx` (080, riga 28).
--
-- REVERSIBILE: `DROP POLICY product_variants_select ON public.product_variants;` e ricrearla con
-- `USING (true)`, che e' il testo della 080.
--
-- LA PROVA: tests/sql/rls/19-il-catalogo-si-vede-anche-senza-account.test.sql, controlli ⑪ ⑫ ⑬.
-- Senza questa migrazione il controllo ⑪ e' rosso.

DROP POLICY IF EXISTS product_variants_select ON public.product_variants;
CREATE POLICY product_variants_select ON public.product_variants
  FOR SELECT USING (public.prodotto_in_vetrina(product_id) OR public.is_admin());

NOTIFY pgrst, 'reload schema';

-- I due numeri che diventano un bonifico e uno scontrino non avevano nessun paletto.
--
-- IL DIFETTO (radiografia del 27/8/2026, R036). Elencando dal catalogo del database tutti i controlli
-- delle tabelle dei soldi, su `orders` ce ne sono cinque e sono fatti bene: totale non negativo
-- (001), lordo non negativo, rimborso non negativo, rimborso non oltre il lordo (127, righe 275-287),
-- compenso del fattorino fra zero e cinquanta euro (114, riga 145).
--
-- Mancava proprio quello sul numero che finisce sul conto del negoziante: `seller_payout_cents` non
-- aveva nessun controllo, e non aveva nemmeno il gemello del rimborso, cioe' «non puo' superare
-- l'incasso». E su `order_items` l'unico controllo era quello di nascita — la quantita' maggiore di
-- zero (001, riga 41) — mentre `unit_price` (riga 42) era libero di essere negativo.
--
-- Oggi quei numeri li scrive solo il server, e li calcola bene: non c'era un danno in corso. Il punto
-- e' un altro. Sono gli unici numeri della catena dei soldi che il database non difende da solo, e il
-- resto della tabella dimostra che il criterio del progetto e' difenderli. Il paletto e' la cintura di
-- sicurezza per il giorno in cui una riparazione futura sbaglia un conto: senza, l'errore passa in
-- silenzio ed esce dalla banca come un pagamento sbagliato a un negozio; con, si ferma sulla riga.
--
-- PERCHE' «NOT VALID» E POI «VALIDATE», IN DUE PASSI. Aggiungere un controllo gia' valido blocca la
-- tabella per tutto il tempo della verifica: su `orders` vuol dire fermare le casse. `NOT VALID` vale
-- da subito sulle scritture nuove e non guarda il passato; `VALIDATE` ricontrolla il passato senza
-- bloccare chi scrive. La 127 avvertiva che tre vincoli erano stati aggiunti `NOT VALID` e poi mai
-- validati: qui la validazione si fa, non si rimanda — un vincolo di cui non sai se vale e' peggio di
-- uno che non c'e' (ed e' anche il controllo ⑤ di tests/sql/rls/14).
--
-- SE IL PASSATO NON REGGE. La validazione non fa fallire il rilascio: se in produzione esistono righe
-- storte, la migrazione lo grida nei log con il conto esatto e lascia il vincolo `NOT VALID`, cioe'
-- comunque attivo su tutto quello che si scrive da adesso. Quelle righe vanno guardate una per una,
-- perche' sono soldi:
--   SELECT count(*) FROM public.orders
--    WHERE seller_payout_cents < 0
--       OR (gross_total_cents IS NOT NULL AND seller_payout_cents > gross_total_cents);
--   SELECT count(*) FROM public.order_items WHERE unit_price < 0;
--
-- REVERSIBILE: `ALTER TABLE public.orders DROP CONSTRAINT orders_payout_venditore_sensato;` e
-- `ALTER TABLE public.order_items DROP CONSTRAINT order_items_prezzo_non_negativo;`.
--
-- LA PROVA: tests/sql/rls/25-sui-soldi-non-si-scrivono-numeri-storti.test.sql. Non cerca il nome del
-- vincolo: prova a scrivere i numeri sbagliati e pretende un rifiuto, poi scrive quelli giusti e
-- pretende che passino. Senza questa migrazione e' rossa.

-- =========================================================
-- ① I DUE PALETTI
-- =========================================================
DO $$ BEGIN
  ALTER TABLE public.orders
    ADD CONSTRAINT orders_payout_venditore_sensato CHECK (
      seller_payout_cents IS NULL
      OR (seller_payout_cents >= 0
          AND (gross_total_cents IS NULL OR seller_payout_cents <= gross_total_cents))
    ) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.order_items
    ADD CONSTRAINT order_items_prezzo_non_negativo CHECK (unit_price >= 0) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =========================================================
-- ② LA VALIDAZIONE SUL PASSATO
-- =========================================================
DO $$
DECLARE storte int;
BEGIN
  ALTER TABLE public.orders VALIDATE CONSTRAINT orders_payout_venditore_sensato;
EXCEPTION WHEN check_violation THEN
  SELECT count(*) INTO storte FROM public.orders
   WHERE seller_payout_cents < 0
      OR (gross_total_cents IS NOT NULL AND seller_payout_cents > gross_total_cents);
  RAISE WARNING 'orders: % ordini hanno un compenso al negozio storto (negativo o oltre l''incasso). Il paletto resta attivo sulle scritture nuove ma NON validato: quelle righe vanno guardate una per una, sono soldi.', storte;
END $$;

DO $$
DECLARE storte int;
BEGIN
  ALTER TABLE public.order_items VALIDATE CONSTRAINT order_items_prezzo_non_negativo;
EXCEPTION WHEN check_violation THEN
  SELECT count(*) INTO storte FROM public.order_items WHERE unit_price < 0;
  RAISE WARNING 'order_items: % righe d''ordine hanno un prezzo negativo. Il paletto resta attivo sulle scritture nuove ma NON validato: da guardare una per una.', storte;
END $$;

COMMENT ON CONSTRAINT orders_payout_venditore_sensato ON public.orders IS
  'Il compenso del negozio non e'' negativo e non supera l''incasso dell''ordine. R036, 27/8/2026.';
COMMENT ON CONSTRAINT order_items_prezzo_non_negativo ON public.order_items IS
  'Il prezzo di una riga d''ordine non e'' negativo. R036, 27/8/2026.';

NOTIFY pgrst, 'reload schema';

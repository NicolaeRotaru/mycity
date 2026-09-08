-- ═══════════════════════════════════════════════════════════════════════════
-- 160 — LA MERCE TORNA A SCAFFALE UNA VOLTA SOLA
-- 8/9/2026 · corsia «pagamenti-stripe» del lotto dei gravi
-- ═══════════════════════════════════════════════════════════════════════════
--
-- COSA SI ROMPE OGGI
-- `restore_stock_for_order` e' una somma secca: `stock = stock + oi.quantity`.
-- Non porta nessun segno di «gia' fatto», quindi due chiamate sullo stesso
-- ordine sommano due volte. Il negozio ha un pezzo e il sito ne offre due: il
-- secondo cliente paga una cosa che non esiste, e a valle c'e' un rimborso piu'
-- un negoziante che deve dire di no.
--
-- Fin qui non e' successo per una COINCIDENZA, non per una difesa. Chi chiama
-- questa funzione lo fa dentro un'operazione che puo' avvenire una volta sola:
-- il rimborso pieno (dopo, non resta niente da rimborsare), l'annullo con la
-- rivendicazione atomica (`.neq('delivery_status','CANCELED')`), il rifiuto del
-- negozio (`current_status NOT IN ('NEW','ACCEPTED')`). Sono sei guardie
-- diverse, ognuna a casa sua, e ognuna e' l'occasione di dimenticarsene la
-- settima volta. E' successo: la bandiera `annullaLOrdine` di `refundOrder`
-- («cliente assente»: la merce torna, i soldi tornano al netto della consegna)
-- ha allargato la condizione che innesca la somma senza rendere la somma
-- ripetibile.
--
-- COSA FA QUESTA MIGRAZIONE
-- Mette il segno che mancava — `orders.stock_restored_at` — e lo fa prendere
-- dalla funzione stessa, con una rivendicazione atomica: la prima chiamata
-- scrive la data e rimette la merce, ogni chiamata successiva non trova piu' la
-- riga da rivendicare e non fa niente. Regge anche contro due chiamate partite
-- insieme, cosa che nessun controllo scritto nel codice puo' fare.
--
-- La firma della funzione non cambia (`RETURNS void`): tutti e otto i posti che
-- la chiamano — due in `refundOrder`, il giro degli ordini fermi, i rimborsi e
-- le contestazioni del webhook, `annullaERimborsa`, `cancel_order`,
-- `seller_reject_order` — diventano sicuri senza toccare una riga di codice.
-- E' questa la ragione per cui la guardia sta QUI e non nel codice: non c'e'
-- nessun posto in cui la prossima persona possa dimenticarsene.
--
-- IL RIEMPIMENTO E' PRUDENTE APPOSTA
-- Agli ordini gia' annullati si scrive `stock_restored_at = canceled_at`: si
-- assume cioe' che la merce sia GIA' tornata. Fra le due letture possibili si
-- sceglie quella che non somma. Il costo dell'errore non e' simmetrico: un
-- pezzo che resta invisibile lo vede il negoziante e si sistema in un minuto,
-- un pezzo fantasma lo scopre un cliente che ha gia' pagato.
--
-- RISCHIO / REVERSIBILITA'
-- Nessun dato viene cancellato o riscritto: si aggiunge una colonna e si
-- ridefinisce una funzione. Il ritorno indietro sta in fondo al file ed e' la
-- definizione della migrazione 080, identica.
--
-- QUANDO APPLICARLA: a bassa attivita'. C'e' una finestra di pochi secondi in
-- cui il riempimento ② potrebbe marcare un ordine annullato un attimo prima dal
-- giro degli ordini fermi, con il suo rimborso ancora per strada: quella merce
-- non tornerebbe a scaffale e la rimetterebbe il negoziante a mano. E' il verso
-- prudente dell'errore — un pezzo in meno in vetrina, non uno in piu' — ma un
-- minuto scelto bene lo evita del tutto.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ① Il segno che mancava.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS stock_restored_at timestamptz;

COMMENT ON COLUMN public.orders.stock_restored_at IS
  'Quando la merce di questo ordine e'' tornata a scaffale. Lo scrive restore_stock_for_order come rivendicazione: se c''e'' gia'', la merce non si somma una seconda volta.';

-- ② Il riempimento prudente: ordine gia' annullato = merce gia' tornata.
--
-- LA CHIAVE DI SESSIONE NON E' UN AGGIRAMENTO, E' L'UNICO MODO.
-- `stock_restored_at` non sta nell'elenco dei campi che un client puo' toccare,
-- e `enforce_order_update_rules` (114, riscritta dalla 127) e' un grilletto PER
-- RIGA: senza la chiave, questa riga si ferma con
--     ERROR: orders: modifica di un campo protetto non consentita   (42501)
-- e fa cadere TUTTA la migrazione, colonna compresa. Su una tabella `orders`
-- vuota non si vede — zero righe, zero grilletti — ed e' esattamente cosi' che
-- e' passata la prima volta. Con un solo ordine annullato in tabella, no.
--
-- Si usa la stessa chiave delle RPC del progetto (061/063) e del riempimento
-- della 094: dura quanto la transazione. Qui la si rimette giu' appena finito
-- il riempimento, cosi' il resto della migrazione gira con la guardia accesa —
-- e' la lezione ⑩ della 127: la porta si apre un attimo prima di passare, non
-- all'inizio del giro.
DO $riempimento$
BEGIN
  PERFORM set_config('mycity.allow_order_write', '1', true);

  UPDATE public.orders
     SET stock_restored_at = COALESCE(canceled_at, now())
   WHERE delivery_status = 'CANCELED'
     AND stock_restored_at IS NULL;

  PERFORM set_config('mycity.allow_order_write', '', true);
END
$riempimento$;

-- ③ La somma diventa una rivendicazione.
CREATE OR REPLACE FUNCTION public.restore_stock_for_order(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Il turno si prende con la scrittura. Chi arriva secondo trova la riga gia'
  -- rivendicata e se ne va senza toccare il magazzino. Due chiamate partite
  -- insieme si mettono in fila sul lock della riga: passa una sola.
  PERFORM set_config('mycity.allow_order_write', '1', true);

  UPDATE public.orders
     SET stock_restored_at = now()
   WHERE id = p_order_id
     AND stock_restored_at IS NULL;

  IF NOT FOUND THEN
    -- Ordine inesistente, oppure merce gia' rimessa: in tutti e due i casi non
    -- si somma niente. Non e' un errore: chi chiama ritenta in pace.
    RETURN;
  END IF;

  -- Da qui in giu' e' identico alla 080.
  -- Righe con variante → ripristina la variante.
  UPDATE public.product_variants v
    SET stock = v.stock + oi.quantity
  FROM public.order_items oi
  WHERE oi.order_id = p_order_id AND oi.variant_id = v.id;

  -- Righe senza variante → ripristina il prodotto.
  UPDATE public.products p
    SET stock = p.stock + oi.quantity
  FROM public.order_items oi
  WHERE oi.order_id = p_order_id
    AND oi.product_id = p.id
    AND oi.variant_id IS NULL
    AND p.stock IS NOT NULL;
END; $$;

-- ④ I permessi restano quelli di sempre: nessun client la esegue.
REVOKE ALL ON FUNCTION public.restore_stock_for_order(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restore_stock_for_order(uuid) TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════════════
-- RITORNO INDIETRO (rollback) — si incolla e si esegue, in questo ordine:
-- ═══════════════════════════════════════════════════════════════════════════
-- BEGIN;
-- CREATE OR REPLACE FUNCTION public.restore_stock_for_order(p_order_id uuid)
-- RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
-- BEGIN
--   UPDATE public.product_variants v
--     SET stock = v.stock + oi.quantity
--   FROM public.order_items oi
--   WHERE oi.order_id = p_order_id AND oi.variant_id = v.id;
--   UPDATE public.products p
--     SET stock = p.stock + oi.quantity
--   FROM public.order_items oi
--   WHERE oi.order_id = p_order_id
--     AND oi.product_id = p.id
--     AND oi.variant_id IS NULL
--     AND p.stock IS NOT NULL;
-- END; $$;
-- ALTER TABLE public.orders DROP COLUMN IF EXISTS stock_restored_at;
-- COMMIT;
-- NOTIFY pgrst, 'reload schema';
--
-- Il ritorno indietro toglie la colonna: nessun altro pezzo la legge (il codice
-- non la chiede nemmeno nella select), quindi non lascia niente rotto dietro.
-- ═══════════════════════════════════════════════════════════════════════════

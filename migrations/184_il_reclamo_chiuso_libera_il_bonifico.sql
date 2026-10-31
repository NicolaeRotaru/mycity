-- =============================================================================
-- 184 — UN RECLAMO CHIUSO A FAVORE DEL NEGOZIO LIBERA DI NUOVO IL BONIFICO
-- =============================================================================
-- 31/10/2026.
--
-- IL DIFETTO. Il trigger `trg_dispute_block_payout` (migrazione 063, mai
-- ridefinito) scatta a ogni riga nuova in `disputes`, cioè a ogni reclamo che
-- il cliente o il negozio apre dall'app, e scriveva `orders.dispute_status =
-- 'OPEN'`. Dalla 119 quella colonna e' solo del CHARGEBACK BANCARIO (la
-- contestazione aperta in banca) e la scrive il webhook Stripe; il reclamo
-- interno ha la sua colonna, `internal_dispute_status`.
--
-- La conseguenza: chi chiude il reclamo (app/api/admin/disputes/[id]/resolve)
-- scrive giustamente solo `internal_dispute_status` ('RESOLVED' o 'LOST'), e
-- non tocca la colonna della banca. Ma il giro dei bonifici
-- (app/api/cron/release-payouts) paga solo gli ordini con `dispute_status`
-- vuoto o 'WON': il 'OPEN' messo dal trigger restava per sempre, e un reclamo
-- chiuso A FAVORE DEL NEGOZIO lasciava il negozio senza il suo bonifico per
-- quell'ordine, in silenzio.
--
-- COSA FA. Ridefinisce la funzione del trigger: all'apertura di un reclamo
-- scrive 'OPEN' nella colonna DEL RECLAMO (`internal_dispute_status`), non in
-- quella della banca. Il giro la legge gia' (paga solo vuoto o 'RESOLVED'),
-- quindi il bonifico resta fermo finche' il reclamo e' aperto, e riparte da
-- solo quando chi decide lo chiude a favore del negozio. Il trigger non
-- sovrascrive:
--   · 'LOST' (rimborso intero al cliente: al negozio non spetta piu' niente);
--   · 'RIMBORSO_DA_RIPARTIRE' (la pausa del carrello di piu' negozi, che toglie
--     solo la divisione — lib/stripe/rimborsi-da-fuori.ts). Anche in quel caso
--     il giro non paga finche' il reclamo e' aperto: legge i reclami aperti
--     dalla tabella `disputes`.
-- Un reclamo nuovo su un ordine con un reclamo vecchio gia' 'RESOLVED' lo
-- riporta a 'OPEN'.
--
-- COSA NON FA. Non tocca le righe gia' scritte: un ordine che ha oggi
-- `dispute_status = 'OPEN'` puo' averlo dal trigger vecchio OPPURE da una
-- contestazione vera in banca, e dal database non si distinguono. Separarli
-- chiede il controllo su Stripe, ordine per ordine. Il trigger resta lo
-- stesso (nome, momento, tabella): cambia solo la funzione.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.dispute_block_payout()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM set_config('mycity.allow_order_write', '1', true);
  UPDATE public.orders
     SET internal_dispute_status = 'OPEN'
   WHERE id = NEW.order_id
     AND (internal_dispute_status IS NULL OR internal_dispute_status = 'RESOLVED');
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.dispute_block_payout() FROM anon, authenticated;

COMMENT ON FUNCTION public.dispute_block_payout() IS
  'All''apertura di un reclamo interno ferma il bonifico scrivendo orders.internal_dispute_status = OPEN. Non tocca dispute_status: quella e la colonna del chargeback bancario e la scrive solo il webhook Stripe (184).';

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
-- PERCHE' NON SCRIVE SU NESSUNA COLONNA DELL'ORDINE. La prima versione di
-- questa migrazione spostava il 'OPEN' su `internal_dispute_status`. Il
-- collaudo del 31/10 l'ha bocciata con un caso vero: su quella colonna sta
-- anche la pausa del carrello di piu' negozi ('RIMBORSO_DA_RIPARTIRE'), che il
-- webhook mette quando dal cruscotto Stripe parte un rimborso da dividere
-- (lib/stripe/webhook/rimborsi-da-fuori.ts, fermaIBonifici). La pausa si
-- mette solo sugli ordini con lo stato vuoto o 'RESOLVED': un ordine con il
-- reclamo aperto ('OPEN') restava senza pausa, chiuso il reclamo tornava
-- 'RESOLVED' e il giro gli versava il netto intero prima della divisione.
--
-- COSA FA. Ridefinisce la funzione del trigger perche' non scriva piu' niente
-- sull'ordine. Il bonifico con un reclamo aperto lo ferma gia' il giro
-- (app/api/cron/release-payouts), che legge i reclami aperti dalla tabella
-- `disputes` (status 'open' o 'under_review') sia per la carta sia per i
-- contanti, e che da questo giro non paga se quella lettura non riesce. Cosi':
--   · reclamo aperto  → il giro non paga (lo legge da `disputes`);
--   · reclamo chiuso a favore del negozio → la rotta di chiusura scrive
--     'RESOLVED' e il giro paga, senza nessun 'OPEN' rimasto indietro;
--   · rimborso intero al cliente → 'LOST', il giro non paga;
--   · rimborso dal cruscotto su un carrello di piu' negozi → la pausa si
--     mette anche sul negozio del reclamo, e la chiusura del reclamo non la
--     toglie (SENZA_LA_PAUSA_DEL_CARRELLO): la toglie solo la divisione.
-- La colonna della banca (`dispute_status`) la scrive solo il webhook Stripe.
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
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.dispute_block_payout() FROM anon, authenticated;

COMMENT ON FUNCTION public.dispute_block_payout() IS
  'Dalla 184 non scrive sull''ordine: il bonifico con un reclamo aperto lo ferma il giro leggendo la tabella disputes. dispute_status e del chargeback bancario (solo webhook Stripe); internal_dispute_status porta l''esito del reclamo e la pausa del carrello.';

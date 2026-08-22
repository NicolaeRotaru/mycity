-- ═══════════════════════════════════════════════════════════════════════════
-- 126 — QUANTO E' STATO RICHIAMATO INDIETRO PER LA CONTESTAZIONE, E NIENT'ALTRO
-- ═══════════════════════════════════════════════════════════════════════════
-- Dalla radiografia del 21/8/2026, difetto sulla contestazione vinta.
--
-- IL DIFETTO. Quando una contestazione si vince, gli ordini tornavano in coda
-- per il bonifico scrivendo `seller_payout_reversed_cents = 0`. Ma quel campo
-- e' un TOTALE CUMULATO: dentro ci puo' essere anche uno storno che con la
-- contestazione non c'entra niente — per esempio un reso parziale rimborsato
-- settimane prima, in cui il negozio aveva gia' restituito la sua quota.
--
-- Azzerandolo, il conto del residuo tornava al netto pieno e il giro dei
-- bonifici versava tutto. Il negozio incassava una seconda volta la parte che
-- aveva gia' reso, e la differenza la metteva MyCity. Si perdeva anche la
-- traccia di quanto era stato davvero recuperato su quell'ordine.
--
-- LA CURA. Due colonne che tengono da parte SOLO quello che e' stato richiamato
-- indietro per la contestazione. Alla chiusura si sottrae quella cifra, invece
-- di azzerare tutto.
--
-- Idempotente. Colonne nuove con valore predefinito 0: il codice vecchio non le
-- guarda, il codice nuovo regge anche prima che questa migrazione sia applicata
-- (lib/db/migrazione-124.ts, stesso ripiego).
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS dispute_seller_reversed_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dispute_rider_reversed_cents  integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.orders.dispute_seller_reversed_cents IS
  'Quanto e stato richiamato indietro al negozio PER LA CONTESTAZIONE aperta. Si sottrae al totale stornato quando la contestazione si vince. Zero quando non ce n e una in corso.';
COMMENT ON COLUMN public.orders.dispute_rider_reversed_cents IS
  'Come sopra, per il compenso del fattorino.';

NOTIFY pgrst, 'reload schema';


-- ═══════════════════════════════════════════════════════════════════════════
-- ② IL BONIFICO CHE RESTA FERMO A META', E CHE NESSUNO RIPESCA
-- ═══════════════════════════════════════════════════════════════════════════
-- Il giro dei bonifici prende il turno su un ordine scrivendo
-- `payout_status = 'PROCESSING'`, poi chiama Stripe. Se il processo muore in
-- mezzo — un tetto di durata della richiesta, il riavvio di un'istanza — quello
-- stato resta scritto. E i candidati del giro successivo sono solo 'HELD' e
-- 'PENDING_SELLER_ONBOARDING': quell'ordine non viene ripescato MAI PIU'.
--
-- L'unico rimedio era una scrittura a mano nel database. Per il negoziante il
-- bonifico e' lo stipendio: un pagamento fermo a tempo indeterminato, con pochi
-- negozi veri, pesa quanto decine in un marketplace grande.
--
-- LA CURA e' la stessa gia' usata sugli eventi Stripe: il turno si data. Un
-- turno vecchio si puo' riprendere, perche' la chiave di idempotenza del
-- bonifico (`payout_seller_<id>_t<n>`) rende sicuro il ritentativo — se il
-- trasferimento era davvero partito, Stripe restituisce quello e non ne crea
-- un altro.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS payout_claimed_at       timestamptz,
  ADD COLUMN IF NOT EXISTS rider_payout_claimed_at timestamptz;

COMMENT ON COLUMN public.orders.payout_claimed_at IS
  'Quando il giro dei bonifici ha preso in carico questo ordine. Un turno piu vecchio di 15 minuti si puo riprendere: vuol dire che chi l aveva preso e morto per strada.';
COMMENT ON COLUMN public.orders.rider_payout_claimed_at IS
  'Come sopra, per il compenso del fattorino.';

-- L'indice che rende economica la domanda «quali turni sono rimasti appesi?».
CREATE INDEX IF NOT EXISTS orders_payout_appesi_idx
  ON public.orders (payout_claimed_at)
  WHERE payout_status = 'PROCESSING';

NOTIFY pgrst, 'reload schema';


-- ═══════════════════════════════════════════════════════════════════════════
-- ③ IL CARRELLO IN CUI L'INCASSO NON TORNA HA UNO STATO SUO
-- ═══════════════════════════════════════════════════════════════════════════
-- Quando l'importo incassato da Stripe non coincide col preventivo, il webhook
-- lanciava un errore perche' Stripe riprovasse. Ma quello scarto nasce da come
-- i due totali sono calcolati: se c'e' una volta c'e' tutte le volte, e ogni
-- ritentativo falliva identico. Il cliente restava con i soldi presi e nessun
-- ordine, gli amministratori ricevevano lo stesso avviso a ripetizione, e dopo
-- giorni di fallimenti Stripe disattiva l'indirizzo del webhook: da li' in poi
-- si fermano TUTTI i pagamenti.
--
-- Adesso e' uno stato finale, e ha un nome che si vede nei dati: si rimborsa,
-- si avvisa una volta, e il carrello resta marcato per essere guardato.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.pending_checkouts
  DROP CONSTRAINT IF EXISTS pending_checkouts_status_check;

ALTER TABLE public.pending_checkouts
  ADD CONSTRAINT pending_checkouts_status_check
  CHECK (status = ANY (ARRAY['PENDING', 'COMPLETED', 'EXPIRED', 'CANCELED', 'MISMATCH']));

NOTIFY pgrst, 'reload schema';

-- =========================================================
-- R038 — LO STATO «STORNO FALLITO» ERA SPARITO DAL DATABASE
-- =========================================================
-- 27/8/2026.
--
-- COSA SUCCEDEVA. Quando Stripe rimborsa un cliente, il codice prova a
-- riprendere dal negozio la sua quota. Se quel recupero fallisce, l'ordine
-- viene marcato 'REVERSAL_FAILED': vuol dire «il cliente ha avuto indietro i
-- soldi, ma dal negozio non sono rientrati» — sono soldi da recuperare a mano,
-- e quello stato è l'unico posto in cui questo resta scritto.
--
-- La migrazione 119 quello stato ce l'aveva (riga 801). La 124, che ha
-- ricreato lo stesso vincolo per aggiungere 'CASH_IN_STORE', l'ha perso per
-- strada: nell'elenco nuovo 'REVERSAL_FAILED' non c'è.
--
-- Il guaio non è che lo stato non si scrive: è che la scrittura viaggia
-- INSIEME agli altri campi del rimborso — payment_status, l'importo
-- rimborsato, lo stato della consegna. Postgres rifiuta la riga INTERA. Quindi
-- nel caso peggiore — soldi usciti verso il cliente e non rientrati dal
-- negozio — nel database non veniva registrato NIENTE: l'ordine restava
-- «pagato e da pagare al negozio», e il giro dei bonifici poteva ancora
-- pagarlo. Doppia uscita sullo stesso ordine.
--
-- Qui l'elenco torna completo. Nel codice c'è anche il ripiego: se questo
-- vincolo non fosse ancora applicato, cade solo il promemoria e non tutto il
-- resto della registrazione del rimborso (lib/stripe/webhook/rimborsi.ts).
--
-- L'elenco è quello della 124 più 'REVERSAL_FAILED'. La clausola sul NULL
-- viene dalla 119: un ordine senza stato di pagamento al venditore è legittimo
-- (nasce così), e il vincolo non deve rifiutarlo.

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_payout_status_check;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_payout_status_check
  CHECK (payout_status IS NULL OR payout_status IN (
    'PENDING',
    'HELD',
    'PROCESSING',
    'TRANSFERRED',
    'REFUNDED',
    'FAILED',
    'PENDING_SELLER_ONBOARDING',
    'REVERSED',
    'REVERSAL_FAILED',
    'AWAITING_REMITTANCE',
    'CASH_IN_STORE'
  ));

COMMENT ON COLUMN public.orders.payout_status IS
  'Stato del pagamento al venditore. CASH_IN_STORE = ritiro in negozio pagato in contanti: il negozio ha gia'' incassato tutto alla cassa, non gli spetta nessun bonifico e resta da regolare la commissione MyCity. REVERSAL_FAILED = il cliente e'' stato rimborsato ma i soldi dal negozio non sono rientrati: vanno recuperati a mano.';

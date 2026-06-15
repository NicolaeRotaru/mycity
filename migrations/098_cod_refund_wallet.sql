-- 098_cod_refund_wallet.sql
--
-- 🟠-18 — rimborso COD su wallet: idempotenza.
--
-- Contesto: i resi/dispute approvati sugli ordini COD non rimborsavano nulla
-- (refundOrder falliva senza payment_intent). Ora refundOrder accredita il buyer
-- sul wallet (reason='cod_refund'). Per non accreditare due volte in caso di
-- doppio-click su "approva reso"/"risolvi dispute", un solo accredito 'cod_refund'
-- per `ref` (l'idempotencyKey del reso/dispute, es. return_<id>): un secondo
-- tentativo viola l'indice (23505) e refundOrder lo tratta come no-op.
--
-- Solo dati/indice (nessun cambio di logica DB) → non-bloccante per il deploy:
-- senza l'indice il codice funziona comunque, solo senza la garanzia anti-doppio.
--
-- Idempotente.

CREATE UNIQUE INDEX IF NOT EXISTS wallet_ledger_cod_refund_ref_idx
  ON public.wallet_ledger (ref)
  WHERE reason = 'cod_refund';

NOTIFY pgrst, 'reload schema';

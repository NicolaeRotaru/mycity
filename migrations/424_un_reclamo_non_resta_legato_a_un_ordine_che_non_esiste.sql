-- Un reclamo poteva restare legato a un ordine che non esiste.
--
-- IL DIFETTO (R18-020). `disputes.order_id` nasce nella 027 (riga 330) come `uuid NOT NULL` senza
-- REFERENCES orders, e nessuna migrazione dopo aggiunge il legame. Lo stesso per
-- `loyalty_transactions.order_id` (027) e `zone_code_uses.order_id` (033). La regola di inserimento
-- dei reclami obbliga il cliente a scegliere un suo ordine, quindi l'orfano nasce quando l'ordine
-- viene cancellato dopo: il reclamo resta nel pannello senza ordine, il blocco del bonifico non trova
-- piu' l'ordine e nessuno sa a chi restituire i soldi.
--
-- LA CURA. Le tre chiavi esterne verso orders(id).
--   · disputes: ON DELETE RESTRICT. Un reclamo e' una richiesta di soldi: non deve sparire insieme
--     all'ordine (CASCADE) e non puo' restare senza (la colonna e' NOT NULL). Nel resto dello schema
--     la storia dei soldi non si cancella a cascata (orders verso profiles e' SET NULL), e nel sito
--     un ordine si cancella solo nel ripiego subito dopo averlo creato (app/api/orders/cod/route.ts,
--     lib/stripe/webhook/ordini.ts), quando un reclamo non puo' ancora esistere.
--   · loyalty_transactions e zone_code_uses: ON DELETE SET NULL, come le altre colonne order_id che
--     possono restare vuote (cashback_redemptions, rider_sos_events): il movimento resta, non punta
--     piu' a un ordine che non c'e'.
-- Le due colonne senza indice lo ricevono (tests/sql/rls/14, controllo ④: ogni chiave esterna ha il
-- suo indice); disputes ce l'ha gia' (disputes_order_idx, 027).
--
-- NOT VALID, poi VALIDATE: la chiave vale subito per ogni riga nuova o cambiata; se in produzione ci
-- sono gia' orfani la validazione non ferma il rilascio, lascia la chiave NOT VALID e lo grida nei
-- log. Le domande per trovarli sono in fondo.
--
-- REVERSIBILE: `ALTER TABLE public.disputes DROP CONSTRAINT disputes_order_id_fkey;` (e lo stesso per
-- loyalty_transactions_order_id_fkey e zone_code_uses_order_id_fkey; gli indici si possono lasciare).
--
-- LA PROVA: tests/sql/rls/riparazione-r18-reclamo-senza-ordine.test.sql. Non cerca i nomi delle
-- chiavi: prova a scrivere un reclamo su un ordine inesistente e a cancellare un ordine col reclamo.

CREATE INDEX IF NOT EXISTS loyalty_transactions_order_idx ON public.loyalty_transactions(order_id);
CREATE INDEX IF NOT EXISTS zone_code_uses_order_idx ON public.zone_code_uses(order_id);

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('disputes',             'disputes_order_id_fkey',             'RESTRICT'),
      ('loyalty_transactions', 'loyalty_transactions_order_id_fkey', 'SET NULL'),
      ('zone_code_uses',       'zone_code_uses_order_id_fkey',       'SET NULL')
    ) AS v(tabella, vincolo, alla_cancellazione)
  LOOP
    IF to_regclass('public.' || r.tabella) IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = r.vincolo
                        AND conrelid = ('public.' || r.tabella)::regclass) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE %s NOT VALID',
        r.tabella, r.vincolo, r.alla_cancellazione);
      BEGIN
        EXECUTE format('ALTER TABLE public.%I VALIDATE CONSTRAINT %I', r.tabella, r.vincolo);
      EXCEPTION WHEN foreign_key_violation THEN
        RAISE WARNING '424: % su % resta NOT VALID: ci sono righe legate a ordini che non esistono piu''',
          r.vincolo, r.tabella;
      END;
    END IF;
  END LOOP;
END $$;

-- Se un avviso «resta NOT VALID» compare nei log, queste trovano gli orfani:
--   SELECT d.id, d.order_id, d.status, d.refund_cents FROM public.disputes d
--    WHERE NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.id = d.order_id);
--   SELECT count(*) FROM public.loyalty_transactions t
--    WHERE t.order_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.id = t.order_id);
--   SELECT count(*) FROM public.zone_code_uses z
--    WHERE z.order_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.id = z.order_id);
-- Dopo averli sistemati: ALTER TABLE public.<tabella> VALIDATE CONSTRAINT <vincolo>;

NOTIFY pgrst, 'reload schema';

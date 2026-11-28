-- 999p — L'ordine in contanti porta la chiave del suo carrello (R06-009, R09-007; 28/11/2026).
--
-- Il difetto. Il carrello con la carta si ritrova dalla sessione di pagamento, scritta su ogni
-- ordine (`stripe_session_id`). Quello in contanti solo dalla riga contro il doppio clic
-- (`cod_checkout_attempts.order_ids`), che la rotta della cassa scrive in una scrittura A PARTE,
-- dopo aver creato gli ordini: se quella scrittura cade (lo dice già la rotta: «prova del tentativo
-- NON scritta»), o se l'invio senza chiave del browser non riesce a scrivere la riga, sugli ordini
-- non resta niente che li leghi. Allora:
--   · la regola del negozio che rifiuta (lib/ordini/annulla.ts, `ricalcolaLaConsegnaDelGiro`) non
--     scatta: la consegna resta sull'ordine annullato e gli altri ordini del carrello la perdono;
--   · il freno della veloce non confermata (lib/ordini/veloce-non-confermata.ts) sposta un ordine
--     alla volta, con una campanella ciascuno, e l'euro della veloce resta sull'ordine che lo porta.
-- Fin qui si avvisavano gli amministratori (R04-007, R09-013), ma la regola non scattava.
--
-- COSA FA.
--  1. orders.cod_cart_key — la chiave del carrello in contanti: la stessa di
--     cod_checkout_attempts.chiave. La scrive la rotta della cassa NELLA STESSA insert dell'ordine,
--     quindi un ordine nato ha sempre la sua chiave: non c'è una seconda scrittura che possa cadere.
--     Gli ordini con la carta la lasciano vuota.
--  2. Un indice su (user_id, cod_cart_key) per ritrovare il carrello di un cliente.
--  3. Gli ordini già nati prendono la chiave dalla riga del tentativo che li elenca (dove c'è).
-- Chi legge il carrello usa prima la riga del tentativo, come oggi; senza riga, la chiave sull'ordine.
--
-- Nessun permesso nuovo: dal browser la colonna non si cambia (enforce_order_update_rules lascia
-- scrivere al browser solo stato, fattorino, orari e posizione), e il cliente che la legge vede solo
-- la chiave del proprio carrello.
--
-- Prova: tests/sql/rls/riparazione-onda2-r06-009-chiave-del-carrello-in-contanti.test.sql.
-- Si può rieseguire. NON si applica a mano: lo decide Nicola.
-- REVERSIBILE:
--   DROP INDEX IF EXISTS public.orders_cod_cart_key_idx;
--   ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_cod_cart_key_lunghezza;
--   ALTER TABLE public.orders DROP COLUMN IF EXISTS cod_cart_key;

BEGIN;

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS cod_cart_key text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'orders_cod_cart_key_lunghezza' AND conrelid = 'public.orders'::regclass
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_cod_cart_key_lunghezza
      CHECK (cod_cart_key IS NULL OR char_length(cod_cart_key) BETWEEN 1 AND 200);
  END IF;
END $$;

COMMENT ON COLUMN public.orders.cod_cart_key IS
  'La chiave del carrello in contanti (la stessa di cod_checkout_attempts.chiave), scritta con l ordine: ritrova gli ordini dello stesso carrello anche senza la riga del tentativo. Vuota per la carta (migrazione 999p).';

CREATE INDEX IF NOT EXISTS orders_cod_cart_key_idx
  ON public.orders (user_id, cod_cart_key)
  WHERE cod_cart_key IS NOT NULL;

-- Gli ordini già nati: la chiave dalla riga del tentativo che li elenca. Solo dove manca, solo
-- dallo stesso cliente, e solo da righe che elencano gli ordini (un elenco vuoto non lega niente).
-- La guardia degli ordini (enforce_order_update_rules) lascia scrivere il server con la spia della
-- transazione, come le altre semine (094, 096). Ogni ordine toccato lascia la sua riga in
-- activity_events («1 campo»): è la traccia di cosa la semina ha scritto.
SET LOCAL mycity.allow_order_write = '1';
UPDATE public.orders o
   SET cod_cart_key = a.chiave
  FROM public.cod_checkout_attempts a
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(a.order_ids) = 'array' THEN a.order_ids ELSE '[]'::jsonb END
  ) AS e(el)
 WHERE o.cod_cart_key IS NULL
   AND o.stripe_session_id IS NULL
   AND o.user_id = a.user_id
   AND char_length(a.chiave) BETWEEN 1 AND 200
   AND o.id::text = coalesce(e.el ->> 'id', e.el #>> '{}');

COMMIT;

NOTIFY pgrst, 'reload schema';

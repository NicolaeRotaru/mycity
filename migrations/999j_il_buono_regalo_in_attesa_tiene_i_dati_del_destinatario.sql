-- =============================================================================
-- 999j — Il buono regalo in attesa tiene i dati del destinatario da noi, non su Stripe
-- =============================================================================
-- IL DIFETTO (R08-012). Chi compra un buono regalo scrive nome, email e un messaggio privato del
-- DESTINATARIO, una persona che con noi non ha nessun rapporto. La rotta del pagamento
-- (app/api/gift-cards/checkout/route.ts) li metteva nei metadati della sessione di Stripe, perche' il
-- webhook li ritrovasse a pagamento avvenuto. Da noi quei tre campi si azzerano (cancellazione
-- dell'account, potatura dopo la scadenza: lib/account/cancellazione.ts, lib/privacy/potature-ritenzione.ts);
-- su Stripe restavano per sempre, anche per i pagamenti mai conclusi.
--
-- LA CURA. Il tentativo di acquisto si scrive qui, dal server, PRIMA di aprire il pagamento; a Stripe va
-- solo l'id di questa riga (`attesa_id`). Il webhook legge la riga, crea il buono e la cancella.
--   · `chiave` e' la chiave del tentativo (quella che il browser manda in Idempotency-Key, o quella di
--     riserva del server): stesso tentativo, stessa riga, stesso `attesa_id`, quindi Stripe riconosce il
--     doppio clic come lo stesso pagamento invece di rifiutarlo.
--   · buyer_id -> auth.users ON DELETE CASCADE: il tentativo e' di chi compra, se ne va con lui
--     (elenco in lib/account/cancellazione.ts, `sopravvive: false`).
--   · I tentativi mai pagati li toglie la potatura notturna `gift_card_in_attesa`.
--
-- Nessuna regola per il browser: anon e authenticated non leggono e non scrivono niente. Scrivono e
-- leggono solo la rotta del pagamento e il webhook, con la chiave di servizio.
--
-- Si puo' rieseguire. NON si applica a mano: lo decide Nicola, come ogni migrazione. Va applicata PRIMA
-- di accendere la vendita (BUONI_REGALO_IN_VENDITA, lib/funzioni-al-lancio.ts): senza la tabella la
-- rotta risponde «non disponibile» invece di mandare i dati a Stripe.
-- REVERSIBILE: DROP TABLE public.gift_card_in_attesa;  (dopo aver rimesso il codice di prima)
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.gift_card_in_attesa (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  chiave          text NOT NULL CHECK (char_length(chiave) BETWEEN 1 AND 200),
  amount_cents    integer NOT NULL CHECK (amount_cents > 0),
  recipient_name  text CHECK (recipient_name IS NULL OR char_length(recipient_name) <= 120),
  recipient_email text CHECK (recipient_email IS NULL OR char_length(recipient_email) <= 200),
  message         text CHECK (message IS NULL OR char_length(message) <= 500),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gift_card_in_attesa_un_tentativo_una_riga UNIQUE (buyer_id, chiave)
);

-- La potatura notturna cerca per data.
CREATE INDEX IF NOT EXISTS gift_card_in_attesa_created_at_idx ON public.gift_card_in_attesa (created_at);

ALTER TABLE public.gift_card_in_attesa ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.gift_card_in_attesa FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.gift_card_in_attesa TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';

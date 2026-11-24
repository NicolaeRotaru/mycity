-- 706 — Gli abbonamenti dei servizi (24/11/2026).
--
-- Nicola: «sono servizi che offre mycity, ma tramite SDG», e «Ora del Gusto deve già poter
-- selezionare il servizio e effettuare il pagamento». Il negozio sceglie Base, Business o Premium
-- dalla pagina «Il tuo preventivo» e paga con Stripe (abbonamento mensile, il primo mese a metà).
--
-- Una tabella sua, separata dall'abbonamento della vetrina (profiles.stripe_subscription_id): i due
-- abbonamenti hanno prezzi, clienti Stripe e storie diverse, e uno non deve mai scrivere sull'altro.
-- La scrive solo il webhook di Stripe (service_role); il negozio legge solo le sue righe.
--
-- REVERSIBILE: DROP TABLE public.abbonamenti_servizi; (si perde lo storico degli abbonamenti dei
-- servizi; su Stripe restano).

BEGIN;

CREATE TABLE IF NOT EXISTS public.abbonamenti_servizi (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  fascia text NOT NULL CHECK (fascia IN ('base', 'business', 'premium')),
  canone_centesimi integer NOT NULL CHECK (canone_centesimi > 0),
  stripe_customer_id text,
  stripe_subscription_id text NOT NULL UNIQUE,
  stato text NOT NULL CHECK (stato IN ('active', 'past_due', 'canceled')),
  rinnovo_il timestamptz,
  creato_il timestamptz NOT NULL DEFAULT now(),
  aggiornato_il timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS abbonamenti_servizi_seller_idx ON public.abbonamenti_servizi (seller_id);

ALTER TABLE public.abbonamenti_servizi ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS abbonamenti_servizi_il_negozio_legge_i_suoi ON public.abbonamenti_servizi;
CREATE POLICY abbonamenti_servizi_il_negozio_legge_i_suoi ON public.abbonamenti_servizi
  FOR SELECT TO authenticated
  USING (seller_id = (SELECT auth.uid()));

-- I permessi scritti qui (migrazione 425): il negozio legge, solo il server scrive.
REVOKE ALL ON public.abbonamenti_servizi FROM anon, authenticated;
GRANT SELECT ON public.abbonamenti_servizi TO authenticated;
GRANT ALL ON public.abbonamenti_servizi TO service_role;

COMMENT ON TABLE public.abbonamenti_servizi IS
  'Abbonamenti dei servizi di MyCity realizzati da SDG (24/11/2026): Base, Business, Premium. Li scrive il webhook Stripe (metadata.kind = servizi_subscription). Separati dall abbonamento della vetrina.';

COMMIT;

-- 999 — L'abbonamento ai servizi pagato in contanti sblocca la pagina del negozio (27/11/2026).
--
-- Nicola, 27/11/2026 02:26, sul riquadro «Il titolare di … ha detto sì?» della pagina dell'agente:
-- «in questo punto bisogna selezionare di che abbonamento ha scelto l'imprenditore», e poi «quindi in
-- automatico deve sbloccarsi la pagina del venditore in base all'abbonamento». Le sue due scelte dello
-- stesso minuto: la pagina si sblocca SUBITO, al «Sì» dell'agente, prima che arrivino i contanti (si
-- ritirano al primo servizio, fatto `sdg.pagamento`); lo sblocco dura FINO ALLA DISDETTA.
--
-- Fino a oggi una riga di `abbonamenti_servizi` nasceva solo dal webhook di Stripe, con
-- `stripe_subscription_id` obbligatorio (706): chi pagava in contanti restava in demo per sempre.
-- Qui la stessa tabella accoglie anche l'abbonamento in contanti, così tutto quello che già si apre
-- con un abbonamento attivo (la vetrina con `negozio_in_vetrina` della 709, la scheda, il rapporto,
-- il riquadro della dashboard) si apre da solo, nella fascia scelta, senza toccare quei lettori.
--  · `origine` dice da dove viene la riga: 'stripe' (tutte le righe di prima) o 'contanti';
--  · una riga Stripe deve avere il suo id; una riga in contanti non ha né cliente né abbonamento Stripe;
--  · un negozio ha al massimo UN abbonamento in contanti in corso (due pressioni non fanno due righe).
-- Lo scrive solo il server (service_role), come prima: il negozio legge e basta.
--
-- Si può rieseguire. NON si applica da sola: la applica Nicola, come ogni migrazione.
-- REVERSIBILE (si perdono gli abbonamenti in contanti registrati):
--   DELETE FROM public.abbonamenti_servizi WHERE origine = 'contanti';
--   DROP INDEX IF EXISTS public.abbonamenti_servizi_un_contanti_in_corso;
--   ALTER TABLE public.abbonamenti_servizi DROP CONSTRAINT IF EXISTS abbonamenti_servizi_contanti_senza_stripe;
--   ALTER TABLE public.abbonamenti_servizi DROP CONSTRAINT IF EXISTS abbonamenti_servizi_stripe_col_suo_id;
--   ALTER TABLE public.abbonamenti_servizi DROP CONSTRAINT IF EXISTS abbonamenti_servizi_origine_valida;
--   ALTER TABLE public.abbonamenti_servizi ALTER COLUMN stripe_subscription_id SET NOT NULL;
--   ALTER TABLE public.abbonamenti_servizi DROP COLUMN IF EXISTS origine;
-- LA PROVA: tests/sql/harness/999-l-abbonamento-in-contanti.sh

BEGIN;

ALTER TABLE public.abbonamenti_servizi ADD COLUMN IF NOT EXISTS origine text NOT NULL DEFAULT 'stripe';

ALTER TABLE public.abbonamenti_servizi DROP CONSTRAINT IF EXISTS abbonamenti_servizi_origine_valida;
ALTER TABLE public.abbonamenti_servizi
  ADD CONSTRAINT abbonamenti_servizi_origine_valida CHECK (origine IN ('stripe', 'contanti'));

ALTER TABLE public.abbonamenti_servizi ALTER COLUMN stripe_subscription_id DROP NOT NULL;

ALTER TABLE public.abbonamenti_servizi DROP CONSTRAINT IF EXISTS abbonamenti_servizi_stripe_col_suo_id;
ALTER TABLE public.abbonamenti_servizi
  ADD CONSTRAINT abbonamenti_servizi_stripe_col_suo_id CHECK (origine <> 'stripe' OR stripe_subscription_id IS NOT NULL);

ALTER TABLE public.abbonamenti_servizi DROP CONSTRAINT IF EXISTS abbonamenti_servizi_contanti_senza_stripe;
ALTER TABLE public.abbonamenti_servizi
  ADD CONSTRAINT abbonamenti_servizi_contanti_senza_stripe
  CHECK (origine <> 'contanti' OR (stripe_subscription_id IS NULL AND stripe_customer_id IS NULL));

CREATE UNIQUE INDEX IF NOT EXISTS abbonamenti_servizi_un_contanti_in_corso
  ON public.abbonamenti_servizi (seller_id)
  WHERE origine = 'contanti' AND stato IN ('active', 'past_due');

COMMENT ON COLUMN public.abbonamenti_servizi.origine IS
  'Da dove viene l abbonamento: stripe (lo scrive il webhook) o contanti (lo scrive il server al «Sì» dell agente o all accettazione dal link, 27/11/2026). Dura fino alla disdetta. Migrazione 999.';

COMMENT ON TABLE public.abbonamenti_servizi IS
  'Abbonamenti dei servizi di MyCity realizzati da SDG (24/11/2026): Base, Business, Premium. Li scrive il webhook Stripe (metadata.kind = servizi_subscription) o, per chi paga in contanti, il server (origine = contanti, migrazione 999). Separati dall abbonamento della vetrina.';

COMMIT;

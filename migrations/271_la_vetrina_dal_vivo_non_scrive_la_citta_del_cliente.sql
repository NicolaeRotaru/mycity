-- =============================================================================
-- 271 — Il riquadro dal vivo non scrive quello che il cliente ha messo in «Città» (R03-009)
-- =============================================================================
-- «Cosa sta succedendo a Piacenza» legge live_activity_public, che chiunque può
-- interrogare (anche senza account) e che scavalca le regole per riga di
-- `orders`. La sua difesa è quello che NON contiene. Ma `delivery_city` non è
-- una città: è il testo libero che il cliente scrive nel campo «Città» della
-- cassa, fino a 120 caratteri. Un ordine con città «Quarto, via Verdi 10
-- citofono Rossi» dalla «Farmacia del Corso» si leggeva così, tale e quale,
-- da ogni visitatore. E anche una frazione vera di poche centinaia di abitanti,
-- accanto a una farmacia e a una fascia oraria, basta a dire chi è.
--
-- La colonna resta (stesso nome e tipo, così il sito già pubblicato continua
-- a funzionare) ma vale sempre 'Piacenza': nella vista non esce più niente di
-- scritto dal cliente. Il riquadro (components/LiveActivityFeed.tsx) dice
-- comunque sempre «Qualcuno a Piacenza».
--
-- Prova: tests/sql/rls/riparazione-r03-vetrina-senza-citta-del-cliente.test.sql
-- Per tornare indietro: rieseguire la definizione della vista della 142 e le
-- impostazioni della 152 (security_barrier).
-- =============================================================================

BEGIN;

CREATE OR REPLACE VIEW public.live_activity_public AS
  SELECT DISTINCT
         date_trunc('hour', o.created_at) AS created_at,
         o.delivery_status,
         'Piacenza'::text AS delivery_city,
         p.store_name
    FROM public.orders o
    JOIN public.profiles p ON p.id = o.seller_id
   WHERE o.delivery_status IN ('NEW', 'ACCEPTED', 'READY', 'OUT_FOR_DELIVERY', 'DELIVERED')
     AND p.is_approved
   ORDER BY date_trunc('hour', o.created_at) DESC
   LIMIT 20;

-- Come la 142 e la 152: permessi di chi l'ha creata (apposta) e barriera.
ALTER VIEW public.live_activity_public SET (security_invoker = off);
ALTER VIEW public.live_activity_public SET (security_barrier = true);

COMMENT ON VIEW public.live_activity_public IS
  'Attivita del marketplace a blocchi di un''ora, senza identificativi di ordine. delivery_city vale '
  'sempre Piacenza: il campo città della cassa è testo libero del cliente e non esce (271). Coi '
  'permessi del creatore apposta; con security_invoker=true resta vuota.';

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES ON public.live_activity_public FROM anon, authenticated;
GRANT SELECT ON public.live_activity_public TO anon, authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

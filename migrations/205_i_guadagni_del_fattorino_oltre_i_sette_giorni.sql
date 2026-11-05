-- 205 — I GUADAGNI DEL FATTORINO OLTRE I SETTE GIORNI (sessione S02, 5/11/2026, scheda 649)
--
-- Il 22/8 (migrazione 127) la regola su `orders` si è stretta: il fattorino vede una consegna
-- fatta solo per 7 giorni. Per non togliergli il conto dei compensi è nata la vista
-- `rider_consegne_storico`, ma senza `rider_payout_status`: la pagina Guadagni, che deve dire
-- «versato» o «in arrivo», ha continuato a leggere `orders`, e con «30 giorni» o «Tutto»
-- mostrava solo l'ultima settimana. Anche il contatore delle consegne del profilo.
--
-- Qui la vista prende la colonna in coda (CREATE OR REPLACE VIEW ammette colonne nuove solo in
-- fondo), e si rimettono le scelte della 127 e della 152: permessi del creatore APPOSTA (il filtro
-- rider_id = auth.uid() sta dentro la vista), barriera di sicurezza, niente ad anon.
-- Nessun recapito del cliente entra nella vista.
--
-- Da applicare a mano (Nicola). Le pagine reggono anche prima: se la colonna non c'è, la lettura
-- ripiega su `orders` come prima (lib/rider/consegne-del-fattorino.ts).

CREATE OR REPLACE VIEW public.rider_consegne_storico AS
SELECT
  o.id,
  o.rider_id,
  o.delivered_at,
  o.delivery_status,
  o.payment_method,
  o.shipping_cost,
  o.rider_fee_cents,
  o.total_price,
  o.delivery_city,
  o.rider_payout_status
FROM public.orders o
WHERE o.rider_id = (SELECT auth.uid())
  AND o.delivery_status = 'DELIVERED';

ALTER VIEW public.rider_consegne_storico SET (security_invoker = off);
ALTER VIEW public.rider_consegne_storico SET (security_barrier = true);

REVOKE ALL    ON public.rider_consegne_storico FROM PUBLIC, anon;
GRANT  SELECT ON public.rider_consegne_storico TO authenticated;

COMMENT ON VIEW public.rider_consegne_storico IS
  'Storico consegne e compensi del fattorino che sta chiedendo (filtra su auth.uid()), con lo stato del bonifico. Coi permessi del creatore APPOSTA: la regola su orders tiene le consegne fatte solo 7 giorni. Solo per chi ha fatto l''accesso: non concederla ad anon. Nessun recapito del cliente.';

NOTIFY pgrst, 'reload schema';

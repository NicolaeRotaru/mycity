-- =============================================================================
-- 120 — La vetrina «attività dal vivo» smette di essere un contatore di ordini
-- =============================================================================
-- Difetto 040 del referto del 18 agosto.
--
-- La vista `live_activity_public` dava l'identificativo di ogni ordine e l'orario
-- al secondo. Con la chiave che ha qualunque browser, un concorrente poteva
-- leggerla a intervalli, riconoscere gli ordini uno per uno e contare quanti ne
-- fa ciascun negozio, e a che ora. Quel riquadro serve a dire «qui si compra»,
-- non «Pane Quotidiano oggi ha fatto quattordici ordini».
--
-- PERCHÉ STA IN UN FILE A PARTE, E NON NELLA 119.
-- Questa migrazione cambia la FORMA di una vista che la home legge davvero
-- (components/LiveActivityFeed.tsx). Applicarla mentre in produzione gira il
-- codice vecchio — quello che chiede ancora la colonna `id` — farebbe sparire
-- il riquadro dalla home. Le altre trentasette riparazioni della 119 non hanno
-- questo legame, e non devono aspettare.
--
-- ORDINE GIUSTO, E NON È UN DETTAGLIO:
--   ① si unisce e si pubblica la richiesta #225 (il codice non chiede più `id`);
--   ② SOLO DOPO si applica questa migrazione.
-- Al contrario si rompe la home per tutto il tempo in mezzo.
--
-- Idempotente. 🔴 Applicarla resta una firma di Nicola.
-- =============================================================================

BEGIN;

DROP VIEW IF EXISTS public.live_activity_public;

CREATE VIEW public.live_activity_public AS
  -- `id` non c'è più: era l'identità dell'ordine, cioè quello che permetteva di
  -- riconoscerlo e contarlo. L'orario resta, arrotondato all'ora: basta a dire
  -- «poco fa», non basta a mettere gli ordini in fila.
  SELECT date_trunc('hour', o.created_at) AS created_at,
         o.delivery_status,
         o.delivery_city,
         o.seller_id,
         p.store_name
    FROM public.orders o
    JOIN public.profiles p ON p.id = o.seller_id
   WHERE o.delivery_status IN ('NEW', 'ACCEPTED', 'READY', 'OUT_FOR_DELIVERY', 'DELIVERED')
     AND p.is_approved
   ORDER BY date_trunc('hour', o.created_at) DESC
   LIMIT 20;

COMMENT ON VIEW public.live_activity_public IS
  'Attivita recente per la home: ora arrotondata, stato, citta, negozio. Nessun id ordine, nessun dato personale del cliente.';

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES ON public.live_activity_public FROM anon, authenticated;
GRANT SELECT ON public.live_activity_public TO anon, authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

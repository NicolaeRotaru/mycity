-- =============================================================================
-- 142 — Il riquadro «attività dal vivo» dice che si compra, non quanto vende ognuno
-- =============================================================================
-- 27/8/2026 (R030) — LA RIPARAZIONE DI AGOSTO NON AVEVA CHIUSO IL BUCO.
--
-- La vista `live_activity_public` alimenta il riquadro in home che fa vedere che il marketplace è
-- vivo. È a permessi di definizione (`security_invoker = off`, migrazione 127): le regole per riga
-- degli ordini non la fermano, quindi quello che c'è dentro lo legge chiunque con la chiave
-- pubblica che ha ogni browser.
--
-- La migrazione 120 aveva tolto l'identificativo dell'ordine e arrotondato l'orario all'ora, e nel
-- suo stesso commento diceva: «basta a dire poco fa, non basta a mettere gli ordini in fila».
-- Ma la vista restava UNA RIGA PER ORDINE — niente DISTINCT, niente raggruppamento — e contare le
-- righe è contare gli ordini. Leggendo la vista a intervalli, un concorrente ricostruisce quanti
-- ordini fa ogni bottega di Piacenza e in quali ore.
--
-- Non escono soldi e non escono dati dei clienti: `delivery_city` è la città, che a Piacenza vale
-- per tutti e non identifica nessuno. Esce la promessa fatta al negoziante — «i tuoi numeri
-- restano tuoi» — e una migrazione che dichiara di aver mantenuto quella promessa mentre non lo fa
-- è peggio del difetto: fa smettere di controllare.
--
-- COSA CAMBIA. `SELECT DISTINCT`: tre ordini dello stesso negozio nella stessa ora, dalla stessa
-- città e nello stesso stato diventano una riga sola. Il riquadro continua a dire «qui si compra»,
-- il numero non esce più.
--
-- E VIA `seller_id`. Al riquadro basta il nome dell'insegna. Costa il collegamento alla vetrina da
-- quella riga — era un `<Link href="/store/…">` — e si paga volentieri: meno colonne uscite da una
-- vista che scavalca le regole per riga, meno modi di rimettere insieme i pezzi.
--
-- ⚠️ ORDINE DELLE COSE, come già scritto nella 120: PRIMA si pubblica il codice che non chiede più
-- la colonna (`components/LiveActivityFeed.tsx`, fatto nello stesso lavoro), POI si applica questa.
-- Al contrario, il riquadro sparisce dalla home nel frattempo.
--
-- Prova che lo tiene chiuso: tests/sql/rls/23-l-attivita-dal-vivo-non-conta-gli-ordini.test.sql
-- (tre ordini stessa ora stesso negozio → la vista deve dare UNA riga).
-- =============================================================================

BEGIN;

DROP VIEW IF EXISTS public.live_activity_public;

CREATE VIEW public.live_activity_public AS
  SELECT DISTINCT
         date_trunc('hour', o.created_at) AS created_at,
         o.delivery_status,
         o.delivery_city,
         p.store_name
    FROM public.orders o
    JOIN public.profiles p ON p.id = o.seller_id
   WHERE o.delivery_status IN ('NEW', 'ACCEPTED', 'READY', 'OUT_FOR_DELIVERY', 'DELIVERED')
     AND p.is_approved
   ORDER BY date_trunc('hour', o.created_at) DESC
   LIMIT 20;

-- La vista resta a permessi di definizione, come l'ha messa la 127: legge `orders` scavalcando le
-- regole per riga, e si difende con quello che NON contiene.
ALTER VIEW public.live_activity_public SET (security_invoker = off);

COMMENT ON VIEW public.live_activity_public IS
  'Attivita recente per la home: ora arrotondata, stato, citta, nome del negozio. DISTINCT: piu '
  'ordini dello stesso negozio nella stessa ora sono una riga sola, quindi contare le righe non '
  'e contare gli ordini. Nessun identificativo, nessun dato personale del cliente.';

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES ON public.live_activity_public FROM anon, authenticated;
GRANT SELECT ON public.live_activity_public TO anon, authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

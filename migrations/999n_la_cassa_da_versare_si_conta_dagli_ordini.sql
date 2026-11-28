-- =============================================================================
-- 999n — La cassa da versare del fattorino si conta dagli ordini
-- =============================================================================
--
-- NON APPLICATA. La applica Nicola. Si può rieseguire (CREATE OR REPLACE).
-- REVERSIBILE: DROP FUNCTION public.cassa_da_versare_del_fattorino(uuid);
--   (la guardia della cancellazione torna da sola a leggere solo il registro, come prima)
--
-- ── Cosa c'è che non va, in parole semplici (R08-004, R08-005, R08-006) ──────
-- Prima di cancellare l'account di un fattorino, la guardia (`contantiAncoraDaVersare`,
-- lib/account/cancellazione.ts) guarda se ha ancora in tasca contanti dei negozi. Lo leggeva
-- solo dal registro delle giornate (`cod_reconciliations`): una giornata è «aperta» se
-- `remitted_at` è vuoto, e la cifra è `collected_cents`, cioè TUTTO l'incassato del giorno.
--
--  · Il fattorino versa alle 15 (remitted_at scritto), poi alle 18 incassa un'altra consegna.
--    La quadratura rifà la riga del giorno (collected_cents sale) ma remitted_at resta pieno:
--    per il registro la giornata è chiusa, i contanti delle 18 non li vede nessuno e
--    l'account si cancella (R08-006).
--  · Una giornata riaperta (remitted_at svuotato da un amministratore dopo il versamento):
--    la guardia diceva «non ancora versati» TUTTI i contanti del giorno, anche quelli già
--    versati alle 15, e la cifra era gonfiata (R08-004, R08-005).
--
-- ── Cosa fa ──────────────────────────────────────────────────────────────────
-- Una funzione sola che, in una sola lettura, conta i contanti ancora in mano al fattorino
-- dagli ORDINI, con le stesse regole della pagina Rimesse contanti (app/admin/cod-remittance):
--  · gli ordini in contanti consegnati e non ancora rimessi (payout_status AWAITING_REMITTANCE),
--    qualunque sia la riga del registro;
--  · i rimborsati per intero (REFUNDED) i cui contanti non sono ancora rientrati: nessuna
--    rimessa di quel fattorino·giorno confermata DOPO l'incasso (regola R29-011);
--  · (N-003, onda 3) gli ordini ancora IN STRADA (PICKED_UP, OUT_FOR_DELIVERY) i cui contanti
--    il fattorino ha già dichiarato incassati (`cash_confirmed_at` scritto da lib/cassa/
--    registra-incasso.ts, l'unica strada dell'incasso, che lo ammette da OUT_FOR_DELIVERY in poi).
--    Prima si contavano solo i consegnati: incassati i 28 € alla porta e non ancora chiusa la
--    consegna col codice, per la guardia il fattorino non aveva niente in tasca e l'account si
--    cancellava. Un ordine in strada senza incasso dichiarato non conta: quei contanti non li ha.
--    La giornata è quella dell'incasso finché l'ordine non è consegnato.
-- La cifra è la somma di `cash_collected_cents` di quegli ordini, la stessa unità di prima.
-- Le giornate sono quelle di quegli ordini PIÙ quelle che il registro dice ancora aperte
-- (remitted_at vuoto e incasso o ammanco): una giornata che oggi ferma la cancellazione la
-- ferma anche domani. La guardia può solo fermarsi in più casi, mai in meno.
--
-- LIMITE DICHIARATO: se un amministratore svuota remitted_at di una giornata, un rimborsato
-- di quel giorno già rientrato torna fra quelli da chiedere (la rimessa di un rimborsato è
-- scritta solo lì). È lo sbaglio per eccesso, lo stesso della pagina Rimesse contanti.
--
-- ── Che rischio ha ───────────────────────────────────────────────────────────
-- Nessuno sui dati: crea una funzione che legge e basta, non tocca righe né soldi.
-- La usa solo il server (client di servizio); il browser non la vede.
-- Finché non è applicata, la guardia legge solo il registro come prima.
-- La prova: tests/sql/rls/onda2-c2-la-cassa-da-versare-si-conta-dagli-ordini.test.sql
-- =============================================================================

CREATE OR REPLACE FUNCTION public.cassa_da_versare_del_fattorino(p_rider uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
  WITH contanti AS (
    -- Consegnati, oppure ancora in strada coi contanti già dichiarati incassati (N-003).
    -- `quando`: la consegna, o l'incasso finché la consegna non c'è.
    SELECT o.rider_id, o.payout_status, o.cash_collected_cents, o.cash_confirmed_at, o.delivered_at,
           coalesce(o.delivered_at, o.cash_confirmed_at) AS quando
      FROM public.orders o
     WHERE o.rider_id = p_rider
       AND o.payment_method = 'cod'
       AND (
             (o.delivery_status = 'DELIVERED' AND o.delivered_at IS NOT NULL)
          OR (o.delivery_status IN ('PICKED_UP', 'OUT_FOR_DELIVERY') AND o.cash_confirmed_at IS NOT NULL)
           )
  ),
  in_mano AS (
    SELECT (o.quando AT TIME ZONE 'Europe/Rome')::date   AS giorno,
           coalesce(o.cash_collected_cents, 0)::bigint AS centesimi
      FROM contanti o
     WHERE o.payout_status = 'AWAITING_REMITTANCE'
        OR (
             o.payout_status = 'REFUNDED'
             AND NOT EXISTS (
               SELECT 1
                 FROM public.cod_reconciliations r
                WHERE r.rider_id = o.rider_id
                  AND r.for_date = (o.quando AT TIME ZONE 'Europe/Rome')::date
                  AND r.remitted_at IS NOT NULL
                  AND r.remitted_at >= coalesce(o.cash_confirmed_at, o.delivered_at)
             )
           )
  ),
  registro_aperto AS (
    SELECT r.for_date AS giorno
      FROM public.cod_reconciliations r
     WHERE r.rider_id = p_rider
       AND r.remitted_at IS NULL
       AND (coalesce(r.collected_cents, 0) > 0 OR r.status = 'MISMATCH')
  ),
  giorni AS (
    SELECT giorno FROM in_mano
    UNION
    SELECT giorno FROM registro_aperto
  )
  SELECT jsonb_build_object(
    'centesimi', coalesce((SELECT sum(centesimi) FROM in_mano), 0),
    'giornate',  (SELECT count(*) FROM giorni),
    'ordini',    (SELECT count(*) FROM in_mano)
  );
$function$;

REVOKE ALL ON FUNCTION public.cassa_da_versare_del_fattorino(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cassa_da_versare_del_fattorino(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';

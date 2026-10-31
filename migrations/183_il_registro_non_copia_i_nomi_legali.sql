-- =============================================================================
-- 183 — LE RIGHE DEL REGISTRO GIA' SCRITTE NON TENGONO PIU' I NOMI LEGALI
-- =============================================================================
-- 31/10/2026.
--
-- IL DIFETTO. Il trigger `log_activity_change` copia in
-- `activity_events.metadata.changed` il valore vecchio e quello nuovo di ogni
-- colonna cambiata. Fino alla migrazione 155 oscurava solo le colonne il cui
-- nome somigliava a una lista scritta a mano, che non aveva `first_name`,
-- `last_name`, `recipient`, `message`, `haccp`, `insurance`. Cosi'
-- `profiles.legal_first_name` / `legal_last_name` (l'identita' legale di
-- negozianti e fattorini), `gift_cards.recipient_name` e `gift_cards.message`
-- (il biglietto privato), `rider_haccp_url` / `rider_insurance_url` finivano
-- nel registro in chiaro.
--
-- La 155 ha chiuso il trigger per il futuro: `activity_key_sensibile` oscura
-- per difetto e la prova tests/unit/il-registro-attivita-non-copia-il-cognome-
-- legale.test.ts la tiene ferma. Ma la 155 dice di se' «non tocca nessuna
-- riga gia' scritta»: le righe nate prima restano in chiaro fino alla potatura
-- dei 14 mesi. Quattordici mesi di nomi legali e biglietti privati che una
-- regola nostra dice di non tenere.
--
-- COSA FA. Ripassa le righe gia' scritte con la STESSA regola del trigger: per
-- ogni chiave di `metadata.changed` che oggi il trigger oscurerebbe — la
-- funzione `activity_key_sensibile` piu' la lista fissa `v_redact` del
-- trigger (migrations/161) — vecchio e nuovo diventano '***', come scrive il
-- trigger. Le altre chiavi (stati, prezzi, date) restano com'erano: il
-- registro serve ancora a capire cosa e' cambiato, solo non a chi.
--
-- La regola non si ricopia qui: si chiama la funzione del database, cosi'
-- quando la regola cambia questa pulizia rigirata la segue.
--
-- Tocca solo le righe che hanno almeno una chiave da oscurare non ancora
-- oscurata: rigirata, non trova niente (idempotente). `summary` non porta
-- valori («profiles #1a2b3c4d aggiornato (2 campi)») e non si tocca.
--
-- Rollback: nessuno, ed e' voluto. I valori tolti non vanno rimessi.
-- =============================================================================

UPDATE public.activity_events e
   SET metadata = jsonb_set(
         e.metadata,
         '{changed}',
         (SELECT jsonb_object_agg(
                   c.key,
                   CASE
                     WHEN public.activity_key_sensibile(c.key)
                       OR c.key = ANY (ARRAY['password','token','secret','access_token','refresh_token',
                                             'card','iban','cvv','tax_code','fiscal_code','document_number'])
                     THEN jsonb_build_object('old', '***', 'new', '***')
                     ELSE c.value
                   END)
            FROM jsonb_each(e.metadata -> 'changed') AS c(key, value))
       )
 WHERE jsonb_typeof(e.metadata -> 'changed') = 'object'
   AND EXISTS (
         SELECT 1
           FROM jsonb_each(e.metadata -> 'changed') AS c(key, value)
          WHERE (public.activity_key_sensibile(c.key)
                 OR c.key = ANY (ARRAY['password','token','secret','access_token','refresh_token',
                                       'card','iban','cvv','tax_code','fiscal_code','document_number']))
            AND c.value IS DISTINCT FROM jsonb_build_object('old', '***', 'new', '***')
       );

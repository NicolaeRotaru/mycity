-- 181_i_nomi_dei_clienti_che_il_negozio_vede.sql
--
-- 31/10/2026 (seconda ondata del sito) — IL NEGOZIO TORNA A LEGGERE IL NOME
-- DEI SUOI CLIENTI, E SOLO QUELLO.
--
-- Dopo la 161 (applicata in produzione) `profiles` si legge solo per la
-- propria riga e da amministratore. Le pagine del negozio prendevano il nome
-- del cliente proprio da li', agganciato alla conversazione
-- (`buyer:profiles!conversations_buyer_id_fkey`): l'aggancio torna vuoto senza
-- errore, e in chat il negoziante legge «Utente» al posto di ogni cliente.
-- Esempio: Maria scrive a Pane Quotidiano «A che ora chiudete?»; il fornaio
-- vede la domanda, ma non sa di chi e'.
--
-- Riaprire `profiles` al negozio sarebbe sbagliato: un filtro per RIGA porta
-- con se' tutta la riga (codice fiscale, IBAN, documenti), lo stesso errore che
-- la 115 aveva tolto al fattorino. Qui c'e' una funzione che restituisce DUE
-- colonne, id e nome, e solo per le persone che il negozio ha gia' davanti:
--   · chi gli ha scritto in chat         (conversations.seller_id)
--   · chi ha ordinato da lui             (orders.seller_id — il nome di
--                                          consegna sull'ordine lo legge gia')
--   · chi ha recensito il negozio        (store_reviews.store_id)
-- Per chiunque altro risponde niente, senza errore: un id estraneo non dice
-- nemmeno se quella persona esiste.
--
-- La stessa regola vale per l'account Assistenza, che in chat sta dal lato del
-- negozio: vede il nome di chi le scrive, come prima della 161.
--
-- Il sito regge anche PRIMA di questa migrazione: se la funzione non c'e', la
-- chat e le recensioni mostrano «Cliente» al posto del nome e restano in piedi.
--
-- Reversibile: DROP FUNCTION public.nomi_dei_clienti_del_negozio(uuid[]);

BEGIN;

CREATE OR REPLACE FUNCTION public.nomi_dei_clienti_del_negozio(p_ids uuid[])
RETURNS TABLE (id uuid, full_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT p.id, p.full_name
    FROM public.profiles p
   WHERE (SELECT auth.uid()) IS NOT NULL
     -- Un tetto alla domanda: la chat ne chiede al massimo 50, le recensioni
     -- di un negozio restano ben sotto le mille.
     AND p.id = ANY ((coalesce(p_ids, '{}'::uuid[]))[1:1000])
     AND p.id <> (SELECT auth.uid())
     AND (
           EXISTS (SELECT 1 FROM public.conversations c
                    WHERE c.seller_id = (SELECT auth.uid()) AND c.buyer_id = p.id)
        OR EXISTS (SELECT 1 FROM public.orders o
                    WHERE o.seller_id = (SELECT auth.uid()) AND o.user_id = p.id)
        OR EXISTS (SELECT 1 FROM public.store_reviews r
                    WHERE r.store_id = (SELECT auth.uid()) AND r.user_id = p.id)
     );
$function$;

COMMENT ON FUNCTION public.nomi_dei_clienti_del_negozio(uuid[]) IS
  'Il nome (solo id e full_name) dei clienti che chi chiama ha davanti: chi gli '
  'ha scritto in chat, chi ha ordinato da lui, chi lo ha recensito. Per ogni '
  'altro id non restituisce niente. Sostituisce la lettura di profiles chiusa '
  'dalla 161 (181). Non aggiungere colonne senza chiedersi se il negozio puo '
  'vederle.';

REVOKE ALL     ON FUNCTION public.nomi_dei_clienti_del_negozio(uuid[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.nomi_dei_clienti_del_negozio(uuid[]) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

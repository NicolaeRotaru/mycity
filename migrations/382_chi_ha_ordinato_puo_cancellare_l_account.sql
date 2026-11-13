-- 382 — CHI HA ORDINATO PUO' CANCELLARE L'ACCOUNT.
--
-- IL DIFETTO (R14-005, rls-database, grave). Chi ha fatto anche un solo ordine
-- non riusciva a cancellare il proprio account. La cancellazione vera
-- (lib/account/cancellazione.ts, `admin.auth.admin.deleteUser`) la fa il
-- servizio di autenticazione: cancella la riga di `auth.users` col suo ruolo
-- (`supabase_auth_admin`) e SENZA i claims di un utente. Da li' PostgreSQL
-- cancella il profilo (ON DELETE CASCADE) e mette a NULL `orders.user_id`
-- (ON DELETE SET NULL). Quella scrittura la esegue PostgreSQL stesso, come
-- proprietario della tabella `orders`, e passa dal guardiano
-- `enforce_order_update_rules` (versione in vigore: 179). Il guardiano si fida
-- solo di `service_role`, di un `role = service_role` nei claims o della spia
-- `mycity.allow_order_write`: nessuna delle tre c'e' in quella scrittura, e
-- `user_id` non e' fra le otto colonne consentite. Risultato: «orders: modifica
-- di un campo protetto non consentita», la cancellazione fallisce, la richiesta
-- si ritenta ogni notte e rifallisce per sempre. La prova SQL che lo copriva
-- (tests/sql/rls/31) scriveva a mano `role = service_role` nei claims prima del
-- DELETE: un permesso che il percorso vero non ha.
--
-- LA RIPARAZIONE. Il guardiano lascia passare UNA scrittura in piu', lo stacco
-- che fa il database quando la persona se ne va, e solo quella. Servono tutte
-- e quattro le condizioni:
--  ① chi scrive e' il proprietario della tabella `orders`: e' il ruolo con cui
--     PostgreSQL esegue un ON DELETE SET NULL. Un browser (`anon`,
--     `authenticated`) non lo e' mai;
--  ② la scrittura nasce dentro un altro grilletto (`pg_trigger_depth() > 1`):
--     la cascata parte dal grilletto della chiave esterna sul profilo;
--  ③ cambia SOLO `user_id`, e diventa NULL: nessun'altra colonna, nessun soldo;
--  ④ il profilo a cui puntava non c'e' piu'. Fuori da una cancellazione la
--     chiave esterna garantisce che esista, quindi questa condizione da sola
--     non si avvera mai per un ordine vivo.
-- Il controllo del profilo gira solo quando ①-③ sono vere: un browser non
-- arriva mai a leggerlo (sotto RLS un profilo che non vede sembrerebbe
-- sparito).
--
-- Tutto il resto del corpo e' identico alla 179: firma, SECURITY INVOKER,
-- search_path. CREATE OR REPLACE tiene proprietario e permessi.
--
-- FUORI DA QUI: la stessa cascata su `seller_id`, `rider_id` e
-- `cash_collected_by` (un negozio o un fattorino che hanno avuto ordini)
-- resta respinta. Per un negozio con bonifici ancora trattenuti e' una scelta
-- di soldi, non un dettaglio: e' scritta nel referto.
--
-- REVERSIBILE: si ricrea la funzione col testo della 179 (riga 51).
--
-- LA PROVA: tests/sql/rls/riparazione-r14-cancellazione.test.sql.

CREATE OR REPLACE FUNCTION public.enforce_order_update_rules()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := (SELECT auth.uid());
  -- Chi esegue la scrittura. I ruoli del browser non si fidano delle spie di sessione.
  dal_browser boolean := current_user IN ('anon', 'authenticated');
  is_priv boolean := public.is_admin()
    OR (NOT dal_browser AND (
          current_user = 'service_role'
       OR coalesce((SELECT auth.jwt() ->> 'role'), '') = 'service_role'
       OR coalesce(current_setting('mycity.allow_order_write', true), '') = '1'));
  consentiti text[] := ARRAY[
    'delivery_status',
    'rider_id',
    'accepted_at',
    'ready_at',
    'rider_lat',
    'rider_lng',
    'rider_position_updated_at',
    'updated_at'
  ];
  e_rider_approvato boolean;
BEGIN
  IF is_priv THEN
    RETURN NEW;
  END IF;

  -- 382 — Lo stacco che fa il database quando la persona se ne va
  -- (ON DELETE SET NULL da `profiles`). Le quattro condizioni sono spiegate
  -- in testa alla migrazione.
  IF NOT dal_browser
     AND current_user = (SELECT pg_catalog.pg_get_userbyid(c.relowner)
                           FROM pg_catalog.pg_class c WHERE c.oid = TG_RELID)
     AND pg_catalog.pg_trigger_depth() > 1
     AND OLD.user_id IS NOT NULL
     AND NEW.user_id IS NULL
     AND (to_jsonb(NEW) - 'user_id') IS NOT DISTINCT FROM (to_jsonb(OLD) - 'user_id') THEN
    IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = OLD.user_id) THEN
      RETURN NEW;
    END IF;
  END IF;

  IF (to_jsonb(NEW) - consentiti) IS DISTINCT FROM (to_jsonb(OLD) - consentiti) THEN
    RAISE EXCEPTION 'orders: modifica di un campo protetto non consentita'
      USING ERRCODE = '42501';
  END IF;

  e_rider_approvato := public.is_rider_approvato();

  -- 22/8/2026 — LA POSIZIONE LA SCRIVE CHI CONSEGNA, NON CHI VENDE.
  IF NEW.rider_lat IS DISTINCT FROM OLD.rider_lat
     OR NEW.rider_lng IS DISTINCT FROM OLD.rider_lng
     OR NEW.rider_position_updated_at IS DISTINCT FROM OLD.rider_position_updated_at THEN
    IF OLD.rider_id IS NULL OR OLD.rider_id <> uid THEN
      RAISE EXCEPTION 'orders: la posizione la scrive solo il fattorino assegnato'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- 22/8/2026 — GLI ORARI DEL NEGOZIO LI SCRIVE IL NEGOZIO.
  IF NEW.accepted_at IS DISTINCT FROM OLD.accepted_at
     OR NEW.ready_at IS DISTINCT FROM OLD.ready_at THEN
    IF OLD.seller_id IS NULL OR OLD.seller_id <> uid THEN
      RAISE EXCEPTION 'orders: accettazione e pronto li scrive solo il negozio dell''ordine'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF NEW.rider_id IS DISTINCT FROM OLD.rider_id THEN
    IF NOT (OLD.rider_id IS NULL AND NEW.rider_id = uid
            AND OLD.delivery_status = 'READY' AND NEW.delivery_status = 'ASSIGNED'
            AND e_rider_approvato) THEN
      RAISE EXCEPTION 'orders: riassegnazione rider non consentita'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF NEW.delivery_status IS DISTINCT FROM OLD.delivery_status THEN
    IF OLD.seller_id = uid AND (
         (OLD.delivery_status = 'NEW'      AND NEW.delivery_status = 'ACCEPTED')
      OR (OLD.delivery_status = 'ACCEPTED' AND NEW.delivery_status = 'READY')
    ) THEN
      NULL; -- negoziante: accetta / pronto
    ELSIF OLD.delivery_status = 'READY' AND OLD.rider_id IS NULL
          AND NEW.delivery_status = 'ASSIGNED' AND NEW.rider_id = uid
          AND e_rider_approvato THEN
      NULL; -- fattorino approvato: presa in carico
    ELSIF OLD.rider_id = uid AND e_rider_approvato
          AND OLD.delivery_status = 'PICKED_UP' AND NEW.delivery_status = 'OUT_FOR_DELIVERY' THEN
      NULL; -- fattorino: in consegna
    ELSE
      RAISE EXCEPTION 'orders: transizione % -> % non consentita',
        OLD.delivery_status, NEW.delivery_status USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

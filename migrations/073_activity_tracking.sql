-- 073 — activity_events: firehose di sorveglianza per l'admin ("Grande Fratello").
--
-- Traccia OGNI movimento della piattaforma in un'unica tabella:
--   * visitatori (anche anonimi): page_view, session_start  → scritti dall'API /api/track
--   * accessi: login, logout, signup                        → scritti dall'API /api/track
--   * cambiamenti dati: insert/update/delete sulle tabelle  → scritti dai TRIGGER qui sotto
--   * azioni admin: mirror di audit_logs                    → scritti da lib/audit.ts
--
-- Letta SOLO dall'admin (RLS: is_admin()). Scritta SOLO via service-role (API route)
-- e via trigger SECURITY DEFINER → nessuna policy di INSERT (anon/authenticated non
-- possono inserire). Idempotente.
--
-- Nota privacy: salva IP + user-agent dei visitatori anonimi come log di sicurezza /
-- interesse legittimo (coerente con lib/consent.ts → categoria "necessary").

-- ---------------------------------------------------------------------------
-- 1) Tabella
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.activity_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category     text NOT NULL,            -- visitor | auth | commerce | catalog | content | user | moderation | system
  event_type   text NOT NULL,            -- page_view | login | order.insert | product.update | ...
  action       text,                     -- insert | update | delete (trigger) | null (beacon)
  summary      text,                     -- riga leggibile pre-calcolata
  actor_id     uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  user_id      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  anon_id      text,                     -- cookie mc_vid: correla visite anonime ricorrenti
  session_id   text,                     -- id per-tab (sessionStorage)
  target_table text,
  target_id    text,
  path         text,
  referrer     text,
  ip           text,
  user_agent   text,
  device_type  text,                     -- mobile | tablet | desktop | bot | unknown
  browser      text,
  os           text,
  country      text,
  city         text,
  is_bot       boolean NOT NULL DEFAULT false,
  metadata     jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS activity_events_created_idx  ON public.activity_events (created_at DESC);
CREATE INDEX IF NOT EXISTS activity_events_category_idx ON public.activity_events (category, created_at DESC);
CREATE INDEX IF NOT EXISTS activity_events_type_idx     ON public.activity_events (event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS activity_events_actor_idx    ON public.activity_events (actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS activity_events_user_idx     ON public.activity_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS activity_events_anon_idx     ON public.activity_events (anon_id, created_at DESC);
CREATE INDEX IF NOT EXISTS activity_events_ip_idx       ON public.activity_events (ip);
CREATE INDEX IF NOT EXISTS activity_events_target_idx   ON public.activity_events (target_table, target_id);

-- ---------------------------------------------------------------------------
-- 2) RLS: solo admin legge. Nessun INSERT policy (service-role/trigger bypassano).
-- ---------------------------------------------------------------------------
ALTER TABLE public.activity_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read activity_events" ON public.activity_events;
CREATE POLICY "Admins can read activity_events"
  ON public.activity_events FOR SELECT
  USING (public.is_admin());

-- ---------------------------------------------------------------------------
-- 3) Change-data-capture: funzione trigger generica.
--    AFTER INSERT/UPDATE/DELETE FOR EACH ROW. SECURITY DEFINER per scrivere
--    bypassando la RLS. Avvolta in EXCEPTION: un errore di logging NON deve MAI
--    rompere la transazione applicativa (l'app continua a funzionare).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_activity_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_category   text;
  v_action     text := lower(TG_OP);              -- insert | update | delete
  v_row        jsonb := to_jsonb(COALESCE(NEW, OLD));
  v_old        jsonb := CASE WHEN OLD IS NULL THEN '{}'::jsonb ELSE to_jsonb(OLD) END;
  v_new        jsonb := CASE WHEN NEW IS NULL THEN '{}'::jsonb ELSE to_jsonb(NEW) END;
  v_target_id  text  := COALESCE(v_row->>'id', '');
  v_diff       jsonb := '{}'::jsonb;
  v_key        text;
  v_meta       jsonb;
  v_summary    text;
  -- colonne sensibili da redarre nel diff (mai loggare valori grezzi)
  v_redact     text[] := ARRAY['password','token','secret','access_token','refresh_token',
                               'card','iban','cvv','tax_code','fiscal_code','document_number'];
BEGIN
  -- categoria per tabella
  v_category := CASE TG_TABLE_NAME
    WHEN 'orders'             THEN 'commerce'
    WHEN 'order_items'        THEN 'commerce'
    WHEN 'disputes'           THEN 'commerce'
    WHEN 'returns'            THEN 'commerce'
    WHEN 'coupons'            THEN 'commerce'
    WHEN 'gift_cards'         THEN 'commerce'
    WHEN 'products'           THEN 'catalog'
    WHEN 'seller_promotions'  THEN 'catalog'
    WHEN 'reviews'            THEN 'content'
    WHEN 'store_reviews'      THEN 'content'
    WHEN 'marketplace_events' THEN 'content'
    WHEN 'profiles'           THEN 'user'
    ELSE 'system'
  END;

  -- diff delle sole colonne cambiate (solo su UPDATE), con redazione
  IF TG_OP = 'UPDATE' THEN
    FOR v_key IN SELECT jsonb_object_keys(v_new) LOOP
      IF (v_new->v_key) IS DISTINCT FROM (v_old->v_key) THEN
        IF v_key = ANY(v_redact) THEN
          v_diff := v_diff || jsonb_build_object(v_key, jsonb_build_object('old','***','new','***'));
        ELSE
          v_diff := v_diff || jsonb_build_object(v_key,
            jsonb_build_object('old', v_old->v_key, 'new', v_new->v_key));
        END IF;
      END IF;
    END LOOP;
    -- niente cambiamenti reali (es. trigger updated_at) → non loggare rumore
    IF v_diff = '{}'::jsonb THEN
      RETURN COALESCE(NEW, OLD);
    END IF;
    v_meta := jsonb_build_object('changed', v_diff);
    v_summary := TG_TABLE_NAME || ' #' || left(v_target_id, 8) || ' aggiornato ('
                 || (SELECT count(*) FROM jsonb_object_keys(v_diff)) || ' campi)';
  ELSIF TG_OP = 'INSERT' THEN
    v_meta := NULL;
    v_summary := TG_TABLE_NAME || ' #' || left(v_target_id, 8) || ' creato';
  ELSE -- DELETE
    v_meta := jsonb_build_object('deleted_row_id', v_target_id);
    v_summary := TG_TABLE_NAME || ' #' || left(v_target_id, 8) || ' eliminato';
  END IF;

  INSERT INTO public.activity_events
    (category, event_type, action, summary, actor_id, target_table, target_id, metadata)
  VALUES
    (v_category, TG_TABLE_NAME || '.' || v_action, v_action, v_summary,
     auth.uid(), TG_TABLE_NAME, NULLIF(v_target_id, ''), v_meta);

  RETURN COALESCE(NEW, OLD);
EXCEPTION WHEN OTHERS THEN
  -- il logging non deve MAI rompere la scrittura applicativa
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Lockdown esecuzione: è una funzione TRIGGER, non va esposta via RPC
-- (coerente con migrazioni 064/067). Il trigger gira come owner della tabella.
REVOKE ALL ON FUNCTION public.log_activity_change() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4) Attacco i trigger a un set curato di tabelle ad alto valore.
--    Helper inline via DO-block per restare idempotenti e concisi.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'orders','order_items','products','profiles','reviews','store_reviews',
    'coupons','disputes','marketplace_events','seller_promotions','returns','gift_cards'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema = 'public' AND table_name = t) THEN
      EXECUTE format('DROP TRIGGER IF EXISTS trg_activity_log ON public.%I;', t);
      EXECUTE format(
        'CREATE TRIGGER trg_activity_log AFTER INSERT OR UPDATE OR DELETE ON public.%I
           FOR EACH ROW EXECUTE FUNCTION public.log_activity_change();', t);
    END IF;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

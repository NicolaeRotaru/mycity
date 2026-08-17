-- =============================================================================
-- 117 — Le visite ai prodotti non si possono più gonfiare
-- =============================================================================
-- Il difetto: le visite anonime erano scrivibili senza alcun limite con la
-- chiave pubblica del browser. Il controllo anti-duplicato salta le righe
-- anonime («IF NEW.user_id IS NOT NULL AND EXISTS …»), quindi un ciclo di
-- richieste con la chiave che sta nel bundle poteva scrivere quante visite
-- voleva su un prodotto qualsiasi. Con quelle visite si costruiscono i
-- «più visti» della home e le statistiche del negoziante: due numeri su cui si
-- decide cosa spingere e cosa tenere in catalogo.
--
-- La riparazione non può essere «vietare le visite anonime»: la maggior parte
-- di chi guarda un prodotto non ha un account, e senza quel dato i più visti
-- diventano i più visti DAI SOLI ISCRITTI. Si aggiunge invece un tetto: al
-- massimo N visite anonime per prodotto al minuto. Il traffico vero ci sta
-- sotto; un ciclo automatico no.
--
-- Prova: tests/sql/rls/03-visite-prodotto.test.sql
-- Idempotente.
-- =============================================================================

BEGIN;

-- Un indice sul tempo: serve al conteggio dentro il trigger.
CREATE INDEX IF NOT EXISTS product_views_prodotto_tempo_idx
  ON public.product_views (product_id, viewed_at DESC);

CREATE OR REPLACE FUNCTION public.product_views_dedup()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Quante visite anonime si accettano per prodotto al minuto. Una pagina molto
  -- visitata fa qualche decina di visite al minuto nei momenti di punta: venti
  -- lascia respiro al traffico vero e taglia i cicli automatici.
  TETTO_ANONIME_AL_MINUTO constant int := 20;
  recenti int;
BEGIN
  -- Persona con un account: massimo una visita per prodotto ogni ora (come prima).
  IF NEW.user_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.product_views
       WHERE user_id = NEW.user_id
         AND product_id = NEW.product_id
         AND viewed_at > now() - interval '1 hour'
    ) THEN
      RETURN NULL; -- duplicato: si salta in silenzio, senza errore
    END IF;
    RETURN NEW;
  END IF;

  -- Visita anonima: si contano quelle dell'ultimo minuto sullo stesso prodotto.
  SELECT count(*) INTO recenti
    FROM public.product_views
   WHERE product_id = NEW.product_id
     AND user_id IS NULL
     AND viewed_at > now() - interval '1 minute';

  IF recenti >= TETTO_ANONIME_AL_MINUTO THEN
    RETURN NULL; -- oltre il tetto: si scarta, senza dire perché a chi chiama
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_product_views_dedup ON public.product_views;
CREATE TRIGGER trg_product_views_dedup
  BEFORE INSERT ON public.product_views
  FOR EACH ROW
  EXECUTE FUNCTION public.product_views_dedup();

COMMIT;

NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- 117b — I numeri del cruscotto si contano nel database, non nel browser
-- =============================================================================
-- Il difetto: il pannello di amministrazione scaricava tabelle INTERE
-- (`select('role')` su profiles, `select('total_price, delivery_status,
-- created_at')` su orders, `select('status')` su products) e sommava nel
-- browser, senza nessun limite dichiarato. PostgREST però ha un tetto di righe
-- per risposta: superato quello, la risposta arriva TRONCATA e senza dire niente.
-- Cioè: appena il marketplace cresce, ogni numero del cruscotto comincia a
-- mentire per difetto — e nessuno lo vede, perché il numero c'è, sembra solo
-- più piccolo.
--
-- Qui il conto si fa dove stanno i dati: una funzione, una risposta, nessun
-- tetto di righe di mezzo.
BEGIN;

CREATE OR REPLACE FUNCTION public.admin_kpi()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  risultato jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'riservato allo staff' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'utenti', (SELECT jsonb_object_agg(role, n) FROM (
                 SELECT role, count(*) AS n FROM public.profiles GROUP BY role) x),
    'utenti_totali', (SELECT count(*) FROM public.profiles),
    'ordini_totali', (SELECT count(*) FROM public.orders),
    'ordini_per_stato', (SELECT jsonb_object_agg(delivery_status, n) FROM (
                 SELECT delivery_status, count(*) AS n FROM public.orders GROUP BY delivery_status) y),
    -- Incassato sugli ordini consegnati, in centesimi: nessun arrotondamento
    -- fatto a pezzi nel browser.
    'incassato_cents', (SELECT coalesce(sum(round(total_price * 100)), 0)::bigint
                          FROM public.orders WHERE delivery_status = 'DELIVERED'),
    'incassato_7g_cents', (SELECT coalesce(sum(round(total_price * 100)), 0)::bigint
                          FROM public.orders
                         WHERE delivery_status = 'DELIVERED'
                           AND created_at >= now() - interval '7 days'),
    'ordini_7g', (SELECT count(*) FROM public.orders WHERE created_at >= now() - interval '7 days'),
    'prodotti_totali', (SELECT count(*) FROM public.products),
    'prodotti_disponibili', (SELECT count(*) FROM public.products WHERE status = 'available'),
    -- La commissione VERA trattenuta, non una stima su un'aliquota scritta a
    -- mano: si somma quella registrata su ogni ordine.
    'commissioni_cents', (SELECT coalesce(sum(application_fee_cents), 0)::bigint
                          FROM public.orders
                         WHERE delivery_status = 'DELIVERED')
  ) INTO risultato;

  RETURN risultato;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_kpi() FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.admin_kpi() TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';

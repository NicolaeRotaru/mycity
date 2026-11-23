-- La visita con un account si scrive solo a nome di chi la manda, e il trigger lo controlla
-- per primo.
--
-- LA REGOLA. Una riga di product_views con user_id pieno la puo' scrivere dal browser solo la
-- persona di quell'user_id (e' la stessa regola di pv_insert_own_or_guest, 060). Adesso la
-- applica anche product_views_dedup, in testa, prima di qualunque altra domanda: chi scrive dal
-- browser (ruoli anon e authenticated) con un user_id che non e' il suo riceve 42501, lo stesso
-- errore della regola di scrittura, qualunque cosa ci sia gia' nella tabella. Il resto del
-- trigger (una visita all'ora per persona, una all'ora per impronta, il tetto delle anonime senza
-- impronta) e' quello della 119, riga per riga.
--
-- CHI NON E' TOCCATO. Il server (service_role) e chi lavora direttamente sul database (le semine,
-- le migrazioni) non passano dalle regole del browser: per loro il controllo non vale, come la
-- regola di scrittura. Il ruolo si legge da current_setting('role'), che resta quello di chi ha
-- fatto la richiesta anche dentro una funzione SECURITY DEFINER.
--
-- Si puo' rieseguire. NON si applica a mano: lo decide Nicola, come ogni migrazione.
-- REVERSIBILE: rieseguire il blocco «041» della 119 (CREATE OR REPLACE FUNCTION
-- public.product_views_dedup), che rimette il trigger com'era.
-- LA PROVA: tests/sql/rls/s02-controllo-03.test.sql.

BEGIN;

CREATE OR REPLACE FUNCTION public.product_views_dedup()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  TETTO_SENZA_IMPRONTA_AL_MINUTO constant int := 20;
  recenti int;
  ruolo text := coalesce(current_setting('role', true), '');
BEGIN
  -- Dal browser una visita con un account e' solo a proprio nome: il controllo viene prima di
  -- ogni lettura della tabella, cosi' la risposta non dipende dalle visite gia' scritte.
  IF NEW.user_id IS NOT NULL
     AND ruolo IN ('anon', 'authenticated')
     AND NEW.user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'new row violates row-level security policy for table "product_views"'
      USING ERRCODE = '42501';
  END IF;

  -- Persona con un account: una visita per prodotto ogni ora.
  IF NEW.user_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.product_views
       WHERE user_id = NEW.user_id
         AND product_id = NEW.product_id
         AND viewed_at > now() - interval '1 hour'
    ) THEN
      RETURN NULL;
    END IF;
    RETURN NEW;
  END IF;

  -- Visita anonima CON impronta: una per impronta all'ora.
  IF coalesce(NEW.view_fingerprint, '') <> '' THEN
    IF EXISTS (
      SELECT 1 FROM public.product_views
       WHERE product_id = NEW.product_id
         AND user_id IS NULL
         AND view_fingerprint = NEW.view_fingerprint
         AND viewed_at > now() - interval '1 hour'
    ) THEN
      RETURN NULL;
    END IF;
    RETURN NEW;
  END IF;

  -- Visita anonima SENZA impronta: il tetto al minuto per prodotto.
  SELECT count(*) INTO recenti
    FROM public.product_views
   WHERE product_id = NEW.product_id
     AND user_id IS NULL
     AND coalesce(view_fingerprint, '') = ''
     AND viewed_at > now() - interval '1 minute';

  IF recenti >= TETTO_SENZA_IMPRONTA_AL_MINUTO THEN
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$$;

COMMIT;

NOTIFY pgrst, 'reload schema';

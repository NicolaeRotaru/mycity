-- 998 — S02: due controlli più stretti all'inserimento.
--
-- S02-01 controllo più stretto su public.segnalazioni.
-- S02-02 controllo più stretto su public.store_reviews e public.reviews.
--
-- Chi scrive dal browser (ruoli anon e authenticated, non amministratore) passa da
-- un trigger BEFORE INSERT che riporta la riga ai valori di partenza. Il server
-- (service_role), l'amministratore e chi lavora direttamente sul database (semine,
-- migrazioni) non cambiano. Il ruolo si legge da current_setting('role'), che resta
-- quello di chi ha fatto la richiesta anche dentro una funzione SECURITY DEFINER
-- (stessa lettura della 810).
--
-- Si può rieseguire. NON si applica da sola: la applica Nicola, come ogni migrazione.
-- REVERSIBILE: DROP TRIGGER dei trigger qui sotto e DROP FUNCTION delle tre funzioni.
-- LE PROVE: tests/sql/rls/riparazione-s02-01.test.sql, tests/sql/rls/riparazione-s02-02.test.sql.

BEGIN;

-- ── S02-01 ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.segnalazioni_prima_dell_inserimento()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ruolo text := coalesce(current_setting('role', true), '');
BEGIN
  IF ruolo NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;
  IF ruolo = 'authenticated' AND public.is_admin() THEN
    RETURN NEW;
  END IF;

  NEW.stato          := 'ricevuta';
  NEW.esito_motivato := NULL;
  NEW.deciso_da      := NULL;
  NEW.deciso_at      := NULL;
  NEW.created_at     := now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.segnalazioni_prima_dell_inserimento() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_segnalazioni_prima_dell_inserimento ON public.segnalazioni;
CREATE TRIGGER trg_segnalazioni_prima_dell_inserimento
  BEFORE INSERT ON public.segnalazioni
  FOR EACH ROW EXECUTE FUNCTION public.segnalazioni_prima_dell_inserimento();

-- ── S02-02 ──────────────────────────────────────────────────────────────────
-- (a) Dal browser l'id di una recensione lo sceglie il database.
CREATE OR REPLACE FUNCTION public.recensioni_prima_dell_inserimento()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ruolo text := coalesce(current_setting('role', true), '');
BEGIN
  IF ruolo NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;
  IF ruolo = 'authenticated' AND public.is_admin() THEN
    RETURN NEW;
  END IF;

  NEW.id := gen_random_uuid();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.recensioni_prima_dell_inserimento() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_recensioni_prima_dell_inserimento ON public.store_reviews;
CREATE TRIGGER trg_recensioni_prima_dell_inserimento
  BEFORE INSERT ON public.store_reviews
  FOR EACH ROW EXECUTE FUNCTION public.recensioni_prima_dell_inserimento();

DROP TRIGGER IF EXISTS trg_recensioni_prima_dell_inserimento ON public.reviews;
CREATE TRIGGER trg_recensioni_prima_dell_inserimento
  BEFORE INSERT ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public.recensioni_prima_dell_inserimento();

-- (b) Un id è di una recensione sola, fra le due tabelle, per chiunque scriva.
--     Trigger AFTER: guarda l'id finale della riga, qualunque cosa facciano i trigger
--     BEFORE. Il lucchetto sull'id fa aspettare due scritture in volo con lo stesso id,
--     e la seconda legge la prima: vale in READ COMMITTED (quello di PostgREST e del
--     database), dove ogni lettura vede quello che è già stato confermato. Negli altri
--     livelli la lettura non vedrebbe la scrittura in volo, quindi lì la scrittura di
--     una recensione si rifiuta.
CREATE OR REPLACE FUNCTION public.recensioni_id_unico()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  usato boolean;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'recensioni: si scrivono solo in read committed' USING ERRCODE = '55000';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('recensioni_id_unico:' || NEW.id::text, 0));

  IF TG_TABLE_NAME = 'store_reviews' THEN
    SELECT EXISTS (SELECT 1 FROM public.reviews WHERE id = NEW.id) INTO usato;
  ELSE
    SELECT EXISTS (SELECT 1 FROM public.store_reviews WHERE id = NEW.id) INTO usato;
  END IF;

  IF usato THEN
    RAISE EXCEPTION 'recensioni: id gia'' usato' USING ERRCODE = '23505';
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.recensioni_id_unico() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_recensioni_id_unico ON public.store_reviews;
CREATE TRIGGER trg_recensioni_id_unico
  AFTER INSERT OR UPDATE OF id ON public.store_reviews
  FOR EACH ROW EXECUTE FUNCTION public.recensioni_id_unico();

DROP TRIGGER IF EXISTS trg_recensioni_id_unico ON public.reviews;
CREATE TRIGGER trg_recensioni_id_unico
  AFTER INSERT OR UPDATE OF id ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public.recensioni_id_unico();

-- Le righe già scritte non si toccano: se due recensioni condividono già un id, lo si dice.
DO $$
DECLARE
  doppi int;
BEGIN
  SELECT count(*) INTO doppi
    FROM public.store_reviews s JOIN public.reviews r ON r.id = s.id;
  IF doppi > 0 THEN
    RAISE WARNING 'S02-02: % id presenti sia in store_reviews sia in reviews, da guardare a mano', doppi;
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';

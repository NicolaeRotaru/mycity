-- 999q_la_posizione_del_negozio_resta_in_area.sql
--
-- 28/11/2026 (onda 2, R06-002) — LA POSIZIONE DEL NEGOZIO RESTA DENTRO PIACENZA E DINTORNI ANCHE
-- QUANDO NON PASSA DAL MODULO.
--
-- Il caso. Il profilo del negozio (app/seller/profile/page.tsx) scrive store_lat e store_lng
-- direttamente dal browser, con le regole per riga: il controllo «dentro l'area servita» stava solo
-- nel selettore della mappa (components/StoreLocationPicker.tsx) e nella rotta della domanda di
-- iscrizione (app/api/seller/apply/route.ts). Una chiamata fatta a mano, un vecchio modulo in cache,
-- un errore del selettore: il negozio finiva a Podenzano o a Milano, fuori dal raggio di consegna di
-- ogni cliente, e nessuno lo diceva.
--
-- La guardia. Prima di scrivere una posizione NUOVA (inserimento, o store_lat/store_lng cambiati) il
-- database controlla che stia nel riquadro AREA_SERVITA di lib/ordini/zona-di-consegna.ts
-- (ovest 9.55, sud 44.93, est 9.85, nord 45.15): fuori, l'istruzione fallisce con 23514
-- («check_violation») e un messaggio leggibile. Una posizione vuota (NULL) resta ammessa: è il
-- negozio che non l'ha ancora messa. Le righe già scritte non si toccano: la guardia guarda solo i
-- cambi, quindi un negozio storico fuori riquadro non si blocca finché non sposta il segnaposto.
--
-- DA DECIDERE (Nicola, R06-002): se il negozio va limitato a un raggio dal centro di Piacenza
-- invece che al riquadro (negli angoli arriva a ~17,7 km). Se sì, cambiano solo i numeri qui e in
-- AREA_SERVITA, insieme: la prova tests/unit/riparazione-onda2-r06-002-posizione-in-area-nel-database.test.ts
-- controlla che siano gli stessi.
--
-- Idempotente: CREATE OR REPLACE per la funzione, DROP TRIGGER IF EXISTS prima del trigger.
-- Non si applica da sola: la applica Nicola.

CREATE OR REPLACE FUNCTION public.posizione_negozio_in_area()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.store_lat IS NOT NULL
     AND NEW.store_lng IS NOT NULL
     AND (TG_OP = 'INSERT'
          OR NEW.store_lat IS DISTINCT FROM OLD.store_lat
          OR NEW.store_lng IS DISTINCT FROM OLD.store_lng)
     AND NOT (NEW.store_lat BETWEEN 44.93 AND 45.15
              AND NEW.store_lng BETWEEN 9.55 AND 9.85)
  THEN
    RAISE EXCEPTION 'La posizione del negozio è fuori da Piacenza e dintorni, dove consegniamo'
      USING ERRCODE = '23514',
            HINT = 'Cerca di nuovo l''indirizzo con la città, o tocca la mappa sul negozio.';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS profiles_posizione_negozio_in_area ON public.profiles;
CREATE TRIGGER profiles_posizione_negozio_in_area
  BEFORE INSERT OR UPDATE OF store_lat, store_lng ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.posizione_negozio_in_area();

COMMENT ON FUNCTION public.posizione_negozio_in_area() IS
  'R06-002 (onda 2, 28/11/2026): una posizione del negozio nuova (store_lat, store_lng) deve stare nel riquadro AREA_SERVITA di lib/ordini/zona-di-consegna.ts; NULL ammesso, righe vecchie non toccate.';

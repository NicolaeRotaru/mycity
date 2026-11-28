-- =============================================================================
-- onda2_F1_1 — La fascia piena ferma i contanti anche quando due ordini arrivano insieme
-- =============================================================================
-- R07-009. In una fascia si accettano al massimo 5 giri (scelta di Nicola, fatto
-- `consegna.capienza`; `ORDINI_PER_FASCIA` in lib/quando-arriva.ts). La rotta dei
-- contanti (app/api/orders/cod/route.ts) adesso conta i giri prima di scrivere
-- l'ordine (`rifiutoPerFasciaPiena`, lib/ordini/giri-della-fascia.ts), ma fra la
-- lettura e l'inserimento non c'è nessun lucchetto: due clienti che confermano
-- nello stesso istante il quinto posto leggono tutti e due «c'è posto» e nasce il
-- sesto giro. Come la 840 per la veloce, l'ultima parola è del database.
--
-- La regola è quella del codice, detta qui una seconda volta:
--   · la fascia di un ordine vale per il giorno di Piacenza in cui è nato, più uno
--     se l'etichetta dice «Domani»; i minuti sono quelli scritti nell'etichetta
--     («Oggi · 16:30–18:00»). La veloce («Adesso · …») non è una fascia: esce;
--   · si contano gli ordini a domicilio non annullati, nati nelle ultime 48 ore,
--     la cui finestra si SOVRAPPONE a quella dell'ordine che nasce (una fascia di
--     prima, «Domani · 9:00–12:00», tocca sia la 9:00–11:00 sia la 11:00–13:00);
--   · si contano per PORTA, cioè cliente + indirizzo + CAP scritti senza badare a
--     maiuscole e spazi: un carrello di più negozi è un giro solo; se il cliente
--     ha già un ordine nella fascia allo stesso indirizzo, passa (stessa porta);
--     a un altro indirizzo è un altro giro;
--   · un ordine nuovo nasce solo se i giri degli altri più il suo non superano 5.
-- Se una di queste regole cambia nel codice, va cambiata anche qui (e quando il
-- tetto si potrà scrivere dal pannello, va letto da lì anche qui).
--
-- Il lucchetto (pg_advisory_xact_lock, fino alla fine della transazione) mette in
-- fila gli ordini in contanti con una fascia: il secondo aspetta che il primo sia
-- scritto, lo vede e si ferma con 23514 e il segno `fascia_piena`, che la rotta
-- trasforma nel 409 «Questa fascia è piena» (`eLaFasciaPienaDelDatabase`).
--
-- N-004 (onda 3) — ANCHE QUANDO L'ORDINE ENTRA NELLA FASCIA DOPO, NON SOLO QUANDO NASCE.
-- Il grilletto guardava solo l'INSERT. Il freno della veloce (lib/ordini/veloce-non-confermata.ts)
-- sposta con un UPDATE l'ordine veloce che il negozio non ha confermato in 10 minuti nella prima
-- fascia possibile: in una fascia con già 5 giri entrava il sesto, e nessuno lo fermava. Adesso
-- il grilletto scatta anche BEFORE UPDATE OF delivery_slot, con le stesse regole e lo stesso
-- lucchetto, ma solo quando la fascia CAMBIA davvero (riscrivere la stessa fascia, o cambiare
-- altre colonne di un ordine già nella fascia, non chiede un giro nuovo). L'ordine che si sposta
-- non si conta fra gli «altri» (la sua riga vecchia è lui). Il freno conta prima i giri e cerca
-- una fascia con posto (`rifiutoPerFasciaPiena`); questo è l'ultimo «no» se due giri del freno,
-- o un freno e una cassa, prendono l'ultimo posto insieme.
-- Le prove: tests/sql/rls/onda3-n004-la-fascia-piena-ferma-anche-lo-spostamento.test.sql e
-- tests/sql/rls/onda3-n004-due-spostamenti-insieme-nella-fascia-piena.test.sql (due sessioni vere).
--
-- Cosa NON cambia:
--   · gli ordini pagati con la carta: nascono nel webhook DOPO il pagamento, e un
--     rifiuto lì lascerebbe un cliente che ha pagato senza ordine. Contano fra i
--     giri, ma non vengono mai fermati qui (cosa fare quando la fascia si riempie
--     mentre la pagina di Stripe è aperta è una domanda aperta per Nicola);
--   · il ritiro in negozio, la veloce, gli ordini senza fascia: escono subito;
--   · le righe che ci sono già: si guarda solo l'ordine che nasce o che cambia fascia;
--   · lo spostamento di un ordine con la carta non si ferma, come la sua nascita (N-004).
--
-- Idempotente: CREATE OR REPLACE e DROP TRIGGER IF EXISTS.
-- Per tornare indietro:
--   DROP TRIGGER IF EXISTS orders_fascia_piena_ferma_i_contanti ON public.orders;
--   DROP FUNCTION IF EXISTS public.orders_fascia_piena_ferma_i_contanti();
--   DROP FUNCTION IF EXISTS public.giorno_e_finestra_della_fascia(text, timestamptz);
-- =============================================================================

BEGIN;

-- Il giorno di Piacenza e i minuti di una fascia, contati dal momento in cui è stata scelta.
-- Tutto NULL per ciò che non è una fascia con un orario (la veloce, un testo sconosciuto).
CREATE OR REPLACE FUNCTION public.giorno_e_finestra_della_fascia(
  p_etichetta text,
  p_scelta_il timestamptz,
  OUT giorno date,
  OUT da integer,
  OUT a integer
)
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  m text[];
BEGIN
  IF p_etichetta IS NULL OR p_scelta_il IS NULL THEN
    RETURN;
  END IF;
  -- Le etichette di lib/quando-arriva.ts: «Oggi · 7:30–9:00», «Domani · 9:00–11:00» e quelle di
  -- prima («In giornata · 15:00–18:00», «Stasera · 18:00–20:00»). Il trattino è quello lungo (–).
  m := regexp_match(p_etichetta, '^(Oggi|Domani|In giornata|Stasera) · (\d{1,2}):(\d{2})–(\d{1,2}):(\d{2})$');
  IF m IS NULL THEN
    RETURN;
  END IF;
  giorno := (p_scelta_il AT TIME ZONE 'Europe/Rome')::date + CASE WHEN m[1] = 'Domani' THEN 1 ELSE 0 END;
  da := m[2]::integer * 60 + m[3]::integer;
  a := m[4]::integer * 60 + m[5]::integer;
END;
$$;

REVOKE ALL ON FUNCTION public.giorno_e_finestra_della_fascia(text, timestamptz) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.orders_fascia_piena_ferma_i_contanti()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  cercata record;
  mio     boolean;
  altri   integer;
  nuova_porta text;
BEGIN
  -- N-004 — Su un UPDATE si guarda solo l'ordine che CAMBIA fascia: lo stesso valore riscritto passa.
  IF TG_OP = 'UPDATE' AND NEW.delivery_slot IS NOT DISTINCT FROM OLD.delivery_slot THEN
    RETURN NEW;
  END IF;

  -- Solo l'ordine in contanti a domicilio con una fascia, appena venduto o appena spostato.
  -- Tutto il resto passa.
  IF NEW.payment_method IS DISTINCT FROM 'cod'
     OR coalesce(NEW.pickup_in_store, false)
     OR NEW.delivery_slot IS NULL
     OR NEW.delivery_status IS NOT DISTINCT FROM 'CANCELED' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO cercata FROM public.giorno_e_finestra_della_fascia(NEW.delivery_slot, coalesce(NEW.created_at, now()));
  IF cercata.giorno IS NULL THEN
    RETURN NEW;
  END IF;

  -- Gli ordini in contanti con una fascia in fila uno alla volta: chi arriva dopo vede chi è già nato.
  PERFORM pg_advisory_xact_lock(hashtextextended('orders:fascia-in-contanti', 0));

  nuova_porta := lower(regexp_replace(btrim(coalesce(NEW.delivery_address, '')), '\s+', ' ', 'g'));

  SELECT
    coalesce(bool_or(n.stessa_porta), false),
    count(DISTINCT n.chiave) FILTER (WHERE NOT n.stessa_porta)
    INTO mio, altri
    FROM (
      SELECT
        CASE WHEN o.user_id IS NULL THEN 'riga:' || o.id::text
             ELSE 'porta:' || o.user_id::text
                  || '|' || lower(regexp_replace(btrim(coalesce(o.delivery_address, '')), '\s+', ' ', 'g'))
                  || '|' || lower(regexp_replace(btrim(coalesce(o.delivery_zip, '')), '\s+', ' ', 'g'))
        END AS chiave,
        (NEW.user_id IS NOT NULL AND o.user_id = NEW.user_id AND (
           nuova_porta = ''
           OR btrim(coalesce(o.delivery_address, '')) = ''
           OR (lower(regexp_replace(btrim(coalesce(o.delivery_address, '')), '\s+', ' ', 'g')) = nuova_porta
               AND lower(regexp_replace(btrim(coalesce(o.delivery_zip, '')), '\s+', ' ', 'g'))
                   = lower(regexp_replace(btrim(coalesce(NEW.delivery_zip, '')), '\s+', ' ', 'g')))
        )) AS stessa_porta
        FROM public.orders o
        CROSS JOIN LATERAL public.giorno_e_finestra_della_fascia(o.delivery_slot, o.created_at) f
       WHERE o.delivery_slot IS NOT NULL
         -- N-004: l'ordine che si sposta non conta se stesso (la sua riga di prima).
         AND o.id IS DISTINCT FROM NEW.id
         AND o.created_at >= now() - interval '48 hours'
         AND o.delivery_status IS DISTINCT FROM 'CANCELED'
         AND NOT coalesce(o.pickup_in_store, false)
         AND f.giorno = cercata.giorno
         AND f.da < cercata.a
         AND cercata.da < f.a
    ) n;

  -- Al massimo 5 giri per fascia (ORDINI_PER_FASCIA = 5).
  IF NOT mio AND altri + 1 > 5 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Questa fascia è piena: in quell’orario abbiamo già tutte le consegne che riusciamo a fare. Scegline un’altra.',
      HINT = 'fascia_piena';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.orders_fascia_piena_ferma_i_contanti() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS orders_fascia_piena_ferma_i_contanti ON public.orders;
CREATE TRIGGER orders_fascia_piena_ferma_i_contanti
  BEFORE INSERT OR UPDATE OF delivery_slot ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_fascia_piena_ferma_i_contanti();

COMMIT;

# Proposta: tenere la storia delle analisi (non applicata)

26/11/2026. **È solo una proposta: questo file non è in `migrations/`, e nessuno la applica finché Nicola non dice sì.**

## Perché

Regola di Nicola del 26/11, ore 15:00: «non si cancella mai niente, si archivia». Oggi invece due tabelle tengono **una riga sola per negozio**, e ogni analisi nuova cancella la vecchia:

- `schede_clienti` (migrazione 708): la scheda di n8n, compreso il rapporto dell'imprenditore (`analisi.fatti`, `analisi.business`). La porta `/api/agenzia/scheda-cliente` fa un `upsert`.
- `analisi_negozi` (migrazione 711): l'analisi di social, scheda Google e sito. Anche qui `upsert`.

Senza la storia il confronto mese su mese del Business e del Premium non ha niente con cui confrontare.

## Come

Una tabella d'archivio e due trigger `BEFORE UPDATE`: prima che una riga cambi, la sua versione vecchia si copia nell'archivio con la sua data. Il codice del sito non cambia: le porte continuano a fare `upsert`, e l'archivio si riempie da solo.

Quello che non si salva oggi (dati di Google, testi delle recensioni) non entra nell'archivio, perché le porte lo tolgono prima di scrivere (`lib/agenzia/rapporto.ts`, `analisiDaSalvare`, `campiDaSalvare`). Quindi la regola non si scontra col parere legale.

```sql
-- 8xx — La storia delle analisi: niente si cancella, si archivia (proposta del 26/11/2026).
BEGIN;

CREATE TABLE IF NOT EXISTS public.storico_analisi (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id_attivita uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  da_dove text NOT NULL CHECK (da_dove IN ('schede_clienti', 'analisi_negozi')),
  contenuto jsonb NOT NULL CHECK (octet_length(contenuto::text) <= 400000),
  valeva_dal timestamptz,
  archiviata_il timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS storico_analisi_per_negozio ON public.storico_analisi (id_attivita, archiviata_il DESC);

ALTER TABLE public.storico_analisi ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.storico_analisi FROM anon, authenticated;
GRANT ALL ON public.storico_analisi TO service_role;

CREATE OR REPLACE FUNCTION public.archivia_scheda_cliente() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.scheda IS DISTINCT FROM NEW.scheda THEN
    INSERT INTO public.storico_analisi (id_attivita, da_dove, contenuto, valeva_dal)
    VALUES (OLD.id_attivita, 'schede_clienti', OLD.scheda, OLD.aggiornata_il);
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.archivia_analisi_negozio() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (OLD.canali, OLD.sito) IS DISTINCT FROM (NEW.canali, NEW.sito) THEN
    INSERT INTO public.storico_analisi (id_attivita, da_dove, contenuto, valeva_dal)
    VALUES (OLD.id_attivita, 'analisi_negozi', jsonb_build_object('canali', OLD.canali, 'sito', OLD.sito), OLD.aggiornata_il);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS archivia_prima_di_cambiare ON public.schede_clienti;
CREATE TRIGGER archivia_prima_di_cambiare BEFORE UPDATE ON public.schede_clienti
  FOR EACH ROW EXECUTE FUNCTION public.archivia_scheda_cliente();

DROP TRIGGER IF EXISTS archivia_prima_di_cambiare ON public.analisi_negozi;
CREATE TRIGGER archivia_prima_di_cambiare BEFORE UPDATE ON public.analisi_negozi
  FOR EACH ROW EXECUTE FUNCTION public.archivia_analisi_negozio();

REVOKE EXECUTE ON FUNCTION public.archivia_scheda_cliente() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.archivia_analisi_negozio() FROM PUBLIC, anon, authenticated;

COMMIT;
```

## Da decidere prima di applicarla

1. **Le righe salvate prima del 26/11.** `analisi_negozi.canali` può contenere ancora voto e numero di recensioni di Google: il sito non li mostra più, ma sono nel database. Il parere dice che non si salvano. La regola di Nicola dice che non si cancella niente. Lo decide l'AD con Nicola: si possono ripulire solo i numeri di Google, lasciando tutto il resto.
2. **DataForSEO.** Il contratto dei flussi (v1.2, sez. 3) dice «passata `conserva_fino_al`, il sito cancella `dati`». Oggi il sito li nasconde e non li cancella. Con l'archivio vanno nascosti anche lì, oppure tolti all'ingresso in archivio.
3. **L'export dei dati** (`/api/account/export`) oggi manda la riga corrente. Con l'archivio, decidere se mandare anche la storia: è un diritto di accesso del titolare.

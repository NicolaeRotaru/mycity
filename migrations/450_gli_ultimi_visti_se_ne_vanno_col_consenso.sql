-- 450 — Gli «Ultimi visti» se ne vanno quando si toglie il consenso ai cookie statistici
--
-- Il difetto (R21-012): `recently_viewed` si scrive solo col consenso ai cookie
-- statistici (components/ProductViewTracker.tsx), quindi è un dato di analitica.
-- Ma quando la persona toglieva il consenso nessuno cancellava la sua lista:
-- la cancellava solo il riquadro «Ultimi visti», e solo se era aperto sulla
-- pagina in cui si toglieva il consenso. Dal banner su qualunque altra pagina
-- la cronologia dei prodotti guardati restava legata all'account, per sempre.
--
-- La cura: ogni scelta sui cookie arriva al server (lib/consent.ts → /api/consent)
-- e si scrive in `consent_log`, con l'account di chi ha fatto l'accesso. Quando
-- arriva un «no» ai cookie statistici di una persona con l'account, il database
-- cancella subito i suoi «Ultimi visti», qualunque sia la pagina da cui l'ha detto.
-- Chi non ha fatto l'accesso non ha «Ultimi visti» da cancellare.
--
-- Una volta sola, applicando la migrazione: si cancellano anche le liste di chi
-- ha già detto «no» e da allora non ha più detto «sì» (l'ultima scelta registrata
-- sui cookie statistici è un «no»).
--
-- Nessuna colonna nuova. La scadenza dei 14 mesi sta nella potatura notturna
-- (lib/privacy/potature-ritenzione.ts, `recently_viewed`).

CREATE OR REPLACE FUNCTION public.ultimi_visti_via_col_consenso()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.recently_viewed WHERE user_id = NEW.user_id;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.ultimi_visti_via_col_consenso() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_ultimi_visti_via_col_consenso ON public.consent_log;
CREATE TRIGGER trg_ultimi_visti_via_col_consenso
  AFTER INSERT ON public.consent_log
  FOR EACH ROW
  WHEN (NEW.categoria = 'analytics' AND NEW.valore = false AND NEW.user_id IS NOT NULL)
  EXECUTE FUNCTION public.ultimi_visti_via_col_consenso();

-- Chi ha già detto «no» prima di questa migrazione.
DELETE FROM public.recently_viewed rv
 USING (
   SELECT DISTINCT ON (user_id) user_id, valore
     FROM public.consent_log
    WHERE categoria = 'analytics' AND user_id IS NOT NULL
    ORDER BY user_id, created_at DESC
 ) ultima
 WHERE rv.user_id = ultima.user_id
   AND ultima.valore = false;

NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- 530 — IL RECESSO SI DECIDE SUL PRODOTTO COM'ERA QUANDO E' STATO VENDUTO
-- =============================================================================
--
-- NON APPLICATA. La applica Nicola.
--
-- ── Cosa c'e' che non va, in parole semplici ─────────────────────────────────
-- «Escluso dal recesso» (pane, freschi, ordinazioni: `products.non_recedibile`,
-- migrazione 180) sta solo sul prodotto, e la rotta dei resi lo legge com'e'
-- ADESSO. Il negozio puo' spuntarlo dopo la vendita: il cliente che ha comprato
-- un barattolo di miele quando il ripensamento era ammesso chiede «Cambio idea»
-- e si vede rispondere che il prodotto e' escluso. La legge chiede di dirlo
-- PRIMA dell'acquisto (art. 49 c.1 lett. m Cod. Cons.): dopo non si toglie.
--
-- ── Cosa fa ──────────────────────────────────────────────────────────────────
-- ① `order_items.non_recedibile`: la copia dello stato del prodotto nel momento
--    in cui la riga d'ordine nasce. La scrive il database (trigger prima
--    dell'inserimento), mai chi inserisce: un valore mandato da fuori si
--    ignora. Riga senza prodotto: recedibile (il recesso e' la regola).
-- ② Le righe gia' scritte prendono lo stato di adesso del loro prodotto: e'
--    l'unico che c'e', e da qui in avanti non cambia piu'. Quelle col prodotto
--    gia' cancellato restano NULL, e la rotta le tratta come prima (recedibili).
-- ③ La colonna su products si crea se manca (la 180 non ancora applicata):
--    senza, il trigger farebbe cadere ogni ordine.
--
-- La rotta dei resi (app/api/returns/create/route.ts) decide sulla copia quando
-- c'e', e sul prodotto solo per le righe senza copia. Dopo averla applicata va
-- rigenerato lib/database.types.ts.
--
-- ── Che rischio ha ───────────────────────────────────────────────────────────
-- Una colonna nuova (NULL per difetto) e un trigger su order_items. L'UPDATE
-- delle righe gia' scritte tocca solo la colonna nuova.
--
-- REVERSIBILE: DROP TRIGGER trg_recesso_alla_vendita ON public.order_items;
-- DROP FUNCTION public.recesso_alla_vendita(); ALTER TABLE public.order_items
-- DROP COLUMN non_recedibile;
--
-- La prova: tests/sql/rls/riparazione-r29-il-recesso-del-prodotto-venduto.test.sql
-- =============================================================================

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS non_recedibile boolean NOT NULL DEFAULT false;

ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS non_recedibile boolean;

COMMENT ON COLUMN public.order_items.non_recedibile IS
  'Escluso dal recesso al momento della vendita (copia di products.non_recedibile scritta dal database alla nascita della riga). Decide il reso per CHANGED_MIND; NULL solo sulle righe antiche col prodotto cancellato.';

CREATE OR REPLACE FUNCTION public.recesso_alla_vendita()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Sempre dal prodotto, mai da chi inserisce: un cliente non si scrive da solo «recedibile».
  NEW.non_recedibile := coalesce(
    (SELECT p.non_recedibile FROM public.products p WHERE p.id = NEW.product_id),
    false
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_recesso_alla_vendita ON public.order_items;
CREATE TRIGGER trg_recesso_alla_vendita
  BEFORE INSERT ON public.order_items
  FOR EACH ROW EXECUTE FUNCTION public.recesso_alla_vendita();

REVOKE ALL ON FUNCTION public.recesso_alla_vendita() FROM PUBLIC, anon, authenticated;

UPDATE public.order_items oi
   SET non_recedibile = p.non_recedibile
  FROM public.products p
 WHERE p.id = oi.product_id
   AND oi.non_recedibile IS NULL;

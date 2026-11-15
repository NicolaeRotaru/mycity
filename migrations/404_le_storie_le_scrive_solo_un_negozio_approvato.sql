-- 404 — Le storie le scrive solo un negozio approvato (R16-019)
--
-- Il difetto: la regola `seller_stories_owner_write` (035, mai ridefinita dopo) chiede
-- solo che chi scrive sia l'autore della storia, non che sia un negozio approvato.
-- Qualunque account poteva pubblicare storie a proprio nome e riempire il carosello
-- delle storie in home: il carosello legge le 200 più recenti, toglie quelle dei
-- non-negozi e mostra le prime 30, quindi bastavano 200 storie per svuotarlo per tutti.
--
-- La cura: la regola per tutto si divide in quattro.
--   · scrivere una storia nuova, e modificarne una, solo un negozio approvato
--     (ruolo seller e is_approved, la stessa domanda della regola dei prodotti, 119);
--     anche la modifica, perché un account non più approvato non possa allungare
--     la scadenza di una storia vecchia e tenerla in vetrina;
--   · leggere le proprie storie (anche le scadute) e cancellarle restano a chi le ha
--     scritte, anche se nel frattempo non è più approvato: un negozio sospeso deve
--     poter togliere le sue storie.
-- La lettura pubblica (`seller_stories_public_read`, solo le storie non scadute) non cambia.

DROP POLICY IF EXISTS seller_stories_owner_write ON public.seller_stories;

DROP POLICY IF EXISTS seller_stories_owner_read ON public.seller_stories;
CREATE POLICY seller_stories_owner_read ON public.seller_stories
  FOR SELECT TO authenticated
  USING (seller_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS seller_stories_owner_delete ON public.seller_stories;
CREATE POLICY seller_stories_owner_delete ON public.seller_stories
  FOR DELETE TO authenticated
  USING (seller_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS seller_stories_approved_seller_insert ON public.seller_stories;
CREATE POLICY seller_stories_approved_seller_insert ON public.seller_stories
  FOR INSERT TO authenticated
  WITH CHECK (
    seller_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.profiles p
       WHERE p.id = (SELECT auth.uid())
         AND p.role = 'seller'
         AND p.is_approved = true
    )
  );

DROP POLICY IF EXISTS seller_stories_approved_seller_update ON public.seller_stories;
CREATE POLICY seller_stories_approved_seller_update ON public.seller_stories
  FOR UPDATE TO authenticated
  USING (
    seller_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.profiles p
       WHERE p.id = (SELECT auth.uid())
         AND p.role = 'seller'
         AND p.is_approved = true
    )
  )
  WITH CHECK (
    seller_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.profiles p
       WHERE p.id = (SELECT auth.uid())
         AND p.role = 'seller'
         AND p.is_approved = true
    )
  );

NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- 322 — LA CLASSIFICA DEL NEGOZIO DEL MESE CONTA IL MESE DI PIACENZA (R08-025)
-- =============================================================================
-- La pagina scrive il voto con il mese di Piacenza (app/shop-of-month,
-- primoDelMesePiacenza). La vista contava invece `date_trunc('month', now())`,
-- cioè il mese nel fuso del database (UTC). Fra mezzanotte e l'una (le due con
-- l'ora legale) del primo del mese i due mesi sono diversi: il voto finiva nel
-- mese nuovo, la classifica mostrava ancora il vecchio, e la cliente leggeva
-- «Hai già votato questo mese» davanti a una classifica che non si muoveva.
--
-- Qui il mese si calcola in un posto solo, `mese_di_piacenza(istante)`, e la
-- vista lo usa sia per la colonna `month` sia per contare i voti. La funzione
-- prende l'istante come argomento perché si possa provare al confine del mese
-- senza fingere l'orologio del database.
--
-- La vista resta com'era in tutto il resto (ultima versione: migrations/048,
-- opzioni in 161, permessi in 113/152): stesse colonne, stesso ordine, stesso
-- tetto di 50. CREATE OR REPLACE tiene permessi e commento; le opzioni si
-- riscrivono qui sotto, uguali.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.mese_di_piacenza(p_quando timestamptz DEFAULT now())
RETURNS date
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT date_trunc('month', p_quando AT TIME ZONE 'Europe/Rome')::date;
$$;

COMMENT ON FUNCTION public.mese_di_piacenza(timestamptz) IS
  'Il primo giorno del mese a Piacenza per un istante (di default adesso). È il mese con cui la pagina scrive i voti del negozio del mese.';

CREATE OR REPLACE VIEW public.shop_of_month_leaderboard AS
SELECT p.id AS seller_id,
       p.store_name,
       p.store_logo,
       public.mese_di_piacenza() AS month,
       count(v.id) AS vote_count
  FROM public.profiles p
  LEFT JOIN public.shop_of_month_votes v
         ON v.seller_id = p.id AND v.month = public.mese_di_piacenza()
 WHERE p.role = 'seller' AND p.is_approved = true
 GROUP BY p.id, p.store_name, p.store_logo
 ORDER BY count(v.id) DESC, p.store_name
 LIMIT 50;

ALTER VIEW public.shop_of_month_leaderboard SET (security_invoker = off, security_barrier = true);

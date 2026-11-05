-- Una migrazione di prova: toglie una colonna senza il marcatore.
ALTER TABLE public.orders DROP COLUMN vecchia;

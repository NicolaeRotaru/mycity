-- 180_i_prodotti_non_recedibili.sql
--
-- 31/10/2026 (sesta ondata del sito) — IL NEGOZIO DICE QUALI PRODOTTI SONO
-- ESCLUSI DAL RECESSO.
--
-- Il Codice del Consumo esclude dal ripensamento i beni che si deteriorano in
-- fretta (art. 59 lett. d) e quelli fatti su ordinazione (lett. c), ma obbliga a
-- dirlo prima dell'acquisto (art. 49 c.1 lett. m). Fin qui il database non
-- aveva un modo per dirlo: la rotta dei resi accettava «Cambio idea» su
-- qualunque riga, anche sulla torta comprata ieri da Pane Quotidiano.
-- Scelta di Nicola del 31/10 (fatto legale.recesso-esclusi).
--
-- Un campo sul prodotto, che il negozio spunta nel modulo. Predefinito false:
-- nessun prodotto cambia finche' il negozio non lo segna.
--
-- Il sito regge anche PRIMA di questa migrazione: la pagina di modifica legge
-- il campo a parte (se manca, la spunta resta vuota), il modulo lo manda solo
-- se il negoziante lo cambia, e la rotta dei resi tratta la riga senza la
-- colonna come «nessun prodotto escluso». Dopo averla applicata va rigenerato
-- lib/database.types.ts.
--
-- Si annulla con: ALTER TABLE public.products DROP COLUMN non_recedibile;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS non_recedibile boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.products.non_recedibile IS
  'Escluso dal recesso (art. 59 lett. c-d Cod. Cons.): fresco che si deteriora in fretta o fatto su ordinazione. Lo segna il negozio; blocca il reso per CHANGED_MIND.';

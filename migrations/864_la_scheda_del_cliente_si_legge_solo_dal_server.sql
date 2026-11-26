-- 864 — La scheda del cliente si legge solo dal server (26/11/2026).
--
-- PERCHÉ. Dal 25/11 la scheda del cliente (schede_clienti, migrazione 708) vale solo dopo l'abbonamento, e dal
-- 26/11 dentro ci arriva anche il rapporto dell'imprenditore: prima del pagamento il titolare vede solo un
-- assaggio, e dopo solo le parti del suo abbonamento (Nicola, 26/11; lib/agenzia/rapporto.ts). Il server lo
-- rispetta (/api/seller/scheda-cliente), ma la regola della 708 lasciava a ogni negozio leggere la SUA riga
-- intera direttamente dal browser: con una riga di codice nella console un negozio in demo leggeva il rapporto
-- completo (lo ha trovato il collaudo del 26/11). Nessuna pagina del sito legge più la tabella dal browser: tutte
-- passano dal server, col service_role.
--
-- COSA FA. Toglie la regola «il negozio legge la sua» e il permesso di lettura al ruolo authenticated. Nessun
-- dato si cancella né cambia. Il server continua a leggere e scrivere come prima (service_role).
--
-- ORDINE. Dopo la 708. Si può rieseguire. NON si applica a mano: lo decide Nicola, col pulsante «Migrazioni a mano».
-- La prova tests/sql/rls/ora-del-gusto-la-scheda-e-il-link-sono-privati.test.sql dice cosa ci si aspetta.

BEGIN;

DROP POLICY IF EXISTS schede_clienti_il_negozio_legge_la_sua ON public.schede_clienti;
REVOKE ALL ON public.schede_clienti FROM anon, authenticated;
GRANT ALL ON public.schede_clienti TO service_role;

COMMENT ON TABLE public.schede_clienti IS
  'La scheda del cliente mandata da n8n (flusso 16), intera: campi con valore/stato/fonte e analisi col rapporto dell imprenditore. Legge e scrive solo il server; il negozio la vede da /api/seller/scheda-cliente, secondo il suo abbonamento (migrazioni 708 e 864).';

COMMIT;

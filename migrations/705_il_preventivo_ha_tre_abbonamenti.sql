-- 705 — Il preventivo ha tre abbonamenti (24/11/2026).
--
-- Nicola: «l'abbonamento comprende tutti i servizi ma in modi diversi, perché ci sono 3
-- abbonamenti: base 300€/mese, business 500€/mese e premium 999€/mese». I servizi
-- dell'agenzia non si vendono più uno per uno: i canoni stanno in lib/agenzia/preventivo.ts
-- (FASCE) e si possono cambiare da site_settings.agenzia.abbonamenti senza rifare il sito.
-- La vecchia chiave «prezzi» (un prezzo per servizio) da oggi il sito la ignora.
-- Cambia solo il commento della colonna: nessun dato, nessuno schema.
-- Per tornare indietro: rimettere il commento della migrazione 704.

COMMENT ON COLUMN public.site_settings.agenzia IS
  'Preventivo di MyCity coi tre abbonamenti (24/11/2026), foto e video col partner scattiDG. Esempio: {"nome": "MyCity", "abbonamenti": {"base": 30000, "business": 50000, "premium": 99900}}. Chiavi degli abbonamenti: base, business, premium. Valori in centesimi al mese: un numero = canone, null = su richiesta, chiave assente = listino di lib/agenzia/preventivo.ts. Lo 0 non vale come prezzo: si legge «su richiesta». La chiave «prezzi» (un prezzo per servizio, fino al 23/11) si ignora.';

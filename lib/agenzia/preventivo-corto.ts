import type { Abbonamento, ServizioAgenzia } from './preventivo';

/**
 * I SERVIZI IN BREVE, SOLO PER IL PREVENTIVO — 25/11/2026.
 *
 * Nicola, 18:30: «dentro il preventivo la descrizione dei servizi deve essere corta e con lo stretto
 * necessario che gli interessa». `FASCE` e `LISTINO` restano interi: li legge anche il database
 * (migrazione 711) e il flusso 19, che ne tiene una copia parola per parola. Qui c'è solo la riga
 * corta che il preventivo mostra per la fascia guardata.
 * Regola: niente quantità nuove. Ogni numero scritto qui è scritto anche in `FASCE` (lo controlla
 * tests/unit/il-preventivo-corto.test.tsx); se cambia lì, la prova diventa rossa finché non cambia qui.
 */
export const SERVIZI_IN_BREVE: Record<Abbonamento, Record<ServizioAgenzia, string>> = {
  base: {
    foto_video: 'Foto all’avvio: copertina e prodotti principali',
    sito_web: 'Un sito di una pagina col tuo nome',
    social: '8 post al mese e la scheda Google sistemata',
    analisi: 'Un’analisi completa all’avvio',
  },
  business: {
    foto_video: 'Foto ogni tre mesi e un video al mese',
    sito_web: 'Un sito completo di più pagine',
    social: '12 post e 2 video brevi al mese, risposte alle recensioni',
    analisi: 'Un’analisi nuova ogni mese',
  },
  premium: {
    foto_video: 'Foto e video nuovi ogni mese',
    sito_web: 'Un sito completo, aggiornato ogni mese',
    social: '20 post, 4 video brevi e le storie ogni mese',
    analisi: 'L’analisi ogni settimana e un incontro al mese',
  },
};

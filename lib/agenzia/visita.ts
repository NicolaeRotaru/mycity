import { scriviVisita } from './visita-sdg';

/**
 * LA FRASE DELLA VISITA DEL TEAM CREATIVO DI SDG — 27/11/2026.
 *
 * La data la sceglie il titolare quando conferma l'abbonamento (colonna visita_il di preventivi_con_codice,
 * migrazione 999b; lib/agenzia/visita-sdg.ts). Nell'ordine di SDG, nella pagina dell'agente e nell'avviso a Nicola
 * si scrive sempre così, come promesso alla sessione del calendario: «Visita: giovedì 3 dicembre alle 10:00», con
 * lo stesso `scriviVisita` che legge il titolare (ora di Piacenza, ora legale compresa); senza data «Visita: da
 * fissare col titolare». Senza dipendenze dal server: la usano anche le pagine nel browser.
 */
export function fraseVisita(visitaIl: string | null | undefined): string {
  if (!visitaIl || Number.isNaN(Date.parse(visitaIl))) return 'Visita: da fissare col titolare';
  return `Visita: ${scriviVisita(visitaIl)}`;
}

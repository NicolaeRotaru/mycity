/**
 * LA FRASE DELLA VISITA DEL TEAM CREATIVO DI SDG — 27/11/2026.
 *
 * La data la sceglie il titolare quando conferma l'abbonamento (colonna visita_il di preventivi_con_codice, migrazione
 * 999b dell'altra sessione). Nell'ordine di SDG, nella pagina dell'agente e nell'avviso a Nicola si scrive sempre così,
 * come promesso alla sessione del calendario. Senza dipendenze dal server: la usano anche le pagine nel browser.
 */
const GIORNI = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];

/**
 * La frase della visita, come promessa alla sessione del calendario: «Visita: giovedì 3 dicembre alle 10:00»
 * (ora di Roma); se la data non c'è, «Visita: da fissare col titolare».
 */
export function fraseVisita(visitaIl: string | null | undefined): string {
  if (!visitaIl || Number.isNaN(Date.parse(visitaIl))) return 'Visita: da fissare col titolare';
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date(visitaIl)).map((x) => [x.type, x.value]),
  );
  const giorno = new Date(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day)));
  return `Visita: ${GIORNI[giorno.getUTCDay()]} ${Number(p.day)} ${MESI[Number(p.month) - 1]} alle ${p.hour}:${p.minute}`;
}

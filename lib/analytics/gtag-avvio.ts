/**
 * LO SCRIPT CHE APRE LA CODA VERSO GOOGLE ANALYTICS — e la apre nell'ordine giusto.
 *
 * 27/8/2026 (R172) — Google Analytics non è un indirizzo a cui si spedisce: è una coda
 * (`dataLayer`) che la libreria svuota IN ORDINE quando finalmente arriva. Un `event` accodato
 * prima del `config` della proprietà non ha una destinazione: si perde e basta.
 *
 * Prima `gtag('js')` e `gtag('config')` stavano in un secondo script, montato solo nell'istante in
 * cui la persona accetta i cookie e con la strategia «dopo che la pagina è interattiva» — mentre la
 * pagina vista veniva accodata nello stesso giro di disegno, quindi PRIMA. Si perdeva la pagina
 * d'ingresso, quella che dice da dove arriva il traffico, proprio per chi accetta: l'unico gruppo
 * che GA4 può misurare.
 *
 * Adesso la configurazione sta qui, nello stesso script che definisce `gtag` e che gira per primo.
 * Non cambia niente per la privacy: la libreria vera (`gtag/js`) continua a essere caricata SOLO
 * dopo il consenso, e finché non arriva questa coda resta una lista di intenzioni che nessuno
 * spedisce. Il consenso parte negato, come prima.
 */
export function scriptDiAvvioGtag(gaId: string): string {
  return `
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    window.gtag = gtag;
    gtag('consent', 'default', {
      analytics_storage: 'denied',
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
      wait_for_update: 500
    });
    gtag('js', new Date());
    gtag('config', '${gaId}', {
      anonymize_ip: true,
      send_page_view: false
    });
  `;
}

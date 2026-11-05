/**
 * Le parole delle segnalazioni, per chi le legge (5/11/2026).
 *
 * I testi degli avvisi stampavano i codici del database («proprieta_intellettuale»,
 * «odio_o_molestie») e «Segnalato un recensione». Qui le etichette leggibili e
 * l'articolo giusto, e il paragrafo su come si contesta una decisione (regolamento
 * europeo sui servizi digitali, art. 17.3: misura, base, vie di ricorso).
 * 🟢 Puro: nessuna rete.
 */

const MOTIVI: Record<string, string> = {
  contraffatto: 'prodotto contraffatto',
  illecito: 'contenuto illecito',
  pericoloso: 'prodotto pericoloso',
  ingannevole: 'informazioni ingannevoli',
  proprieta_intellettuale: 'violazione di marchio o diritto d’autore',
  odio_o_molestie: 'odio o molestie',
  altro: 'altro motivo',
};

const OGGETTI: Record<string, string> = {
  prodotto: 'un prodotto',
  negozio: 'un negozio',
  recensione: 'una recensione',
  messaggio: 'un messaggio',
};

export function motivoLeggibile(motivo: string): string {
  return MOTIVI[motivo] ?? motivo.replace(/_/g, ' ');
}

export function oggettoConArticolo(tipo: string): string {
  return OGGETTI[tipo] ?? tipo;
}

/** Come si contesta la decisione: lo stesso paragrafo per chi ha segnalato e per il venditore. */
export const COME_CONTESTARE =
  'Se non sei d’accordo con la decisione puoi contestarla gratuitamente scrivendoci dalla pagina /contact ' +
  'entro sei mesi: la riesamina una persona diversa da chi ha deciso. Resta sempre possibile rivolgersi al giudice. ' +
  'La decisione è presa in base ai Termini di servizio (/terms) e alla legge applicabile.';

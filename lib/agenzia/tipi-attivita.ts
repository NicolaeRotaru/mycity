/**
 * CHE ATTIVITÀ HAI — i tipi di attività che possono iscriversi a MyCity.
 *
 * 22/11/2026 — Nicola: «quando l'imprenditore si iscrive, non è più obbligatorio
 * essere per forza una bottega». Fino a oggi il modulo di iscrizione dava per
 * scontato un negozio. Adesso entra chiunque venda qualcosa: bar, ristoranti,
 * artigiani, servizi alla persona. Nicola, 22/11: «sì, dentro tutti» — anche i
 * ristoranti, che dal 16/7 erano esclusi.
 *
 * Questo elenco è UNO solo: lo leggono il modulo (la scelta), il server (che
 * rifiuta un valore fuori elenco) e il database (il vincolo della migrazione
 * 703 ripete gli stessi codici). Se si aggiunge un tipo, si aggiunge qui E
 * nella migrazione: il test `ogni-attivita-puo-iscriversi` lo controlla.
 */

export const TIPI_ATTIVITA = ['negozio', 'bar', 'ristorante', 'artigiano', 'servizi', 'altro'] as const;

export type TipoAttivita = (typeof TIPI_ATTIVITA)[number];

type Scheda = {
  /** Quello che il negoziante legge sulla scelta. */
  etichetta: string;
  /** Esempi sotto l'etichetta, per riconoscersi al primo colpo. */
  esempi: string;
  /** Come si chiama il posto nelle frasi del modulo, con l'articolo: «il locale». */
  il: string;
  /** Lo stesso con «di»: «il logo del locale». */
  del: string;
};

export const SCHEDE_ATTIVITA: Record<TipoAttivita, Scheda> = {
  negozio:    { etichetta: 'Negozio o bottega',       esempi: 'Alimentari, abbigliamento, fiori, casa…',    il: 'il negozio',      del: 'del negozio' },
  bar:        { etichetta: 'Bar o caffetteria',       esempi: 'Colazioni, aperitivi, pasticceria…',         il: 'il locale',       del: 'del locale' },
  ristorante: { etichetta: 'Ristorante o pizzeria',   esempi: 'Piatti da asporto, gastronomia, pizzeria…', il: 'il locale',       del: 'del locale' },
  artigiano:  { etichetta: 'Artigiano o laboratorio', esempi: 'Pasta fresca, ceramica, sartoria…',          il: 'il laboratorio',  del: 'del laboratorio' },
  servizi:    { etichetta: 'Servizi alla persona',    esempi: 'Parrucchiere, estetista, ottico…',           il: 'l\u2019attività', del: 'dell\u2019attività' },
  altro:      { etichetta: 'Un’altra attività',  esempi: 'Scrivi tu che cosa fai',                      il: 'l\u2019attività', del: 'dell\u2019attività' },
};

/** Il massimo di caratteri per la descrizione libera di «altro». */
export const MAX_DETTAGLIO_ATTIVITA = 60;

/**
 * Il tipo letto dal profilo. Un profilo iscritto prima del 22/11 non ha il
 * campo: era per forza un negozio, e così si legge.
 */
export function tipoDelProfilo(valore: unknown): TipoAttivita {
  return (TIPI_ATTIVITA as readonly string[]).includes(String(valore)) ? (valore as TipoAttivita) : 'negozio';
}

/** «bar o caffetteria», oppure, per «altro», le parole del negoziante. Per avvisi e pannelli. */
export function descriviAttivita(tipo: TipoAttivita, dettaglio?: string | null): string {
  const parole = (dettaglio ?? '').trim();
  if (tipo === 'altro') return parole || 'altra attività';
  return SCHEDE_ATTIVITA[tipo].etichetta.toLowerCase();
}

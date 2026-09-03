/**
 * I conti della pagina «Guadagni» del negoziante (#60).
 *
 * Stessa ragione dell'altro file: sono i soldi di una persona e vanno provati
 * fuori dal componente. Cosa era sbagliato:
 *  · l'incassato sommava `seller_payout_cents` senza togliere
 *    `seller_payout_reversed_cents` — la colonna dove si accumula quello che
 *    è tornato indietro dopo un rimborso o una contestazione. Un ordine
 *    parzialmente stornato resta 'TRANSFERRED', quindi entrava per intero;
 *  · il lordo non toglieva i rimborsi parziali;
 *  · gli ordini in 'PROCESSING' — bonifico partito, conferma non ancora
 *    arrivata — sparivano da entrambe le colonne.
 *
 * Il risultato era un incassato più alto di quello arrivato sull'IBAN: la
 * telefonata «dove sono i miei soldi», che sul payout erode la fiducia più di
 * qualunque altra cosa.
 *
 * 3/9/2026 — IL LORDO AL NETTO DEI RIMBORSI ERA SCRITTO QUI, E SOLO QUI.
 * Il cruscotto e la pagina Andamento avevano la loro formula, cieca sui
 * rimborsi: due strade per lo stesso numero, e quella «certificata» era quella
 * sbagliata. Adesso il conto di quanto è entrato su un ordine sta in un posto
 * solo — `incassatoDellOrdineCents` in lib/metriche-venditore — e questa pagina
 * lo chiama come le altre.
 */
import { incassatoDellOrdineCents } from '@/lib/metriche-venditore';

export type OrdineNegozio = {
  total_price: number;
  payment_method: string | null;
  payout_status: string | null;
  seller_payout_cents: number | null;
  seller_payout_reversed_cents: number | null;
  refunded_amount_cents: number | null;
  application_fee_cents: number | null;
};

export type RiepilogoNegozio = {
  /** Fatturato lordo sugli ordini con carta, al netto dei rimborsi, in centesimi. */
  lordoCents: number;
  /** Commissione marketplace trattenuta. */
  commissioniCents: number;
  /** Già versato sull'IBAN. */
  versatiCents: number;
  /** In attesa di liquidazione (trattenuti + bonifici in corso). */
  inArrivoCents: number;
  /** Tornato indietro per rimborsi o contestazioni. */
  stornatiCents: number;
};

/** Quanto resta davvero al negozio su un ordine: il netto meno gli storni. */
export function nettoDopoStorni(o: OrdineNegozio): number {
  return Math.max(0, (o.seller_payout_cents ?? 0) - (o.seller_payout_reversed_cents ?? 0));
}

/**
 * 22/8/2026 — I BONIFICI DEL CONTRASSEGNO NON SI VEDEVANO DA NESSUNA PARTE.
 *
 * Qui gli ordini in contanti venivano scartati alla prima riga, tutti. Ma il
 * contrassegno non finisce nel contante e basta: quando il fattorino porta la
 * cassa e un responsabile la conferma, parte un bonifico vero al negozio, con
 * lo stesso `payout_status` degli altri. Scartandoli, quei bonifici non
 * comparivano ne' fra i versati ne' fra quelli in arrivo: il negoziante li
 * riceveva sull'IBAN senza trovarli scritti da nessuna parte.
 *
 * E il contrassegno e' il modo di pagare normale del cliente di Piacenza:
 * e' la maggioranza degli incassi, non un caso di bordo.
 *
 * Restano fuori — giustamente — gli ordini fermi al contante puro
 * (`CASH_IN_STORE`, `AWAITING_REMITTANCE`): li' un bonifico non e' ancora
 * partito, e metterli fra i versati sarebbe la stessa bugia al contrario.
 */
const STATI_CON_BONIFICO = ['TRANSFERRED', 'HELD', 'PENDING_SELLER_ONBOARDING', 'PROCESSING'];

export function riepilogoNegozio(ordini: OrdineNegozio[]): RiepilogoNegozio {
  const conCarta = ordini.filter((o) => o.payment_method !== 'cod');
  const attivi = conCarta.filter(
    (o) => o.payout_status !== 'REFUNDED' && o.payout_status !== 'REVERSED',
  );

  // Per i bonifici si guardano tutti gli ordini, contrassegno compreso: quello
  // che conta e' se un bonifico e' partito, non con che cosa ha pagato il cliente.
  const conBonifico = ordini.filter((o) => STATI_CON_BONIFICO.includes(o.payout_status ?? ''));
  const somma = (righe: OrdineNegozio[]) => righe.reduce((s, o) => s + nettoDopoStorni(o), 0);

  return {
    lordoCents: attivi.reduce((s, o) => s + incassatoDellOrdineCents(o), 0),
    commissioniCents: attivi.reduce((s, o) => s + (o.application_fee_cents ?? 0), 0),
    versatiCents: somma(conBonifico.filter((o) => o.payout_status === 'TRANSFERRED')),
    inArrivoCents: somma(
      conBonifico.filter((o) =>
        ['HELD', 'PENDING_SELLER_ONBOARDING', 'PROCESSING'].includes(o.payout_status ?? ''),
      ),
    ),
    stornatiCents: ordini.reduce((s, o) => s + (o.seller_payout_reversed_cents ?? 0), 0),
  };
}

/** Cosa mostrare nel riquadro «Contanti» della pagina Guadagni. */
export type RiepilogoContanti = {
  /** Il contante materiale che il cliente ha dato al fattorino. */
  incassatoDalFattorinoCents: number;
  /** Quello che arrivera' davvero sull'IBAN: il netto, meno gli storni. */
  nettoAlNegozioCents: number;
  /** Quanto di quel netto e' gia' stato versato. */
  giaVersatoCents: number;
};

/**
 * Il contante che il cliente consegna e il netto che arriva al negozio sono due
 * numeri diversi, e la pagina mostrava il primo chiamandolo col nome del
 * secondo. Dentro il contante ci sono la consegna, la spedizione e la
 * commissione: soldi che al negozio non arrivano. Qui si separano.
 */
export function riepilogoContanti(ordini: OrdineNegozio[], consegnato: (o: OrdineNegozio) => boolean): RiepilogoContanti {
  const contanti = ordini.filter((o) => o.payment_method === 'cod' && consegnato(o));
  return {
    incassatoDalFattorinoCents: contanti.reduce((s, o) => s + Math.round(Number(o.total_price || 0) * 100), 0),
    nettoAlNegozioCents: contanti.reduce((s, o) => s + nettoDopoStorni(o), 0),
    giaVersatoCents: contanti
      .filter((o) => o.payout_status === 'TRANSFERRED')
      .reduce((s, o) => s + nettoDopoStorni(o), 0),
  };
}

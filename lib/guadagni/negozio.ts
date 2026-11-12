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
  /** Ritiro in negozio: col contante il cliente paga al banco, non al fattorino. */
  pickup_in_store?: boolean | null;
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
const STATI_CON_BONIFICO = ['TRANSFERRED', 'PAID_MANUALLY', 'HELD', 'PENDING_SELLER_ONBOARDING', 'PROCESSING'];

/**
 * R11-004 — IL BONIFICO DEL LUNEDÌ FATTO A MANO È UN BONIFICO VERSATO.
 *
 * Al lancio i contanti li versa Nicola a mano, ogni lunedì: l'ordine passa da
 * HELD a PAID_MANUALLY (migrazione 350, `segna_bonifico_manuale`). Prima non
 * esisteva nessuno stato per quel bonifico: restava HELD, e il negozio leggeva
 * «0,00 € già versati» con l'«in arrivo» che cresceva ogni settimana.
 */
export const STATI_VERSATI = ['TRANSFERRED', 'PAID_MANUALLY'];

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
    versatiCents: somma(conBonifico.filter((o) => STATI_VERSATI.includes(o.payout_status ?? ''))),
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
  /** R11-005 — Il contante che il negozio ha gia' in cassa: ritiri pagati al banco. */
  incassatoAlBancoCents: number;
  /** R11-005 — La commissione MyCity su quei ritiri: la deve il negozio, si scala dal bonifico del lunedi'. */
  commissioneDovutaCents: number;
};

/**
 * R11-005 — Il ritiro in negozio pagato al banco non passa dal fattorino e non
 * fa partire nessun bonifico: il negozio ha gia' tutto in cassa (stato
 * CASH_IN_STORE, migrazione 179). Contarlo fra il netto «che arriva a te» e il
 * «contante raccolto dal fattorino» era il contrario del vero: il negozio
 * aspettava 18 € che non arrivano, invece di sapere che ne deve 2.
 */
function pagatoAlBanco(o: OrdineNegozio): boolean {
  return o.payout_status === 'CASH_IN_STORE' || o.pickup_in_store === true;
}

/**
 * Il contante che il cliente consegna e il netto che arriva al negozio sono due
 * numeri diversi, e la pagina mostrava il primo chiamandolo col nome del
 * secondo. Dentro il contante ci sono la consegna, la spedizione e la
 * commissione: soldi che al negozio non arrivano. Qui si separano.
 */
export function riepilogoContanti(ordini: OrdineNegozio[], consegnato: (o: OrdineNegozio) => boolean): RiepilogoContanti {
  const tutti = ordini.filter((o) => o.payment_method === 'cod' && consegnato(o));
  const alBanco = tutti.filter(pagatoAlBanco);
  const contanti = tutti.filter((o) => !pagatoAlBanco(o));
  return {
    incassatoAlBancoCents: alBanco.reduce((s, o) => s + Math.round(Number(o.total_price || 0) * 100), 0),
    commissioneDovutaCents: alBanco.reduce((s, o) => s + (o.application_fee_cents ?? 0), 0),
    incassatoDalFattorinoCents: contanti.reduce((s, o) => s + Math.round(Number(o.total_price || 0) * 100), 0),
    nettoAlNegozioCents: contanti.reduce((s, o) => s + nettoDopoStorni(o), 0),
    giaVersatoCents: contanti
      .filter((o) => STATI_VERSATI.includes(o.payout_status ?? ''))
      .reduce((s, o) => s + nettoDopoStorni(o), 0),
  };
}

/**
 * R11-001 — IL PANNELLO DEI BONIFICI DICE QUANTO VERSARE A OGNI NEGOZIO IL LUNEDÌ.
 *
 * Al lancio Nicola versa a mano i contanti, ogni lunedì, per le consegne della
 * settimana prima (registro dei fatti: pagamenti.bonifico-contanti-al-negozio).
 * /admin/payouts dava numeri sbagliati per questo lavoro:
 *  · AWAITING_REMITTANCE (contanti ancora in mano al fattorino), REVERSAL_FAILED
 *    e CASH_IN_STORE (ritiro pagato al banco) cadevano nel ramo «Pronto» e
 *    finivano nei «Da pagare»;
 *  · i contanti con la rimessa confermata (HELD), cioe' proprio quelli da
 *    versare, stavano negli «In sospeso»;
 *  · gli importi erano il netto pieno, senza togliere gli storni.
 * Qui c'e' la regola, provata fuori dalla pagina.
 */
export type GruppoDelPannello = 'da_versare' | 'in_sospeso' | 'pagato' | 'fuori';

export type OrdineDelPannello = {
  payment_method: string | null;
  payout_status: string | null;
  seller_payout_cents: number | null;
  seller_payout_reversed_cents?: number | null;
  delivered_at?: string | null;
  dispute_status?: string | null;
  internal_dispute_status?: string | null;
  payment_status?: string | null;
  /** Collaudo K04 — c'è un reso o un reclamo aperto nelle tabelle (la pagina lo legge a parte). */
  pratica_aperta?: boolean;
};

/**
 * Gli stessi cancelli del giro automatico e della funzione 350: contestazione in banca, reclamo
 * sull'ordine, rimborso pieno, e reso o reclamo aperto nelle loro tabelle. Il totale mostrato e gli
 * ordini che «Bonifico fatto» segna devono essere lo stesso insieme.
 */
function fermoPerReclamo(o: OrdineDelPannello): boolean {
  return (
    o.pratica_aperta === true ||
    (!!o.dispute_status && o.dispute_status !== 'WON') ||
    (!!o.internal_dispute_status && o.internal_dispute_status !== 'RESOLVED') ||
    o.payment_status === 'REFUNDED'
  );
}

export function gruppoDelPannello(o: OrdineDelPannello): { gruppo: GruppoDelPannello; etichetta: string } {
  const contanti = o.payment_method === 'cod';
  switch (o.payout_status) {
    case 'TRANSFERRED':
      return { gruppo: 'pagato', etichetta: 'Pagato' };
    case 'PAID_MANUALLY':
      return { gruppo: 'pagato', etichetta: 'Bonifico fatto' };
    case 'HELD':
      // Contanti con la rimessa confermata: li versa Nicola a mano. Carta: li paga il giro.
      if (contanti && fermoPerReclamo(o)) return { gruppo: 'in_sospeso', etichetta: 'Fermo: reclamo o contestazione' };
      return contanti ? { gruppo: 'da_versare', etichetta: 'Da versare' } : { gruppo: 'in_sospeso', etichetta: 'In sospeso' };
    case 'PENDING_SELLER_ONBOARDING':
    case 'PROCESSING':
      return { gruppo: 'in_sospeso', etichetta: 'In sospeso' };
    case 'AWAITING_REMITTANCE':
      return { gruppo: 'in_sospeso', etichetta: 'Contanti dal fattorino' };
    case 'FAILED':
      return { gruppo: 'in_sospeso', etichetta: 'Verifica IBAN' };
    case 'CASH_IN_STORE':
      return { gruppo: 'fuori', etichetta: 'Incassato al banco' };
    case 'REVERSAL_FAILED':
      return { gruppo: 'fuori', etichetta: 'Storno non riuscito' };
    case 'REVERSED':
      return { gruppo: 'fuori', etichetta: 'Stornato' };
    case 'REFUNDED':
      return { gruppo: 'fuori', etichetta: 'Rimborsato' };
    default:
      // Consegnato con la carta, netto calcolato, il giro non l'ha ancora preso.
      return contanti ? { gruppo: 'in_sospeso', etichetta: 'In sospeso' } : { gruppo: 'in_sospeso', etichetta: 'In attesa del giro' };
  }
}

/** Il lunedì e la domenica (AAAA-MM-GG, ora di Piacenza) della settimana prima di `adesso`. */
export function settimanaPrima(adesso: Date): { dal: string; al: string } {
  const oggi = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(adesso);
  const giorno = new Date(`${oggi}T12:00:00Z`);
  const daLunedi = (giorno.getUTCDay() + 6) % 7;
  const lunediQuesto = new Date(giorno.getTime() - daLunedi * 86_400_000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { dal: iso(new Date(lunediQuesto.getTime() - 7 * 86_400_000)), al: iso(new Date(lunediQuesto.getTime() - 86_400_000)) };
}

/** I contanti da versare il lunedì: HELD consegnati entro la domenica scorsa (arretrati compresi). */
export function ordiniDaVersareLunedi<T extends OrdineDelPannello>(ordini: T[], adesso: Date): T[] {
  const { al } = settimanaPrima(adesso);
  const giornoDi = (iso: string) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
  return ordini.filter(
    (o) => gruppoDelPannello(o).gruppo === 'da_versare' && !!o.delivered_at && giornoDi(o.delivered_at) <= al,
  );
}

/** Quanto versare il lunedì, al netto degli storni. */
export function daVersareLunedi(ordini: OrdineDelPannello[], adesso: Date): { cents: number; ordini: number } {
  const righe = ordiniDaVersareLunedi(ordini, adesso);
  return { cents: righe.reduce((s, o) => s + nettoDopoStorni(o as OrdineNegozio), 0), ordini: righe.length };
}

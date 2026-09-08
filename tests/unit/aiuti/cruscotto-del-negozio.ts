/**
 * L'UNICA COPIA DEI NUMERI FINTI DEL CRUSCOTTO DEL NEGOZIO.
 *
 * ── Il difetto che ha prodotto questo file ───────────────────────────────────
 * Sette prove montano `app/seller/dashboard/page.tsx`, e ognuna si scriveva a
 * mano la risposta finta della lettura `['seller','stats']`. Sette copie della
 * stessa forma, nessuna legata all'altra.
 *
 * L'8/9/2026 le quattro targhette in cima sono passate da numero grezzo a
 * oggetto già deciso (`{valore, nota, guasto}`, deciso in `lib/letture-cruscotto`).
 * Quattro copie sono state aggiornate, tre no — e quelle tre hanno fermato la
 * consegna: `Cannot read properties of undefined (reading 'guasto')`, otto prove
 * rosse su una modifica che il prodotto ce l'aveva giusto. Il negoziante non
 * avrebbe visto niente di rotto: era rotta solo la copia finta.
 *
 * ── La regola ────────────────────────────────────────────────────────────────
 * I numeri finti si costruiscono CHIAMANDO le funzioni vere. Qui dentro nessuna
 * targhetta è scritta a mano: `targhettaNetto`, `targhettaProdotti`,
 * `targhettaValutazione` e `targhettaArticoli` sono le stesse che gira la pagina.
 * Chi prova dichiara i dati grezzi — quante recensioni, quanti prodotti, se la
 * lettura è riuscita — e la forma la decide il codice di produzione.
 *
 * QUELLO CHE QUESTO FILE NON PUÒ FARE: la risposta finta entra nella pagina da
 * `globalThis`, che non ha tipo. Se domani la pagina rinomina `stats.prodotti`,
 * il controllo dei tipi non se ne accorge — se ne accorgono le prove che montano
 * la pagina, a schermo, com'è successo stavolta. Quello che questo file toglie è
 * il caso peggiore: sette copie da aggiornare a mano, e tre dimenticate.
 */

import {
  targhettaArticoli, targhettaNetto, targhettaProdotti, targhettaValutazione,
  type Targhetta,
} from '@/lib/letture-cruscotto';
import type { FinestraTotali } from '@/lib/metriche-venditore';

/** I dati grezzi da cui nascono le quattro targhette, come li legge la pagina. */
export interface DatiGrezziDelCruscotto {
  netto: { netto: string; incassato: string; finestra: FinestraTotali };
  prodotti: { letta: boolean; disponibili: number; totali: number };
  valutazione: { letta: boolean; media: number; quante: number };
  articoli: { letta: boolean; quanti: number; troncato: boolean };
}

/** Un negozio che sta andando bene: il caso normale, da cui partono tutte le prove. */
const GREZZI: DatiGrezziDelCruscotto = {
  netto: { netto: '€3.180,25', incassato: '€4.210,50', finestra: 'ultimi-30-giorni' },
  prodotti: { letta: true, disponibili: 21, totali: 24 },
  valutazione: { letta: true, media: 4.6, quante: 12 },
  articoli: { letta: true, quanti: 137, troncato: false },
};

/** I numeri sotto le targhette: quelli che riempiono la fascia dei guadagni. */
const FASCIA = {
  revenueToday: 234.56, revenue7: 1234.56, revenue30: 4321.99,
  ordiniOggi: 4, ordini7: 21, ordini30: 88,
};

/** Cosa una prova può cambiare: i dati grezzi, non la forma delle targhette. */
export type ScostamentiDelCruscotto = {
  [K in keyof DatiGrezziDelCruscotto]?: Partial<DatiGrezziDelCruscotto[K]>;
} & Partial<typeof FASCIA> & {
  avviso?: { titolo: string; dettaglio: string } | null;
};

/** La forma che la pagina si aspetta di leggere da `['seller','stats']`. */
export interface StatisticheDelCruscotto {
  availableCount: number | null;
  reviewCount: number | null;
  netto: Targhetta;
  prodotti: Targhetta;
  valutazione: Targhetta;
  articoli: Targhetta;
  avviso: { titolo: string; dettaglio: string } | null;
  revenueToday: number;
  revenue7: number;
  revenue30: number;
  ordiniOggi: number;
  ordini7: number;
  ordini30: number;
}

/**
 * La risposta finta della lettura del cruscotto, costruita come la costruisce la
 * pagina: chiamando le quattro funzioni vere.
 */
export function statisticheDelCruscotto(
  scostamenti: ScostamentiDelCruscotto = {},
): StatisticheDelCruscotto {
  const { netto, prodotti, valutazione, articoli, avviso, ...fascia } = scostamenti;
  const g: DatiGrezziDelCruscotto = {
    netto: { ...GREZZI.netto, ...netto },
    prodotti: { ...GREZZI.prodotti, ...prodotti },
    valutazione: { ...GREZZI.valutazione, ...valutazione },
    articoli: { ...GREZZI.articoli, ...articoli },
  };
  return {
    // `null` vuol dire «non l'ho letto», e la pagina non lo scambia per zero.
    availableCount: g.prodotti.letta ? g.prodotti.disponibili : null,
    reviewCount: g.valutazione.letta ? g.valutazione.quante : null,
    netto: targhettaNetto(g.netto),
    prodotti: targhettaProdotti(g.prodotti),
    valutazione: targhettaValutazione(g.valutazione),
    articoli: targhettaArticoli(g.articoli),
    avviso: avviso ?? null,
    ...FASCIA,
    ...fascia,
  };
}

/** Il negozio finto che apre il cruscotto: profilo di venditore e lettura pronta. */
export function apriIlCruscotto(
  statistiche: StatisticheDelCruscotto = statisticheDelCruscotto(),
): void {
  (globalThis as Record<string, unknown>).__PROFILO__ = {
    isSeller: true,
    profile: { id: 'negozio-1', store_name: 'Pane Quotidiano' },
  };
  (globalThis as Record<string, unknown>).__DATI_QUERY__ = (o: { queryKey?: readonly unknown[] }) =>
    Array.isArray(o?.queryKey) && o.queryKey[0] === 'seller' && o.queryKey[1] === 'stats'
      ? statistiche
      : undefined;
}

/** Si rimette tutto com'era: una lettura finta lasciata in giro sporca la prova dopo. */
export function chiudiIlCruscotto(): void {
  document.body.innerHTML = '';
  delete (globalThis as Record<string, unknown>).__DATI_QUERY__;
  delete (globalThis as Record<string, unknown>).__PROFILO__;
}

/**
 * COSA RISPONDE LA ROTTA DEGLI ORDINI IN CONTANTI, LETTO IN UN POSTO SOLO.
 *
 * ── Il difetto che ha prodotto questo file ──────────────────────────────────
 * La rotta risponde con l'involucro del progetto — `{ ok: true, data: { orderIds,
 * ordini } }` — tranne nel ramo «invio ripetuto», che risponde ancora con
 * l'oggetto nudo. In cassa erano due letture scritte a mano: gli identificativi
 * erano stati spostati dentro `data`, l'elenco degli ordini no. Su ogni ordine
 * nuovo quell'elenco era vuoto, il giro che manda l'acquisto a Google Analytics
 * non partiva mai, e nel cruscotto su cui si guarda il ritorno delle campagne
 * ogni ordine pagato alla consegna valeva zero. È la strada di pagamento
 * principale di MyCity: si rischia di spegnere una campagna che funziona.
 *
 * ── La regola ───────────────────────────────────────────────────────────────
 * Una lettura sola, che conosce tutte e due le forme. Quando il ramo «ripetuto»
 * passerà all'involucro, qui non cambia niente e in cassa nemmeno.
 */

export type OrdineCreatoCod = { id: string; sellerId: string; totalCents: number };

export type RispostaOrdiniCod = {
  /** Gli identificativi degli ordini nati (o già esistenti, se l'invio è ripetuto). */
  orderIds: string[];
  /** Gli ordini con negozio e importo: è quello che serve per contare l'acquisto. */
  ordini: OrdineCreatoCod[];
};

type Forma = {
  data?: { orderIds?: unknown; ordini?: unknown } | null;
  orderIds?: unknown;
  ordini?: unknown;
};

function soloStringhe(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

function soloOrdini(v: unknown): OrdineCreatoCod[] {
  if (!Array.isArray(v)) return [];
  return v.filter(
    (o): o is OrdineCreatoCod =>
      !!o && typeof o === 'object' &&
      typeof (o as OrdineCreatoCod).id === 'string' &&
      typeof (o as OrdineCreatoCod).totalCents === 'number',
  );
}

export function leggiOrdiniCod(corpo: unknown): RispostaOrdiniCod {
  if (!corpo || typeof corpo !== 'object') return { orderIds: [], ordini: [] };
  const c = corpo as Forma;
  return {
    orderIds: soloStringhe(c.data?.orderIds ?? c.orderIds),
    ordini: soloOrdini(c.data?.ordini ?? c.ordini),
  };
}

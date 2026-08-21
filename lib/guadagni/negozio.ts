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
 */
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

export function riepilogoNegozio(ordini: OrdineNegozio[]): RiepilogoNegozio {
  const conCarta = ordini.filter((o) => o.payment_method !== 'cod');
  const attivi = conCarta.filter(
    (o) => o.payout_status !== 'REFUNDED' && o.payout_status !== 'REVERSED',
  );

  const somma = (righe: OrdineNegozio[]) => righe.reduce((s, o) => s + nettoDopoStorni(o), 0);

  return {
    lordoCents: attivi.reduce(
      (s, o) => s + Math.max(0, Math.round(Number(o.total_price) * 100) - (o.refunded_amount_cents ?? 0)),
      0,
    ),
    commissioniCents: attivi.reduce((s, o) => s + (o.application_fee_cents ?? 0), 0),
    versatiCents: somma(conCarta.filter((o) => o.payout_status === 'TRANSFERRED')),
    inArrivoCents: somma(
      conCarta.filter((o) =>
        ['HELD', 'PENDING_SELLER_ONBOARDING', 'PROCESSING'].includes(o.payout_status ?? ''),
      ),
    ),
    stornatiCents: conCarta.reduce((s, o) => s + (o.seller_payout_reversed_cents ?? 0), 0),
  };
}

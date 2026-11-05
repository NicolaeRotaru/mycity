import { compensoConsegnaEuro, compensoDalContante } from '@/lib/shipping';

/**
 * I conti della pagina «Guadagni» del fattorino (#163).
 *
 * Stanno qui e non dentro la pagina per una ragione precisa: sono numeri sui
 * soldi di una persona, e vanno provati. Dentro un componente React di questo
 * progetto non si possono provare — le prove unitarie girano senza browser —
 * quindi il conto viveva senza nessun controllo, e infatti era sbagliato.
 *
 * Cosa era sbagliato: sommava `shipping_cost`, cioè quanto ha pagato il
 * CLIENTE per la spedizione, mentre il bonifico è di `rider_fee_cents`. Sopra
 * i 30 euro di spesa la spedizione è gratis e quella cifra vale zero, quindi
 * la consegna compariva a 0,00 € e usciva dal totale. E le consegne in
 * contanti entravano nel «guadagnato» pur non essendo pagate da nessuna
 * funzione, senza comparire né fra i versati né fra quelli in arrivo.
 */
export type ConsegnaPagata = {
  rider_fee_cents: number | null;
  shipping_cost: number | null;
  rider_payout_status: string | null;
  payment_method: string | null;
  /** Il contante che il cliente ha messo in mano (dopo il credito MyCity). */
  total_price?: number | string | null;
};

export type RiepilogoFattorino = {
  /** Tutto quello che ha guadagnato nel periodo, in euro. */
  totale: number;
  /** Media per consegna. */
  media: number;
  /** Già arrivati sul conto. */
  versati: number;
  /** In arrivo sul conto: consegne con carta non ancora bonificate. */
  inArrivo: number;
  /** Tenuti in contanti alla consegna: nessun bonifico da aspettare. */
  inContanti: number;
};

export function riepilogoFattorino(consegne: ConsegnaPagata[]): RiepilogoFattorino {
  const somma = (righe: ConsegnaPagata[]) =>
    righe.reduce((s, o) => s + compensoConsegnaEuro(o), 0);

  /**
   * 5/11/2026 — SUL CONTRASSEGNO IL COMPENSO SI DIVIDE IN DUE.
   * Quando il credito MyCity porta il contante sotto il compenso, il fattorino
   * se ne tiene solo una parte e il resto gli arriva col bonifico (e l'ordine
   * diventa TRANSFERRED). Prima la pagina contava il compenso intero due volte:
   * fra i «versati» e fra i «tenuti in contanti». Ora: in contanti il
   * trattenuto, versato o in arrivo il residuo. Senza total_price letto si
   * resta alla regola di prima (tutto in contanti).
   */
  const quoteContanti = (o: ConsegnaPagata) => {
    const compenso = compensoConsegnaEuro(o);
    if (o.total_price === undefined || o.total_price === null) return { trattenuto: compenso, residuo: 0 };
    const { trattenutoCents } = compensoDalContante({ ...o, total_price: o.total_price });
    const trattenuto = Math.min(compenso, trattenutoCents / 100);
    return { trattenuto, residuo: Math.max(0, compenso - trattenuto) };
  };

  const totale = somma(consegne);
  let versati = 0;
  let inArrivo = 0;
  let inContanti = 0;
  for (const o of consegne) {
    if (o.payment_method === 'cod') {
      const { trattenuto, residuo } = quoteContanti(o);
      inContanti += trattenuto;
      if (o.rider_payout_status === 'TRANSFERRED') versati += residuo;
      else inArrivo += residuo;
    } else {
      const compenso = compensoConsegnaEuro(o);
      if (o.rider_payout_status === 'TRANSFERRED') versati += compenso;
      else if (o.payment_method === 'card') inArrivo += compenso;
    }
  }
  return {
    totale,
    media: consegne.length > 0 ? totale / consegne.length : 0,
    versati,
    inArrivo,
    inContanti,
  };
}

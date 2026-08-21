import { compensoConsegnaEuro } from '@/lib/shipping';

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

  const totale = somma(consegne);
  return {
    totale,
    media: consegne.length > 0 ? totale / consegne.length : 0,
    versati: somma(consegne.filter((o) => o.rider_payout_status === 'TRANSFERRED')),
    inArrivo: somma(
      consegne.filter((o) => o.payment_method === 'card' && o.rider_payout_status !== 'TRANSFERRED'),
    ),
    inContanti: somma(consegne.filter((o) => o.payment_method === 'cod')),
  };
}

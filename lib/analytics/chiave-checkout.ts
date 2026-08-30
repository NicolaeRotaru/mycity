/**
 * LA CHIAVE CHE TIENE INSIEME I DUE CAPI DEL FUNNEL DEL CHECKOUT.
 *
 * 30/8/2026 (R163) — «ARRIVA ALLA CASSA → PAGA» POTEVA SUPERARE IL 100%.
 *
 * I due passi si contavano con due unità di misura diverse:
 *
 *  · `checkout_started` partiva UNA volta per carrello, e non portava nessun
 *    identificativo — solo totale e numero di articoli;
 *  · `order_placed` parte una volta per ORDINE, e un carrello con due negozi fa
 *    due ordini. Quello sì porta `checkout_id`.
 *
 * Quindi: un avvio, due acquisti, e nessuna chiave in comune per ricucirli. La
 * conversione — la misura più importante del sito, quella su cui si giudica
 * ogni intervento sulla cassa — usciva sopra il 100% e non era ricomponibile in
 * nessun modo a posteriori.
 *
 * Qui nasce la chiave, nel browser, quando si ENTRA in cassa: viaggia con
 * l'avvio, viaggia col resto della richiesta d'ordine (tutte e due le strade di
 * pagamento) e torna dentro `order_placed`. Con quella, contare i checkout
 * distinti che hanno prodotto un ordine è una domanda sola.
 *
 * ⚠️ NON È LA CHIAVE DEI DOPPIONI. Quella (`lib/ordini/tentativo.ts`) governa
 * la creazione degli ordini e nasce al momento dell'invio: spostarla qui
 * vorrebbe dire spostare il perno che protegge dal doppio ordine. Questa serve
 * solo a contare, non decide niente sui soldi — e per questo può nascere prima.
 *
 * L'impronta del carrello è quella che c'era già per non contare due volte lo
 * stesso ingresso in pagina (#225): un carrello diverso è un checkout diverso,
 * e ha una chiave sua.
 */

export const NOME_CHIAVE_CHECKOUT = 'mycity:checkout:misura';

export type ChiaveCheckout = {
  /** L'identificativo da mandare nell'evento e al server. */
  id: string;
  /** Vero solo la prima volta per questo carrello: è quando si conta l'avvio. */
  primoIngresso: boolean;
};

type Deposito = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function chiaveDelCheckout(
  deposito: Deposito | null,
  improntaCarrello: string,
  genera: () => string,
  nome: string = NOME_CHIAVE_CHECKOUT,
): ChiaveCheckout {
  // Navigazione privata, memoria negata, o rendering sul server: si conta
  // comunque, con una chiave per ingresso. Meglio un avvio contato due volte
  // che un funnel che non si ricompone.
  if (!deposito) return { id: genera(), primoIngresso: true };

  try {
    const salvato = deposito.getItem(nome);
    if (salvato) {
      const aCapo = salvato.indexOf('\n');
      const impronta = aCapo >= 0 ? salvato.slice(0, aCapo) : '';
      const id = aCapo >= 0 ? salvato.slice(aCapo + 1) : '';
      if (id && impronta === improntaCarrello) return { id, primoIngresso: false };
    }
    const nuova = genera();
    deposito.setItem(nome, `${improntaCarrello}\n${nuova}`);
    return { id: nuova, primoIngresso: true };
  } catch {
    return { id: genera(), primoIngresso: true };
  }
}

/** L'ordine è andato: il prossimo checkout è un altro checkout. */
export function chiudiChiaveDelCheckout(deposito: Deposito | null, nome: string = NOME_CHIAVE_CHECKOUT): void {
  if (!deposito) return;
  try {
    deposito.removeItem(nome);
  } catch {
    /* niente da chiudere */
  }
}

/**
 * Ripulisce una chiave arrivata dal browser prima di usarla come etichetta nei
 * conti: è un dato che viene da fuori, e finisce in un evento.
 */
export function chiaveCheckoutValida(grezza: unknown): string | null {
  if (typeof grezza !== 'string') return null;
  const pulita = grezza.trim();
  if (!/^[A-Za-z0-9_:-]{8,80}$/.test(pulita)) return null;
  return pulita;
}

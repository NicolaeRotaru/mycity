/**
 * 31/10/2026 — CHI RESTA FUORI DAL RIPENSAMENTO.
 *
 * Il Codice del Consumo esclude dal recesso i beni che si deteriorano in fretta
 * (art. 59 lett. d) e quelli fatti su misura o su ordinazione (lett. c). Scelta
 * di Nicola del 31/10 (fatto `legale.recesso-esclusi`): il negozio segna il
 * prodotto nel modulo (`products.non_recedibile`, migrazione 180) e la richiesta
 * di reso per «Cambio idea» su quel prodotto si rifiuta con un messaggio chiaro.
 * Difetto, articolo sbagliato o non conforme restano sempre ammessi: la garanzia
 * legale non dipende da qui.
 *
 * Esempio: una cliente compra una torta da Pane Quotidiano e il giorno dopo
 * chiede il reso con motivo «Cambio idea». Prima la rotta lo accettava e il
 * forno doveva rifiutarlo a mano, contro la promessa scritta sul sito.
 */

/** Il motivo di reso che vuol dire «ci ho ripensato» (lo stesso di `returns.reason`). */
export const MOTIVO_RIPENSAMENTO = 'CHANGED_MIND' as const;

export type ProdottoPerIlRecesso = { name?: string | null; non_recedibile?: boolean | null };

export function esclusoDalRecesso(prodotto: ProdottoPerIlRecesso | null | undefined): boolean {
  return prodotto?.non_recedibile === true;
}

/**
 * Il messaggio con cui si rifiuta la richiesta, oppure `null` se si puo' fare.
 * Si rifiuta solo il ripensamento, e solo se almeno un prodotto e' escluso.
 */
export function rifiutoDelRecesso(motivo: string, prodotti: ProdottoPerIlRecesso[]): string | null {
  if (motivo !== MOTIVO_RIPENSAMENTO) return null;
  const esclusi = prodotti.filter(esclusoDalRecesso);
  if (esclusi.length === 0) return null;
  const nomi = esclusi.map((p) => (p.name ?? '').trim()).filter(Boolean);
  const quali = nomi.length > 0 ? ` (${nomi.join(', ')})` : '';
  const chi = esclusi.length === 1 ? `Questo prodotto${quali} è escluso` : `Questi prodotti${quali} sono esclusi`;
  return `${chi} dal recesso: è fresco o fatto su ordinazione, e la legge non permette il reso per «Cambio idea» (art. 59 del Codice del Consumo). Se è arrivato difettoso o sbagliato, scegli quel motivo: la garanzia vale sempre.`;
}

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
 * Si rifiuta solo il ripensamento, e solo se TUTTI i prodotti della richiesta
 * sono esclusi: la richiesta su una riga sola (la torta) si rifiuta; quella su
 * tutto l'ordine con dentro anche il miele no, perche' il miele il recesso ce
 * l'ha. In quel caso gli esclusi finiscono nella nota per il negozio
 * (`notaDegliEsclusi`) e il rimborso li lascia fuori: l'importo lo sceglie il
 * negozio quando decide il reso.
 */
export function rifiutoDelRecesso(motivo: string, prodotti: ProdottoPerIlRecesso[]): string | null {
  if (motivo !== MOTIVO_RIPENSAMENTO) return null;
  const esclusi = prodotti.filter(esclusoDalRecesso);
  if (esclusi.length === 0 || esclusi.length < prodotti.length) return null;
  const quali = elencoDeiNomi(esclusi);
  const chi = esclusi.length === 1 ? `Questo prodotto${quali} è escluso` : `Questi prodotti${quali} sono esclusi`;
  return `${chi} dal recesso: è fresco o fatto su ordinazione, e la legge non permette il reso per «Cambio idea» (art. 59 del Codice del Consumo). Se è arrivato difettoso o sbagliato, scegli quel motivo: la garanzia vale sempre.`;
}

/**
 * Il ripensamento su un ordine misto passa, ma il negozio deve sapere cosa NON
 * rimborsare: la riga da aggiungere alle note del reso, oppure `null`.
 * Esempio: torta (esclusa) + miele per «Cambio idea» → il reso nasce, e la nota
 * dice che la torta resta fuori dal rimborso.
 */
export function notaDegliEsclusi(motivo: string, prodotti: ProdottoPerIlRecesso[]): string | null {
  if (motivo !== MOTIVO_RIPENSAMENTO) return null;
  const esclusi = prodotti.filter(esclusoDalRecesso);
  if (esclusi.length === 0 || esclusi.length === prodotti.length) return null;
  const nomi = esclusi.map((p) => (p.name ?? '').trim()).filter(Boolean);
  return `Esclusi dal recesso (art. 59 Cod. Cons.), da non rimborsare per «Cambio idea»: ${nomi.length > 0 ? nomi.join(', ') : 'alcuni prodotti dell\'ordine'}.`;
}

/**
 * La banca dati sa gia' dire «escluso dal recesso»? Si guarda una riga di
 * `products` letta con `*`: prima della migrazione 180 la colonna non c'e'.
 * Senza riga non si sa, e si risponde no: meglio non offrire la spunta che
 * offrirla e far fallire il salvataggio (PostgREST rifiuta la colonna, PGRST204).
 */
export function colonnaDelRecessoPresente(riga: unknown): boolean {
  return !!riga && typeof riga === 'object' && 'non_recedibile' in riga;
}

function elencoDeiNomi(prodotti: ProdottoPerIlRecesso[]): string {
  const nomi = prodotti.map((p) => (p.name ?? '').trim()).filter(Boolean);
  return nomi.length > 0 ? ` (${nomi.join(', ')})` : '';
}

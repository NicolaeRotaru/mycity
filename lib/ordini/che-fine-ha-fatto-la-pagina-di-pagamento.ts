/**
 * «STRIPE HA DETTO NO» NON VUOL DIRE «LA PAGINA È ANCORA VIVA».
 *
 * ── Il difetto che ha prodotto questo file (8/9/2026) ───────────────────────
 * Per rendere non più pagabile una pagina di pagamento rimasta aperta si chiama
 * `checkout.sessions.expire`. Stripe la rifiuta in due casi che, dal punto di
 * vista del rifiuto, sono identici — stesso errore, stessa forma:
 *   ① la pagina è ancora viva ma qualcosa è andato storto (rete, chiamata
 *      rifiutata): allora sì, è ancora pagabile, e fermarsi è giusto;
 *   ② la pagina era GIÀ scaduta da sé, da sola, per il passare del tempo:
 *      Stripe non lascia scadere due volte la stessa pagina. Qui non c'è più
 *      niente da temere: quella pagina non incassa più un centesimo.
 *
 * Trattandoli allo stesso modo, il caso ② finiva fra le pagine «ancora
 * pagabili» e faceva rifiutare l'ordine. Cosa vedeva la persona: Maria prova a
 * pagare con la carta, ci ripensa, aspetta mezz'ora (la pagina di Stripe scade
 * da sola dopo trenta minuti) e torna per pagare in contanti. Le risponde
 * «Hai un pagamento con la carta ancora aperto: chiudi quella pagina e
 * riprova». Non c'è nessuna pagina da chiudere, e riprovare dà lo stesso
 * risultato: l'ordine è bloccato finché la riga di intento non scade — fino a
 * due ore. Un ordine perso per una pagina che era già morta.
 *
 * ── La regola ───────────────────────────────────────────────────────────────
 * Quando `expire` viene rifiutata si va a GUARDARE com'è messa la pagina,
 * invece di dare per scontato il peggio. Solo lo stato `expired` è un via
 * libera. Tutto il resto — viva, conclusa, pagata, o semplicemente illeggibile
 * — resta un «no»: nel dubbio non si libera niente e non si incassa niente.
 *
 * Attenzione all'asimmetria, che è voluta: una pagina PAGATA non è «morta».
 * È il caso peggiore di tutti — i soldi sono già stati presi e l'avviso di
 * Stripe è ancora per strada. Lì liberare la merce vorrebbe dire farla comprare
 * a un altro, e far nascere un ordine in contanti accanto vorrebbe dire
 * incassare due volte lo stesso carrello. Quindi la pagata si comporta come la
 * viva: ferma tutto.
 */

/** Com'è messa la pagina di pagamento, guardata dopo un rifiuto di Stripe. */
export type DestinoPagina =
  /** Aperta e pagabile: chi ci torna paga davvero. */
  | 'ancora_viva'
  /** Scaduta da sé: non incassa più. È l'unico caso in cui si può andare avanti. */
  | 'gia_morta'
  /** Conclusa/pagata: i soldi sono già stati presi. Il caso più pericoloso. */
  | 'pagata'
  /** Non si è riusciti a saperlo. Si tratta come un pericolo. */
  | 'non_so';

/** Cosa si fa della riga del tentativo, dopo aver provato a chiudere la pagina. */
export type EsitoChiusura =
  /** Chiusa adesso da noi: la merce si può rimettere in vendita. */
  | 'chiusa'
  /** Era già scaduta da sé: la merce si può rimettere in vendita lo stesso. */
  | 'gia_morta'
  /** Non siamo certi che sia morta: non si tocca niente e non si incassa. */
  | 'ancora_pagabile';

/**
 * Legge lo stato di una sessione di pagamento e dice com'è messa.
 * Pura apposta: la regola si esegue in una prova invece di raccontarla.
 */
export function destinoDellaPagina(
  sessione: { status?: string | null; payment_status?: string | null } | null | undefined,
): DestinoPagina {
  if (!sessione) return 'non_so';
  const stato = typeof sessione.status === 'string' ? sessione.status : null;
  const pagamento = typeof sessione.payment_status === 'string' ? sessione.payment_status : null;

  // I soldi presi battono qualunque stato: si guarda per primo.
  if (pagamento === 'paid') return 'pagata';
  if (stato === 'complete') return 'pagata';
  if (stato === 'expired') return 'gia_morta';
  if (stato === 'open') return 'ancora_viva';
  return 'non_so';
}

/**
 * Cosa resta da fare dopo che Stripe ha RIFIUTATO di chiudere la pagina.
 * Un solo destino apre la strada; tutti gli altri la chiudono.
 */
export function dopoIlRifiutoDiStripe(destino: DestinoPagina): EsitoChiusura {
  return destino === 'gia_morta' ? 'gia_morta' : 'ancora_pagabile';
}

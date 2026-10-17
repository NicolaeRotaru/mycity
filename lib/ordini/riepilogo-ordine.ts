/**
 * Le righe del riepilogo di un ordine già fatto, e la domanda che nessuno faceva: **tornano?**
 *
 * IL DIFETTO. La pagina dell'ordine mostrava tre righe — Subtotale, Spedizione, Totale — e il totale
 * non era la somma delle prime due. Mancavano la consegna MyCity, lo sconto del codice e il credito
 * usato: voci scritte sulla riga d'ordine, che nessuno leggeva. Il caso tipico era «20,00 + 4,90» in
 * colonna e «27,90» come totale: tre euro comparsi dal nulla, nella schermata che serve a fidarsi. E
 * su un ordine in contanti è la cifra che la persona conta in mano al rider.
 *
 * PERCHÉ QUESTA FUNZIONE DICE ANCHE `torna`. Aggiungere le righe mancanti non basta: se un domani il
 * totale scritto sull'ordine e la somma delle voci divergono — un arrotondamento, una colonna nuova,
 * un rimborso parziale — mostrare delle righe che non fanno il totale è peggio che mostrarne poche.
 * Sarebbe una tabella che si contraddice da sola sotto gli occhi di chi ha appena pagato. Quando non
 * torna, chi disegna lo sa e lo dice.
 *
 * TUTTO IN CENTESIMI. La riga d'ordine tiene alcune voci in euro (`total_price`, `shipping_cost`,
 * `discount_amount`) e altre in centesimi (`delivery_fee_cents`, `wallet_applied_cents`). Sommare
 * euro con la virgola porta i suoi errori: qui si converte una volta sola, all'ingresso.
 */

import {
  centesimiDelBonificoDalSegno,
  eUnBonificoDiRimborso,
  rimborsiGiaScritti,
} from '@/lib/stripe/elenco-dei-rimborsi';

export type SegnoVoce = 'piu' | 'meno';

export type VoceRiepilogo = {
  etichetta: string;
  centesimi: number;
  segno: SegnoVoce;
};

export type OrdinePerRiepilogo = {
  total_price: number;
  shipping_cost: number;
  delivery_fee_cents?: number | null;
  discount_amount?: number | null;
  wallet_applied_cents?: number | null;
};

/** Euro (con la virgola) → centesimi interi. `null` e valori non numerici valgono zero. */
export const inCentesimi = (euro: number | null | undefined): number =>
  Number.isFinite(euro) ? Math.round((euro as number) * 100) : 0;

export type Riepilogo = {
  voci: VoceRiepilogo[];
  totaleCentesimi: number;
  sommaCentesimi: number;
  /** La somma delle voci fa il totale scritto sull'ordine? */
  torna: boolean;
  /** Di quanto sbaglia, in centesimi. Zero quando torna. */
  differenzaCentesimi: number;
};

/**
 * @param subtotaleCentesimi somma di quantità × prezzo unitario delle righe, già in centesimi.
 */
export function riepilogoOrdine(ordine: OrdinePerRiepilogo, subtotaleCentesimi: number): Riepilogo {
  const spedizione = inCentesimi(ordine.shipping_cost);
  const consegna = Math.round(Number(ordine.delivery_fee_cents ?? 0)) || 0;
  const sconto = inCentesimi(ordine.discount_amount);
  const credito = Math.round(Number(ordine.wallet_applied_cents ?? 0)) || 0;
  const totale = inCentesimi(ordine.total_price);

  const voci: VoceRiepilogo[] = [
    { etichetta: 'Subtotale', centesimi: subtotaleCentesimi, segno: 'piu' },
    { etichetta: 'Spedizione', centesimi: spedizione, segno: 'piu' },
  ];
  // Le voci a zero non si mostrano: una riga «Sconto codice 0,00» non aggiunge niente e allunga la
  // colonna. Quelle diverse da zero invece devono esserci TUTTE, o il totale non si spiega.
  if (consegna !== 0) voci.push({ etichetta: 'Consegna MyCity', centesimi: consegna, segno: 'piu' });
  if (sconto !== 0) voci.push({ etichetta: 'Sconto codice', centesimi: sconto, segno: 'meno' });
  if (credito !== 0) voci.push({ etichetta: 'Credito MyCity', centesimi: credito, segno: 'meno' });

  const somma = voci.reduce((s, v) => s + (v.segno === 'piu' ? v.centesimi : -v.centesimi), 0);
  return {
    voci,
    totaleCentesimi: totale,
    sommaCentesimi: somma,
    torna: somma === totale,
    differenzaCentesimi: somma - totale,
  };
}

export type StatoPagamento =
  | { tipo: 'contanti-da-pagare'; centesimi: number }
  | { tipo: 'gia-pagato-con-carta'; centesimi: number }
  | { tipo: 'rimborsato' }
  | { tipo: 'bonifico-a-mano'; centesimi: number }
  | { tipo: 'non-lo-so' };

/** Le colonne dell'ordine che decidono cosa dire sul pagamento. */
export type OrdinePerIlPagamento = {
  payment_method?: string | null;
  payment_status?: string | null;
  delivery_status?: string | null;
  /** L'elenco dei rimborsi scritti dal server (migrazione 061: il cliente lo legge, non lo scrive). */
  stripe_refund_id?: string | null;
};

/**
 * Quanto c'è da restituire col bonifico: la somma dei segni «bonifico:<cent>:<chiave>» che
 * `refundOrder` aggiunge all'elenco dei rimborsi dell'ordine, uno per ogni reso o reclamo.
 */
function centesimiDeiBonifici(ordine: OrdinePerIlPagamento): number {
  let somma = 0;
  for (const id of rimborsiGiaScritti(ordine)) {
    if (eUnBonificoDiRimborso(id)) somma += centesimiDelBonificoDalSegno(id) ?? 0;
  }
  return somma;
}

/**
 * La frase del riquadro «bonifico a mano»: la pagina la mostra, una prova la legge.
 *
 * Il bonifico lo fa a mano chi amministra MyCity, quando il cliente risponde all'email del
 * rimborso con l'IBAN. Sul sito non esiste un «fatto»: la frase dice come funziona, ed è vera
 * prima e dopo il pagamento. Mai «rimborsato», mai «arrivato». Al tempo presente, perché l'email
 * parte dopo che il rimborso è registrato e un invio che cade finisce solo nel registro: «ti
 * abbiamo scritto» sarebbe falso proprio a chi non l'ha ricevuta.
 *
 * Collaudo del 17/10 — la frase diceva «se non trovi la nostra email, scrivici» senza condizione:
 * a bonifico già ricevuto il cliente veniva invitato a fare una cosa che non serve più. L'invito
 * vale solo finché il bonifico non l'ha ricevuto; il resto dice come si fa, vero prima e dopo. Senza
 * la parola «arrivato», che la pagina non dice mai sui contanti (D13).
 */
export function fraseDelBonificoAMano(centesimi: number, euro: (centesimi: number) => string): string {
  return (
    `Rimborso di ${euro(centesimi)} con un bonifico, che facciamo a mano. ` +
    "Per farlo ti chiediamo per email l'IBAN e il nome dell'intestatario del conto, che ci mandi rispondendo. " +
    'Se non hai ancora ricevuto il bonifico e non trovi la nostra email, scrivici dalla pagina Contatti senza mettere ' +
    "l'IBAN nel messaggio: ti rispondiamo per email."
  );
}

/**
 * Cosa dire a chi guarda l'ordine, sul pagamento.
 *
 * ⚠️ IL RIQUADRO VERDE «Paghi X in contanti al rider» era senza nessuna condizione: usciva su OGNI
 * ordine, anche su uno appena pagato con la carta. Chi aveva appena pagato leggeva che avrebbe
 * dovuto pagare di nuovo. Il metodo di pagamento non veniva nemmeno letto dal database, e lo stato
 * c'era nella lettura ma non lo guardava nessuno.
 *
 * Il quarto caso — «non lo so» — non è pedanteria: un ordine vecchio può non avere il metodo scritto,
 * e su un ordine di cui non so come è stato pagato non devo dire NIENTE. Meglio un riquadro in meno
 * di un riquadro che sbaglia sui soldi.
 *
 * 17/10/2026 — Decisione di Nicola («Semplifica»): i contanti tornano sempre con un bonifico fatto a
 * mano, e la pagina non chiede più niente al server oltre all'ordine. Sui contanti ci sono due frasi
 * sole, e ogni altra combinazione non ne dice nessuna:
 *  · rimborsato (anche in parte) con almeno un segno di bonifico sull'ordine → «bonifico a mano»,
 *    con la somma dei segni: solo la parte in contanti, mai il lordo;
 *  · in attesa di pagamento (PENDING o vuoto) su un ordine né consegnato né annullato → «Paghi X in
 *    contanti al rider». Prima bastava «non PAID»: un ordine annullato (FAILED), uno consegnato con
 *    l'incasso non ancora registrato, uno rimborsato in parte senza bonifico dicevano tutti di
 *    pagare di nuovo l'intero al rider.
 * La carta resta com'era.
 */
export function statoPagamento(ordine: OrdinePerIlPagamento, totaleCentesimi: number): StatoPagamento {
  const metodo = (ordine.payment_method ?? '').toLowerCase();
  const stato = (ordine.payment_status ?? '').toUpperCase();
  if (metodo === 'cod') {
    const consegna = (ordine.delivery_status ?? '').toUpperCase();
    const bonifici = centesimiDeiBonifici(ordine);
    if ((stato === 'REFUNDED' || stato === 'PARTIALLY_REFUNDED') && bonifici > 0) {
      return { tipo: 'bonifico-a-mano', centesimi: bonifici };
    }
    if ((stato === 'PENDING' || stato === '') && consegna !== 'DELIVERED' && consegna !== 'CANCELED') {
      return { tipo: 'contanti-da-pagare', centesimi: totaleCentesimi };
    }
    return { tipo: 'non-lo-so' };
  }
  if (stato === 'REFUNDED') return { tipo: 'rimborsato' };
  if (metodo === 'card' && stato === 'PAID') return { tipo: 'gia-pagato-con-carta', centesimi: totaleCentesimi };
  return { tipo: 'non-lo-so' };
}

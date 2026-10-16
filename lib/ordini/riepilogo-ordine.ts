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
  | { tipo: 'bonifico-in-arrivo'; centesimi: number; serveIban: boolean; certo: boolean }
  | { tipo: 'non-lo-so' };

/**
 * Quello che si sa del bonifico di rimborso di un ordine in contanti (lo calcola il server:
 * lib/rimborsi/bonifico-del-cliente.ts). `'non-lo-so'` finche' non e' arrivato, o se la lettura
 * e' caduta.
 */
export type BonificoPerLaPagina =
  | { daFareCents: number; serveIban: boolean; certo: boolean }
  | 'non-lo-so';

/** Le frasi del riquadro «bonifico in arrivo»: la pagina le mostra, una prova le legge. */
export function fraseDelBonificoInArrivo(
  s: Extract<StatoPagamento, { tipo: 'bonifico-in-arrivo' }>,
  euro: (centesimi: number) => string,
): string {
  if (!s.certo) {
    return `Ti restituiamo ${euro(s.centesimi)} con un bonifico, che facciamo a mano. Se non ti è ancora arrivato, scrivici dalla pagina Contatti.`;
  }
  return (
    `Rimborso di ${euro(s.centesimi)} in arrivo con un bonifico, che facciamo a mano.` +
    (s.serveIban
      ? " Per farlo ci serve il tuo IBAN: scrivici dalla pagina Contatti e indica il numero dell'ordine."
      : '')
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
 * Riesame del 16/10, quarto giro — SUI CONTANTI «RIMBORSATO» ARRIVAVA PRIMA DEI SOLDI.
 * Un ordine in contanti si rimborsa col bonifico, che una persona fa a mano dopo la decisione:
 * lo stato del pagamento diventa «rimborsato» subito, i soldi arrivano dopo — o mai, se manca
 * l'IBAN. La pagina diceva «Ordine rimborsato.» dal primo minuto, mentre l'email chiedeva l'IBAN.
 * Adesso, su un ordine in contanti rimborsato, la pagina guarda il bonifico: se e' ancora da fare
 * dice «in arrivo» (e chiede l'IBAN se manca); «rimborsato» solo quando nessun bonifico e' in
 * sospeso. Finche' non si sa niente del bonifico, non dice niente.
 */
export function statoPagamento(
  ordine: { payment_method?: string | null; payment_status?: string | null },
  totaleCentesimi: number,
  bonifico: BonificoPerLaPagina = 'non-lo-so',
): StatoPagamento {
  const metodo = (ordine.payment_method ?? '').toLowerCase();
  const stato = (ordine.payment_status ?? '').toUpperCase();
  const rimborsatoAlmenoInParte = stato === 'REFUNDED' || stato === 'PARTIALLY_REFUNDED';
  if (metodo === 'cod' && rimborsatoAlmenoInParte) {
    if (bonifico === 'non-lo-so') return { tipo: 'non-lo-so' };
    if (bonifico.daFareCents > 0) {
      return { tipo: 'bonifico-in-arrivo', centesimi: bonifico.daFareCents, serveIban: bonifico.serveIban, certo: bonifico.certo };
    }
  }
  if (stato === 'REFUNDED') return { tipo: 'rimborsato' };
  if (metodo === 'card' && stato === 'PAID') return { tipo: 'gia-pagato-con-carta', centesimi: totaleCentesimi };
  if (metodo === 'cod' && stato !== 'PAID') return { tipo: 'contanti-da-pagare', centesimi: totaleCentesimi };
  return { tipo: 'non-lo-so' };
}

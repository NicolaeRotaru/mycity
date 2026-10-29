import { compensoRiderCents, shippingCentsFor } from '@/lib/shipping';
import { ripartisciCentesimi, riduciAlTetto } from '@/lib/stripe/ripartizione';
import {
  MARKETPLACE_FEE_BPS,
  PICKUP_DISCOUNT_PERCENT,
  CONSEGNA_NEGOZIO_IN_PIU_CENTS,
  PLATFORM_DELIVERY_FEE_CENTS,
  SPESA_SENZA_SUPPLEMENTO_CENTS,
  SUPPLEMENTO_CONSEGNA_CENTS,
  SUPPLEMENTO_VELOCE_CENTS,
  commissioneCents,
} from '@/lib/constants';

/**
 * Il conto della cassa, in un posto solo.
 *
 * 22/8/2026 — LA CASSA ESISTEVA IN DUE COPIE.
 *
 * Il percorso in contanti e quello con carta rifacevano lo stesso conto, riga
 * per riga: spedizione per negozio, sconto del ritiro, fee di consegna, tetto
 * complessivo sugli sconti, ripartizione delle quote col metodo del resto più
 * grande. Duecento righe di aritmetica sui soldi, scritte due volte.
 *
 * Non è un problema estetico. La storia scritta nei commenti di quelle due
 * rotte dice che almeno tre volte una riparazione è stata fatta da una parte
 * sola: lo sconto senza tetto che produceva ordini a totale negativo, gli
 * arrotondamenti indipendenti che non quadravano col totale addebitato, il
 * compenso del fattorino che una rotta scriveva e l'altra no. Ogni volta il
 * cliente pagava un importo diverso a seconda di come sceglieva di pagare.
 *
 * Qui il conto è uno. Le due rotte restano diverse solo dove lo sono davvero:
 * la carta apre una sessione di pagamento, il contante scrive gli ordini,
 * addebita il credito e sa tornare indietro se qualcosa si rompe.
 *
 * La prova che tiene questa cosa in vita sta in
 * `tests/unit/la-cassa-fa-lo-stesso-conto.test.ts`: dà lo stesso carrello a
 * tutte e due le strade e pretende gli stessi centesimi, voce per voce.
 */

export type GruppoDaPrezzare = {
  sellerId: string;
  /** Il subtotale della merce di questo negozio, già scontato e in centesimi. */
  subtotalCents: number;
};

export type CoordinateNegozio = { lat: number | null; lng: number | null };

export type IngressiPrezzo = {
  gruppi: GruppoDaPrezzare[];
  /** Dove sta il negozio, per la distanza. */
  coordinateNegozio: (sellerId: string) => CoordinateNegozio;
  /** Dove va la spesa. Null = tariffa fissa. */
  consegnaLat: number | null;
  consegnaLng: number | null;
  pickupInStore: boolean;
  /**
   * Il codice «Spedizione gratuita» è applicato? Toglie al cliente la consegna di ogni negozio
   * fin dove la paga la commissione di quel negozio (`consegnaDaPagareCents`): il fattorino resta
   * pagato, e quel compenso lo copre la piattaforma, mai il negozio.
   */
  couponSpedizioneGratis: boolean;
  /** Quanto sconta il coupon, in centesimi, sull'intero carrello. */
  couponScontoCents: number;
  /**
   * La consegna è quella veloce (la fascia «Adesso», `ETICHETTA_ADESSO`)? Obbligatorio, senza un
   * valore di comodo: chi chiama deve dirlo, perché la veloce costa un euro in più. Le rotte lo
   * ricavano dalla fascia salvata sull'ordine con `eConsegnaVeloce` (lib/ordini/consegna-veloce).
   */
  consegnaVeloce: boolean;
};

export type PrezzoDiGruppo = {
  sellerId: string;
  subtotalCents: number;
  shippingCents: number;
  deliveryFeeCents: number;
  /** La tariffa di consegna di questo negozio PRIMA del codice «Spedizione gratuita». */
  tariffaConsegnaCents: number;
  couponPortionCents: number;
  pickupPortionCents: number;
  /** Quello che il cliente paga per questo negozio. Mai sotto zero. */
  totalCents: number;
  /** Il compenso del fattorino per questa consegna. */
  riderFeeCents: number;
};

export type EsitoPrezzo = {
  gruppi: PrezzoDiGruppo[];
  grandSubtotalCents: number;
  grandShippingCents: number;
  pickupDiscountCents: number;
  /** Lo sconto DAVVERO applicato, già limitato al tetto. */
  scontoApplicatoCents: number;
  grandTotalCents: number;
  /** Le voci della consegna del carrello, PRIMA del codice «Spedizione gratuita». */
  consegna: VociDellaConsegna;
  /** La consegna da pagare per tutto il carrello: la somma di `deliveryFeeCents` degli ordini. */
  grandDeliveryFeeCents: number;
};

/**
 * 27/10/2026 — IL CODICE «SPEDIZIONE GRATUITA» REGALA LA CONSEGNA FIN DOVE LA PAGA L'ORDINE.
 *
 * Al lancio la spedizione è zero e il cliente paga solo la consegna, 3 € per negozio, che pagano il
 * fattorino (3 €). Il codice azzerava solo la spedizione: accettato, segnato come usato, e il cliente
 * pagava come chi non ce l'ha. Il primo rimedio azzerava tutta la consegna, e rompeva i bonifici: con
 * la carta il netto del negozio e il compenso del fattorino escono dallo STESSO addebito
 * (`source_transaction`, lib/stripe/payout.ts), e da un addebito Stripe non versa più di quanto ha
 * incassato. 20 € dal fornaio col codice: incasso 20 €, al negozio 18 €, al fattorino 3 € — 21 € di
 * bonifici su 20. Il secondo falliva, e il giro lo ritentava all'infinito.
 *
 * Adesso il codice toglie al cliente la parte di consegna che la piattaforma può regalare con quello
 * che le resta di quell'ordine (commissione più spedizione): da 30 € di spesa per negozio tutta, a
 * 20 € due euro su tre. Il negozio incassa lo stesso netto, il fattorino lo stesso compenso, e i
 * bonifici non superano mai l'addebito. Pagare il resto col saldo della piattaforma è un'altra
 * scelta, e si farebbe in lib/stripe/payout.ts, non qui.
 * Prova: tests/unit/col-codice-spedizione-gratuita-i-bonifici-stanno-nell-addebito.test.ts.
 */
/**
 * 29/10/2026 22:21 — LA CONSEGNA È UNA SOLA, PER TUTTO IL CARRELLO (registro dei fatti, consegna.promessa).
 *
 * L'ondata 13 faceva pagare 3 € o 4 € a OGNI negozio: 15 € dal fornaio più 12 € dal fruttivendolo
 * uscivano a 6 € di consegna, ma il fattorino fa un giro solo. La regola firmata da Nicola:
 *   ① 3 € di base per tutto il carrello, con la fascia che sceglie il cliente;
 *   ② 1 € in più per ogni negozio in più (una fermata in più nel giro);
 *   ③ 1 € in più per ogni negozio in cui la merce, dopo gli sconti, sta sotto i 10 €;
 *   ④ la veloce («Adesso») costa 1 € in più una volta sola, ma è compresa se al punto ③ c'è già
 *      almeno un euro.
 * Esempi (fascia / veloce): 15 → 3/4 · 8 → 4/4 · 15+12 → 4/5 · 15+6 → 5/5 · 6+7 → 6/6 ·
 * 15+12+20 → 5/6 · 15+12+5 → 6/6 · 5+6+7 → 8/8. Non c'è più un massimo.
 *
 * Il carrello resta diviso in un ordine per negozio, e la consegna si divide fra gli ordini senza
 * perdere né creare centesimi: il «primo negozio» (la spesa più alta, a parità il primo del
 * carrello) porta la base e l'euro della veloce quando si paga; ogni altro ordine porta il suo euro
 * di fermata; ogni ordine sotto i 10 € porta il suo euro in più. Il fattorino si divide allo stesso
 * modo (Nicola, 29/10 alle 23:04, logistica.compenso-fattorino): 3 € per il giro sul primo negozio,
 * 1 € su ogni altro; la spesa piccola e la veloce restano a MyCity. Così ogni ordine incassa almeno
 * il compenso che versa, e con la carta i bonifici della stessa charge stanno dentro l'addebito.
 * Prove: tests/unit/la-consegna-e-una-sola-per-tutto-il-carrello.test.ts, sonda-collaudo-a.test.ts.
 */
export type VociDellaConsegna = {
  /** I 3 € di base, una volta sola. Zero col ritiro in negozio o col carrello vuoto. */
  baseCents: number;
  /** Quanti negozi ci sono oltre al primo, e quanto costano. */
  negoziInPiu: number;
  negoziInPiuCents: number;
  /** In quanti negozi la merce (dopo gli sconti) sta sotto i 10 €, e quanto costano. */
  negoziSottoSoglia: number;
  spesaPiccolaCents: number;
  /** Quanto si paga per la veloce: zero se non è scelta o se è compresa. */
  veloceCents: number;
  /** La veloce, se la si sceglie, è già pagata dall'euro della spesa piccola. */
  veloceCompresa: boolean;
  /** Quanto costerebbe in più la veloce su questo carrello, scelta o no: zero se è compresa. */
  supplementoVeloceCents: number;
  /** La consegna di tutto il carrello: la somma delle voci, e la somma di `perOrdineCents`. */
  totaleCents: number;
  /** La posizione del negozio che porta la base (e la veloce). -1 se non c'è consegna. */
  primo: number;
  /** La consegna di ogni ordine, nella stessa posizione dei negozi. */
  perOrdineCents: number[];
};

export function vociDellaConsegna(a: {
  pickupInStore: boolean;
  /**
   * Per ogni negozio del carrello: la spesa con cui si sceglie il primo (la merce prima degli
   * sconti, così due spese uguali restano pari) e la merce dopo gli sconti, su cui si guarda la
   * soglia dei 10 €.
   */
  negozi: Array<{ spesaCents: number; merceCents: number }>;
  consegnaVeloce: boolean;
}): VociDellaConsegna {
  const n = a.negozi.length;
  if (a.pickupInStore || n === 0) {
    return {
      baseCents: 0, negoziInPiu: 0, negoziInPiuCents: 0, negoziSottoSoglia: 0, spesaPiccolaCents: 0,
      veloceCents: 0, veloceCompresa: false, supplementoVeloceCents: 0, totaleCents: 0, primo: -1, perOrdineCents: a.negozi.map(() => 0),
    };
  }
  let primo = 0;
  a.negozi.forEach((g, i) => {
    if (g.spesaCents > a.negozi[primo].spesaCents) primo = i;
  });
  const sotto = a.negozi.map((g) => g.merceCents < SPESA_SENZA_SUPPLEMENTO_CENTS);
  const negoziSottoSoglia = sotto.filter(Boolean).length;
  const spesaPiccolaCents = negoziSottoSoglia * SUPPLEMENTO_CONSEGNA_CENTS;
  const veloceCompresa = spesaPiccolaCents > 0;
  const veloceCents = a.consegnaVeloce && !veloceCompresa ? SUPPLEMENTO_VELOCE_CENTS : 0;
  const perOrdineCents = a.negozi.map((_, i) =>
    (i === primo ? PLATFORM_DELIVERY_FEE_CENTS + veloceCents : CONSEGNA_NEGOZIO_IN_PIU_CENTS)
    + (sotto[i] ? SUPPLEMENTO_CONSEGNA_CENTS : 0),
  );
  return {
    baseCents: PLATFORM_DELIVERY_FEE_CENTS,
    negoziInPiu: n - 1,
    negoziInPiuCents: (n - 1) * CONSEGNA_NEGOZIO_IN_PIU_CENTS,
    negoziSottoSoglia,
    spesaPiccolaCents,
    veloceCents,
    veloceCompresa,
    supplementoVeloceCents: veloceCompresa ? 0 : SUPPLEMENTO_VELOCE_CENTS,
    totaleCents: perOrdineCents.reduce((s, x) => s + x, 0),
    primo,
    perOrdineCents,
  };
}

/**
 * La consegna di un carrello con UN negozio solo: 3 € con la fascia, 4 € sotto i 10 € di merce o
 * con la veloce. È `vociDellaConsegna` con un negozio, non una seconda regola.
 */
export function tariffaConsegnaCents(a: {
  pickupInStore: boolean;
  merceCents: number;
  consegnaVeloce: boolean;
}): number {
  return vociDellaConsegna({
    pickupInStore: a.pickupInStore,
    negozi: [{ spesaCents: a.merceCents, merceCents: a.merceCents }],
    consegnaVeloce: a.consegnaVeloce,
  }).totaleCents;
}

function consegnaDaPagareCents(a: {
  pickupInStore: boolean;
  codiceSpedizioneGratis: boolean;
  /** La consegna piena di questo ordine (`vociDellaConsegna().perOrdineCents`). */
  tariffaCents: number;
  /** La parte di base che porta questo ordine: i 3 € sul primo negozio, zero sugli altri. */
  baseCents: number;
  /** La merce del negozio dopo gli sconti: la base su cui computeOrderSplit calcola la commissione. */
  merceCents: number;
  shippingCents: number;
  riderFeeCents: number;
}): number {
  if (a.pickupInStore) return 0;
  if (!a.codiceSpedizioneGratis) return a.tariffaCents;
  // Il codice toglie solo la parte dei 3 € di base che toglieva prima; gli euro in più (negozi in
  // più, spesa piccola, veloce) restano da pagare (scelta dell'AD del 29/10, scritta in DECISIONI).
  const euroInPiuCents = Math.max(0, a.tariffaCents - a.baseCents);
  const restaAllaPiattaforma = commissioneCents(Math.max(0, a.merceCents)) + a.shippingCents;
  return (
    euroInPiuCents
    + Math.min(a.baseCents, Math.max(0, a.riderFeeCents - restaAllaPiattaforma))
  );
}

/**
 * Da quanta spesa per negozio il codice «Spedizione gratuita» toglie TUTTA la consegna: quella su
 * cui la commissione basta da sola a pagare il fattorino. Si ricava dai due numeri, non si scrive.
 */
export function spesaPerConsegnaGratisColCodiceCents(): number {
  return Math.ceil((compensoRiderCents({ pickupInStore: false }) * 10000) / MARKETPLACE_FEE_BPS);
}

export function prezziDelCarrello(ing: IngressiPrezzo): EsitoPrezzo {
  const subtotali = ing.gruppi.map((g) => g.subtotalCents);
  const grandSubtotalCents = subtotali.reduce((s, x) => s + x, 0);

  const shippingPerGruppo = ing.gruppi.map((g, i) => {
    const coord = ing.coordinateNegozio(g.sellerId);
    return shippingCentsFor({
      subtotal: subtotali[i] / 100,
      storeLat: coord.lat,
      storeLng: coord.lng,
      deliveryLat: ing.consegnaLat,
      deliveryLng: ing.consegnaLng,
      pickupInStore: ing.pickupInStore,
      freeShipping: ing.couponSpedizioneGratis,
    });
  });
  const grandShippingCents = shippingPerGruppo.reduce((s, x) => s + x, 0);

  const pickupDiscountCents = ing.pickupInStore
    ? Math.round(grandSubtotalCents * (PICKUP_DISCOUNT_PERCENT / 100))
    : 0;

  // Il tetto: lo sconto non può superare quello che c'è da pagare, meno un
  // centesimo. Senza, uno sconto più grande del carrello produce un ordine con
  // totale negativo — cioè un negozio che paga il cliente.
  const tettoScontoCents = Math.max(0, grandSubtotalCents + grandShippingCents - 1);
  const scontiLimitati = riduciAlTetto(ing.couponScontoCents, pickupDiscountCents, tettoScontoCents);

  // Le quote per negozio si calcolano dallo sconto GIÀ limitato, col metodo del
  // resto più grande: così la somma delle quote torna al centesimo con
  // l'importo addebitato. Con arrotondamenti indipendenti non tornava.
  const quoteCoupon = ripartisciCentesimi(scontiLimitati.codice, subtotali);
  const quoteRitiro = ripartisciCentesimi(scontiLimitati.ritiro, subtotali);

  // La consegna è del carrello intero (vociDellaConsegna): qui si divide fra gli ordini.
  const consegna = vociDellaConsegna({
    pickupInStore: ing.pickupInStore,
    negozi: ing.gruppi.map((_, i) => ({
      spesaCents: subtotali[i],
      merceCents: subtotali[i] - quoteCoupon[i] - quoteRitiro[i],
    })),
    consegnaVeloce: ing.consegnaVeloce,
  });

  const gruppi: PrezzoDiGruppo[] = ing.gruppi.map((g, i) => {
    const couponPortionCents = quoteCoupon[i];
    const pickupPortionCents = quoteRitiro[i];
    // 27/8/2026 (R008) — Il compenso del fattorino era riscritto qui dentro,
    // con il 300 a mano e la motivazione «non importato da lib/shipping per
    // non creare un giro di dipendenze»: motivazione falsa, questo file
    // importa da lib/shipping dalla prima riga. Due copie della stessa cifra
    // vogliono dire che il giorno in cui cambia una resta indietro.
    //
    // 29/10/2026 23:04 — Il giro è uno: 3 € sull'ordine che porta la base, 1 € su ogni negozio in
    // più (logistica.compenso-fattorino). Con 3 € su ogni ordine il fattorino prendeva 6 € su un
    // carrello 15 + 12 € che il cliente paga 4 €, e con la carta i bonifici superavano l'addebito.
    const riderFeeCents = compensoRiderCents({
      pickupInStore: ing.pickupInStore,
      negozioInPiu: i !== consegna.primo,
    });
    const merceCents = subtotali[i] - couponPortionCents - pickupPortionCents;
    const tariffaCents = consegna.perOrdineCents[i];
    const deliveryFeeCents = consegnaDaPagareCents({
      pickupInStore: ing.pickupInStore,
      codiceSpedizioneGratis: ing.couponSpedizioneGratis,
      tariffaCents,
      baseCents: i === consegna.primo ? consegna.baseCents : 0,
      merceCents,
      shippingCents: shippingPerGruppo[i],
      riderFeeCents,
    });
    return {
      sellerId: g.sellerId,
      subtotalCents: subtotali[i],
      shippingCents: shippingPerGruppo[i],
      deliveryFeeCents,
      tariffaConsegnaCents: tariffaCents,
      couponPortionCents,
      pickupPortionCents,
      totalCents: Math.max(
        0,
        subtotali[i] + shippingPerGruppo[i] + deliveryFeeCents - couponPortionCents - pickupPortionCents,
      ),
      riderFeeCents,
    };
  });

  return {
    gruppi,
    grandSubtotalCents,
    grandShippingCents,
    pickupDiscountCents,
    scontoApplicatoCents: scontiLimitati.codice + scontiLimitati.ritiro,
    grandTotalCents: gruppi.reduce((s, g) => s + g.totalCents, 0),
    consegna,
    grandDeliveryFeeCents: gruppi.reduce((s, g) => s + g.deliveryFeeCents, 0),
  };
}

/**
 * Quanto costa in più la consegna veloce su questo carrello: la differenza fra i due conti veri,
 * non un «+1 €» scritto a mano. Zero quando almeno un negozio è sotto i 10 € (la veloce è compresa).
 */
export function supplementoDellaVeloceCents(ing: Omit<IngressiPrezzo, 'consegnaVeloce'>): number {
  const consegna = (e: EsitoPrezzo) => e.gruppi.reduce((s, g) => s + g.deliveryFeeCents, 0);
  return Math.max(
    0,
    consegna(prezziDelCarrello({ ...ing, consegnaVeloce: true }))
      - consegna(prezziDelCarrello({ ...ing, consegnaVeloce: false })),
  );
}

/**
 * 30/10/2026 00:35 — SE UN NEGOZIO DEL CARRELLO SE NE VA, LA CONSEGNA SI RIFÀ SUI NEGOZI RIMASTI
 * (registro dei fatti, consegna.negozio-che-rifiuta).
 *
 * Pane 15 € e frutta 12 €: consegna 4 €, il forno porta la base (3 €) e la frutta il suo euro di
 * fermata. Il forno rifiuta. Prima l'ordine della frutta restava con 1 € di consegna e la base se ne
 * andava col rimborso del forno: il fattorino faceva il giro per 1 € e MyCity incassava 13 € su un
 * giro che vale 15. La regola di Nicola: la consegna si rifà coi negozi rimasti, con la stessa regola
 * (la frutta da sola: 3 €); al cliente torna la merce del forno più la differenza della consegna
 * (15 + (4 − 3) = 16 €); il fattorino prende il compenso del giro coi negozi rimasti (3 €).
 *
 * Qui c'è il conto, puro. Lo usano tutte le strade che annullano un ordine PRIMA della consegna
 * (`ricalcolaLaConsegnaDelGiro` in lib/ordini/annulla.ts: rifiuto del negozio, annullo, ordini
 * scaduti). La consegna non si perde e non si crea: quello che gli ordini rimasti prendono in più
 * lo cede l'ordine annullato, che rende al cliente quel tanto in meno. Con la carta i soldi sono già
 * sulla stessa charge e il rimborso scende della differenza; coi contanti cambia il totale da pagare
 * alla porta.
 *
 * Si rifiuta di contare (null) quando gli ordini non portano il conto che la regola darebbe oggi:
 * un carrello nato con una regola vecchia, o già ricalcolato da un annullo precedente rimasto a
 * metà. Riscrivere a occhio un conto che non si riconosce sposterebbe soldi veri a caso.
 * Prova: tests/unit/se-un-negozio-rifiuta-la-consegna-si-rifa-sui-negozi-rimasti.test.ts.
 */
export type OrdineDelGiro = {
  id: string;
  /** La merce prima degli sconti: sceglie il «primo negozio», come in cassa. */
  spesaCents: number;
  /** La merce dopo gli sconti: la soglia dei 10 € e la commissione. */
  merceCents: number;
  shippingCents: number;
  /** La consegna scritta sull'ordine, adesso. */
  deliveryFeeCents: number;
  /** Il compenso del fattorino scritto sull'ordine, adesso. */
  riderFeeCents: number;
  /** Già annullato da un annullo precedente (non quello di adesso). */
  giaAnnullato: boolean;
};

export type RigaRicalcolata = {
  id: string;
  deliveryFeeCents: number;
  riderFeeCents: number;
  /** Di quanto cambia la consegna di questo ordine (e quindi il suo totale). */
  deltaCents: number;
};

export type ConsegnaDopoLAnnullo = {
  /** Gli ordini del carrello che restano, con la consegna e il compenso nuovi. */
  rimasti: RigaRicalcolata[];
  /** L'ordine annullato adesso: cede la differenza e non paga più nessun fattorino. */
  annullato: RigaRicalcolata;
  /** Quanto la consegna dei rimasti sale: è quanto il cliente si vede rendere in meno. */
  differenzaCents: number;
};

function contoDelGiro(
  ordini: OrdineDelGiro[],
  consegnaVeloce: boolean,
  codiceSpedizioneGratis: boolean,
): Array<{ deliveryFeeCents: number; riderFeeCents: number }> {
  const voci = vociDellaConsegna({
    pickupInStore: false,
    negozi: ordini.map((o) => ({ spesaCents: o.spesaCents, merceCents: o.merceCents })),
    consegnaVeloce,
  });
  return ordini.map((o, i) => {
    const riderFeeCents = compensoRiderCents({ pickupInStore: false, negozioInPiu: i !== voci.primo });
    return {
      riderFeeCents,
      deliveryFeeCents: consegnaDaPagareCents({
        pickupInStore: false,
        codiceSpedizioneGratis,
        tariffaCents: voci.perOrdineCents[i],
        baseCents: i === voci.primo ? voci.baseCents : 0,
        merceCents: o.merceCents,
        shippingCents: o.shippingCents,
        riderFeeCents,
      }),
    };
  });
}

export function consegnaDopoLAnnullo(a: {
  /** Tutti gli ordini del carrello, nell'ordine del carrello, compreso quello che si annulla. */
  ordini: OrdineDelGiro[];
  annullaId: string;
  consegnaVeloce: boolean;
  pickupInStore: boolean;
}): ConsegnaDopoLAnnullo | null {
  if (a.pickupInStore) return null;
  const vivi = a.ordini.filter((o) => !o.giaAnnullato);
  const chiSeNeVa = vivi.find((o) => o.id === a.annullaId);
  if (!chiSeNeVa || vivi.length < 2) return null;

  // Il conto scritto deve essere quello della regola, col codice o senza: altrimenti non si tocca.
  const scritto = (c: Array<{ deliveryFeeCents: number; riderFeeCents: number }>) =>
    c.every((x, i) => x.deliveryFeeCents === vivi[i].deliveryFeeCents && x.riderFeeCents === vivi[i].riderFeeCents);
  const codice = [false, true].find((conCodice) => scritto(contoDelGiro(vivi, a.consegnaVeloce, conCodice)));
  if (codice === undefined) return null;

  const restano = vivi.filter((o) => o.id !== a.annullaId);
  const dopo = contoDelGiro(restano, a.consegnaVeloce, codice);
  const rimasti = restano.map((o, i) => ({
    id: o.id,
    deliveryFeeCents: dopo[i].deliveryFeeCents,
    riderFeeCents: dopo[i].riderFeeCents,
    deltaCents: dopo[i].deliveryFeeCents - o.deliveryFeeCents,
  }));
  const differenzaCents = rimasti.reduce((s, r) => s + r.deltaCents, 0);
  const consegnaAnnullato = Math.max(0, chiSeNeVa.deliveryFeeCents - differenzaCents);
  return {
    rimasti,
    annullato: {
      id: chiSeNeVa.id,
      deliveryFeeCents: consegnaAnnullato,
      riderFeeCents: 0,
      deltaCents: -differenzaCents,
    },
    differenzaCents,
  };
}

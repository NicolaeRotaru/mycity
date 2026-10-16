/**
 * LE REGOLE DEL RIMBORSO, IN UN POSTO SOLO.
 *
 * Tre domande che prima avevano una risposta diversa a seconda di chi la
 * faceva — la funzione dei rimborsi, la rotta dei reclami, le rotte dei resi —
 * e che qui ne hanno una sola, eseguibile da una prova:
 *
 *  ① QUANTO si puo' restituire su un ordine (R84).
 *  ② IN CHE MODO torna il rimborso di chi ha pagato in contanti (R71).
 *  ③ COSA resta dovuto al negozio dopo un reclamo chiuso col rimborso (R76).
 *
 * Funzioni pure: niente database, niente rete. Chi muove i soldi le chiama.
 */

import { formatPriceFromCents } from '@/lib/format';

/**
 * Come torna il rimborso al cliente. «misto» e' l'ordine in contanti pagato in
 * parte col credito MyCity: la parte del credito torna credito, quella dei
 * contanti va col bonifico.
 */
export type ModoDelRimborso = 'carta' | 'credito' | 'bonifico' | 'misto';

/** La scelta che il cliente fa nel modulo di reso, per gli ordini in contanti. */
export type SceltaContanti = 'BONIFICO' | 'CREDITO';

/** Quello che serve sapere di un ordine per decidere un rimborso. */
export interface OrdineDaRimborsare {
  stripe_payment_intent?: string | null;
  payment_method?: string | null;
  /** Lordo di vendita in centesimi, PRIMA dello scomputo del credito (migrazione 124). */
  gross_total_cents?: number | null;
  /** Cassa attesa in euro, DOPO lo scomputo del credito. */
  total_price?: number | string | null;
  /** Credito MyCity speso sull'ordine, in centesimi. */
  wallet_applied_cents?: number | null;
  refunded_amount_cents?: number | null;
  cash_confirmed_at?: string | null;
  payment_status?: string | null;
  delivery_status?: string | null;
}

/**
 * Il lordo dell'ordine in centesimi: la colonna della 124, o il totale per gli
 * ordini nati prima. E' anche il tetto che il database mette ai rimborsi
 * (`accumula_rimborso`, con lo stesso ripiego): i due conti devono coincidere,
 * altrimenti «rimborsato per intero» vuol dire due cose diverse.
 */
export function lordoDellOrdine(ordine: OrdineDaRimborsare): number {
  if (ordine.gross_total_cents != null) return Math.max(0, Math.round(Number(ordine.gross_total_cents)));
  return Math.max(0, Math.round(Number(ordine.total_price ?? 0) * 100));
}

/** Pagato alla consegna: nessun pagamento con carta dietro, metodo «cod». */
export function pagatoInContanti(ordine: OrdineDaRimborsare): boolean {
  return !ordine.stripe_payment_intent && ordine.payment_method === 'cod';
}

/**
 * Il modulo di reso deve chiedere come riavere i soldi? Solo se c'e' una parte
 * pagata in contanti: un ordine pagato tutto col credito MyCity torna credito
 * comunque, e chiedere l'IBAN sarebbe una domanda finta.
 */
export function serveLaSceltaDelRimborso(ordine: OrdineDaRimborsare): boolean {
  return pagatoInContanti(ordine) && Number(ordine.total_price ?? 0) > 0;
}

/**
 * I contanti sono passati di mano?
 *
 * Due fatti lo dicono, e restano scritti sull'ordine anche dopo un rimborso:
 *  · il fattorino che conferma l'incasso (`/api/rider/cash-confirm` scrive
 *    `cash_confirmed_at` e `PAID`), o chi registra l'incasso al posto suo;
 *  · la consegna stessa. «Pagamento alla consegna» vuol dire questo: l'ordine
 *    diventa consegnato col codice a sei cifre che il cliente da' a mano al
 *    fattorino (`verify_delivery_code`), o al negoziante sul ritiro al banco
 *    (`confirm_pickup_by_seller`, 124, che scrive anche `PAID`). La conferma
 *    dell'incasso nell'app del fattorino puo' arrivare dopo, o dimenticarsi:
 *    tenerla come unica prova avrebbe lasciato senza rimborso un cliente che
 *    ha pagato.
 * `PAID` resta come terzo segno, per chi lo scrive senza gli altri due.
 *
 * Collaudo del 15/10 — QUI C'ERANO ANCHE `PARTIALLY_REFUNDED` E `REFUNDED`,
 * con la frase «un ordine gia' rimborsato in parte era pagato per forza». Non
 * era vero: fino a questo lotto `refundOrder` rimborsava anche ordini mai
 * incassati (il difetto R84 stesso), e il rimborso del solo credito su un
 * ordine fermo lo lasciava PARTIALLY_REFUNDED. Da quel momento l'ordine
 * risultava «incassato»: il pannello dei reclami lo mostrava cosi', e un
 * secondo reclamo restituiva contanti che nessuno aveva mai dato. Lo stato del
 * pagamento dopo un rimborso dice cosa e' TORNATO, non cosa era ARRIVATO.
 *
 * Quello che resta fuori e' il caso di R84: l'ordine mai consegnato — fermo per
 * strada, annullato — su cui nessuno ha incassato niente.
 */
export function contantiIncassati(ordine: OrdineDaRimborsare): boolean {
  if (ordine.cash_confirmed_at) return true;
  if (ordine.delivery_status === 'DELIVERED') return true;
  return ordine.payment_status === 'PAID';
}

export type Rimborsabile =
  | { massimoCents: number; perche: 'ok' }
  | { massimoCents: 0; perche: 'gia-rimborsato' | 'nessun-incasso' };

/**
 * ① QUANTO SI PUO' RESTITUIRE (R84).
 *
 * Sulla carta: il lordo meno quello che e' gia' tornato indietro. Sui contanti
 * c'e' una domanda in piu', che prima nessuno faceva: i soldi sono arrivati?
 *
 * Il caso vero: un ordine in contanti da 24 € non viene consegnato, il cliente
 * apre un reclamo, l'amministratore lo chiude a suo favore scrivendo 24 nel
 * campo rimborso. Nessuno aveva incassato niente, e il cliente riceveva 24 € di
 * credito MyCity spendibile. Soldi nati dal nulla, che la cassa non vedeva.
 *
 * Adesso si restituisce solo quello che il cliente ha dato davvero, e solo su
 * un ordine che si e' concluso con l'incasso:
 *  · i contanti, se il fattorino o il negozio li hanno incassati;
 *  · il credito MyCity speso sull'ordine, se l'ordine e' stato incassato e NON
 *    e' stato annullato.
 *
 * Collaudo del 15/10 — IL CREDITO DI UN ORDINE FERMO LO RESTITUISCE L'ANNULLO,
 * E SOLO LUI. Prima qui il credito speso contava anche su un ordine fermo non
 * ancora annullato. Due mosse normali di un amministratore onesto bastavano a
 * crearlo dal nulla: chiudere il reclamo con l'importo massimo che il pannello
 * mostrava (il credito), poi annullare l'ordine fermo. L'annullo
 * (`lib/ordini/annulla.ts`, il rifiuto del negozio, il giro degli ordini fermi)
 * restituisce `wallet_applied_cents` senza sapere del reclamo: 10 € spesi, 20 €
 * tornati. Su un ordine che non si e' concluso i soldi del cliente stanno
 * ancora tutti sull'ordine, e la strada per ridarglieli e' una sola:
 * annullarlo. Cosi' il credito torna una volta, da qualunque parte si cominci.
 */
/**
 * Quello che il cliente di un ordine in contanti ha dato davvero, diviso per
 * mezzo: il credito MyCity speso e i contanti — tutti e due solo se l'ordine e'
 * stato incassato, e il credito solo se l'annullo non l'ha gia' restituito.
 *
 * Credito e contanti si leggono dall'ordine (`wallet_applied_cents`,
 * `total_price`). Senza la colonna del lordo (124) il lordo e' la sola cassa, e
 * scalarci sopra il credito avrebbe scambiato i contanti per credito: su 30 € in
 * contanti e 20 di credito, un rimborso di 30 € diventava 20 di credito e 10
 * col bonifico, invece di 12 e 18 come con la 124.
 */
export function versatoInContanti(ordine: OrdineDaRimborsare): { creditoCents: number; contantiCents: number } {
  const lordo = lordoDellOrdine(ordine);
  const walletSpeso = Math.max(0, Math.round(Number(ordine.wallet_applied_cents ?? 0)));
  const conLordo = ordine.gross_total_cents != null;
  const credito = conLordo ? Math.min(lordo, walletSpeso) : walletSpeso;
  const contanti = conLordo ? lordo - credito : Math.max(0, Math.round(Number(ordine.total_price ?? 0) * 100));
  const incassato = contantiIncassati(ordine);
  const annullato = ordine.delivery_status === 'CANCELED';
  return {
    creditoCents: incassato && !annullato ? credito : 0,
    contantiCents: incassato ? contanti : 0,
  };
}

export function quantoSiPuoRestituire(ordine: OrdineDaRimborsare): Rimborsabile {
  const lordo = lordoDellOrdine(ordine);
  const giaRimborsato = Math.max(0, Math.round(Number(ordine.refunded_amount_cents ?? 0)));

  let versato = lordo;
  if (pagatoInContanti(ordine)) {
    const { creditoCents, contantiCents } = versatoInContanti(ordine);
    // Mai oltre il lordo: e' il tetto che il database mette ai rimborsi.
    versato = Math.min(lordo, creditoCents + contantiCents);
    if (versato === 0) return { massimoCents: 0, perche: 'nessun-incasso' };
  }

  const residuo = Math.max(0, versato - giaRimborsato);
  if (residuo === 0) return { massimoCents: 0, perche: 'gia-rimborsato' };
  return { massimoCents: residuo, perche: 'ok' };
}

/** Il motivo, in parole che chi decide capisce, per cui non resta niente da restituire. */
export function motivoNienteDaRestituire(perche: 'gia-rimborsato' | 'nessun-incasso'): string {
  if (perche === 'nessun-incasso') {
    return (
      "Su questo ordine in contanti non è stato incassato niente: non c'è un pagamento da restituire. " +
      "Se l'ordine non è arrivato, annullalo: l'annullo restituisce da solo, una volta sola, il credito MyCity eventualmente usato."
    );
  }
  return 'Questo ordine è già stato rimborsato per intero: non resta niente da restituire.';
}

/**
 * ② IN CHE MODO TORNA IL RIMBORSO (R71).
 *
 * L'articolo 56 del Codice del Consumo vuole il rimborso con lo stesso mezzo
 * usato per pagare, salvo che il cliente abbia «espressamente convenuto
 * altrimenti».
 *
 *  · Carta → sulla carta.
 *  · Contanti → il mezzo che si puo' restituire a distanza e' il bonifico. Il
 *    credito MyCity arriva SOLO se il cliente l'ha scelto lui, nel modulo di
 *    reso: qualunque altra cosa — nessuna scelta, una scelta che non si e'
 *    potuta leggere, una migrazione non ancora applicata — vale bonifico.
 *  · La parte pagata col CREDITO MyCity torna credito, sempre: e' il suo stesso
 *    mezzo. Mandarla col bonifico trasformerebbe in soldi veri un credito che
 *    magari era un premio (punti, inviti): ordini con 20 € di credito regalato,
 *    restituisci, ricevi 20 € sul conto.
 *
 * Su un ordine pagato in parte col credito il rimborso si divide in proporzione
 * a quello che il cliente ha dato con ciascun mezzo. Ordine da 50 €: 20 di
 * credito e 30 in contanti incassati. Rimborso di 10 € → 4 di credito e 6 col
 * bonifico (o 10 di credito, se il cliente ha scelto il credito).
 */
export type TipoDiPagamento = 'carta' | 'contanti';

/** Carta, contanti, oppure `null`: un ordine che non si rimborsa in nessun modo. */
export function tipoDiPagamento(ordine: OrdineDaRimborsare): TipoDiPagamento | null {
  if (ordine.stripe_payment_intent) return 'carta';
  if (ordine.payment_method === 'cod') return 'contanti';
  return null;
}

export interface RipartoDelRimborso {
  modo: ModoDelRimborso;
  /** Va sulla carta (solo ordini con carta). */
  cartaCents: number;
  /** Torna come credito MyCity, accreditato subito. */
  creditoCents: number;
  /** Va pagato col bonifico, a mano, da chi amministra. */
  bonificoCents: number;
  /** Vero se una parte va a credito per scelta del cliente, non perche' era credito. */
  creditoScelto: boolean;
}

export function ripartoDelRimborso(
  ordine: OrdineDaRimborsare,
  importoCents: number,
  sceltaDelCliente?: SceltaContanti | null,
): RipartoDelRimborso | null {
  const tipo = tipoDiPagamento(ordine);
  if (!tipo) return null;
  const importo = Math.max(0, Math.round(importoCents));
  if (tipo === 'carta') {
    return { modo: 'carta', cartaCents: importo, creditoCents: 0, bonificoCents: 0, creditoScelto: false };
  }

  const { creditoCents: creditoVersato, contantiCents } = versatoInContanti(ordine);
  const versato = creditoVersato + contantiCents;
  const parteDelCredito = versato > 0 ? Math.round((importo * creditoVersato) / versato) : 0;
  const parteDeiContanti = importo - parteDelCredito;
  const creditoScelto = sceltaDelCliente === 'CREDITO' && parteDeiContanti > 0;

  const creditoCents = parteDelCredito + (sceltaDelCliente === 'CREDITO' ? parteDeiContanti : 0);
  const bonificoCents = importo - creditoCents;
  const modo: ModoDelRimborso = bonificoCents === 0 ? 'credito' : creditoCents === 0 ? 'bonifico' : 'misto';
  return { modo, cartaCents: 0, creditoCents, bonificoCents, creditoScelto };
}

/**
 * Collaudo del 15/10, terzo giro — CHI DECIDE UN RECLAMO VEDE LA DIVISIONE PRIMA.
 *
 * Su un ordine da 50 € (20 di credito MyCity, 30 in contanti) chi amministra
 * scrive 30 € pensando ai contanti. `ripartoDelRimborso` li divide in
 * proporzione: 12 € tornano come credito e 18 € col bonifico. Il pannello lo
 * diceva solo dopo, nell'avviso del bonifico da fare. Qui si calcola con la
 * stessa regola e la stessa scelta della rotta dei reclami (bonifico).
 * Restituisce la frase, o `null` quando non c'e' niente da dividere.
 *
 * Riesame del 16/10, quarto giro — OLTRE IL MASSIMO NON SI DIVIDE NIENTE.
 * Qui la cifra si tagliava al rimborsabile e si descriveva la divisione del
 * taglio: con 10 € rimborsabili e 30 scritti, la frase diceva «Di 10,00 €, 4,00
 * tornano come credito…», mentre la rotta dei reclami (resolve) rifiuta con un
 * errore qualunque cifra sopra il massimo. Chi decide leggeva la descrizione di
 * un rimborso che non sarebbe partito. Adesso, sopra il massimo, la frase dice
 * questo e basta — per qualunque ordine, come la rotta. Sotto il massimo, la
 * divisione resta quella che `refundOrder` usera'.
 */
export function comeSiDivideIlReclamo(ordine: OrdineDaRimborsare, importoCents: number): string | null {
  const importo = Math.round(importoCents);
  if (!(importo > 0)) return null;
  const rimborsabile = quantoSiPuoRestituire(ordine);
  // Niente da restituire: il riquadro sopra il campo lo dice gia' (`pagamentoPerChiDecide`).
  if (rimborsabile.perche !== 'ok') return null;
  if (importo > rimborsabile.massimoCents) {
    return (
      `Supera il rimborsabile: al massimo ${formatPriceFromCents(rimborsabile.massimoCents)}. ` +
      'Con questa cifra il reclamo non si chiude.'
    );
  }
  const riparto = ripartoDelRimborso(ordine, importo, 'BONIFICO');
  if (!riparto || riparto.modo !== 'misto') return null;
  return (
    `Di ${formatPriceFromCents(importo)}, ${formatPriceFromCents(riparto.creditoCents)} tornano come credito MyCity ` +
    `(la parte pagata col credito) e ${formatPriceFromCents(riparto.bonificoCents)} col bonifico.`
  );
}

/**
 * ③ COSA SCRIVERE SULL'ORDINE QUANDO SI CHIUDE UN RECLAMO (R76).
 *
 * 'LOST' toglie l'ordine dal giro dei bonifici al negozio PER SEMPRE: nessuna
 * strada lo riporta indietro. Si scrive solo se il cliente e' stato rimborsato
 * dell'intero ordine, e il verdetto «intero» lo da' chi ha mosso i soldi
 * (`refundOrder`, sul lordo), non un secondo conto fatto qui su un'altra base.
 *
 * Prima la rotta lo ricalcolava su `total_price`, che e' la cassa DOPO il
 * credito: su un ordine da 50 € pagato 20 di credito e 30 in contanti, un
 * rimborso dei 30 € di contanti era «parziale» per i soldi e «integrale» per il
 * reclamo. Il negozio perdeva i 18 € che gli restavano, senza avviso.
 */
export function statoDelReclamoSullOrdine(esito: {
  rimborsoEmesso: boolean;
  rimborsoPieno: boolean;
}): 'LOST' | 'RESOLVED' {
  return esito.rimborsoEmesso && esito.rimborsoPieno ? 'LOST' : 'RESOLVED';
}

/**
 * R84 — QUELLO CHE CHI DECIDE UN RECLAMO DEVE VEDERE PRIMA DI SCRIVERE UN IMPORTO.
 *
 * Il pannello dei reclami aveva solo un campo libero «Rimborso (€)»: non diceva
 * come aveva pagato il cliente, ne' se i contanti erano arrivati, ne' quanto si
 * poteva restituire. Qui c'e' la riga da mostrare, calcolata con la stessa
 * regola che poi applica chi muove i soldi.
 */
export function pagamentoPerChiDecide(ordine: OrdineDaRimborsare): {
  comeHaPagato: string;
  massimoCents: number;
  avviso: string | null;
} {
  const tipo = tipoDiPagamento(ordine);
  const rimborsabile = quantoSiPuoRestituire(ordine);
  let comeHaPagato = 'Nessun pagamento rimborsabile';
  if (tipo === 'carta') comeHaPagato = 'Carta';
  if (tipo === 'contanti') {
    const credito = Math.max(0, Math.round(Number(ordine.wallet_applied_cents ?? 0)));
    comeHaPagato =
      `Contanti alla consegna, ${contantiIncassati(ordine) ? 'incassati' : 'NON incassati'}` +
      (credito > 0 ? ` (più ${formatPriceFromCents(credito)} di credito MyCity)` : '');
  }
  return {
    comeHaPagato,
    massimoCents: rimborsabile.massimoCents,
    avviso: rimborsabile.perche === 'ok' ? null : motivoNienteDaRestituire(rimborsabile.perche),
  };
}

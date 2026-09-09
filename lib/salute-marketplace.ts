/**
 * I RIQUADRI «SALUTE DEL MARKETPLACE»: UN RAPPORTO SENZA DENOMINATORE NON VALE ZERO.
 *
 * ── Il difetto che ha prodotto questo file ───────────────────────────────────
 * La Panoramica dell'amministratore calcolava il tasso di consegna così:
 *
 *     const fulfillmentRate = closedOrders > 0 ? (delivered / closedOrders) * 100 : 0;
 *     const fulfillmentLow  = fulfillmentRate > 0 && fulfillmentRate < 95;
 *
 * Due righe, due errori che si tengono per mano. La prima schiaccia «non ho
 * niente da contare» dentro il numero zero. La seconda prova a recuperare la
 * distinzione persa guardando il RISULTATO — `> 0` — e finisce per spegnere
 * l'avviso proprio nel caso peggiore.
 *
 * Il conto di quel `> 0`: al 94% l'avviso rosso «verifica gli ordini bloccati»
 * compare, all'1% compare, allo 0% no. Dieci ordini lavorati e nessuno
 * consegnato — nessun fattorino sta prendendo i giri — e la Panoramica mostra
 * un riquadro «0,0%» e nessun avviso. Peggiore la situazione, meno avvisi.
 *
 * ── La regola, ed è già di casa ──────────────────────────────────────────────
 * Gli stati sono TRE, non due: **non letto · letto e vuoto · letto e pieno**.
 * È la stessa di `lib/stato-vista.ts` e di `lib/letture-cruscotto.ts`, e qui non
 * viene riscritta: `statoDellaVista` la decide, con `chiusi` come «quanti
 * elementi ho su cui posso calcolare qualcosa».
 *
 * Ripetuto con altre parole: «zero per cento» è un'affermazione sul mondo —
 * *ho guardato, e su quello che c'era non è arrivato niente a destinazione* — e
 * non si può fare quando non c'è niente da guardare. Senza ordini lavorati il
 * riquadro scrive «—», non «0,0%»; con ordini lavorati e zero consegne scrive
 * «0,0%» E l'avviso, che è il giorno in cui serve di più.
 *
 * Lo stesso vale per gli altri due rapporti della fascia (valore medio
 * dell'ordine, tasso di annullamento): passano da `rapporto`, che su
 * denominatore vuoto risponde `null` — «non lo so» — e mai zero. È lo stesso
 * `null` che `lib/pagamenti/tasso-autorizzazione.ts` restituisce da sempre
 * quando nessuno ha ancora provato a pagare: quella lezione, questa fascia non
 * l'aveva ricevuta.
 *
 * 🟢 Puro: nessuna rete, nessun React, nessun orologio. Una prova lo ESEGUE.
 */

import { NON_LETTO, type Targhetta } from './letture-cruscotto';
import { statoDellaVista } from './stato-vista';
import { formatPrice } from './format';

/** Sotto questa quota di consegne riuscite il pannello lo deve dire. */
export const OBIETTIVO_CONSEGNA = 0.95;

/** L'obiettivo come si scrive a schermo: «95%». Un numero solo, in un posto solo. */
export const OBIETTIVO_CONSEGNA_TESTO = `${Math.round(OBIETTIVO_CONSEGNA * 100)}%`;

/**
 * Una divisione che si rifiuta di rispondere quando il denominatore non c'è.
 *
 * Vale sia per una quota (consegnati su lavorati, da 0 a 1) sia per una media
 * (incassato su ordini consegnati, in euro): la regola è la stessa.
 *
 * È il cuore della faccenda: `x / 0` non fa zero, non fa niente. Chi scrive
 * `denominatore > 0 ? x / denominatore : 0` sta dicendo «se non ho dati,
 * rispondo zero», e da lì in poi nessuno può più distinguere le due cose.
 */
export function rapporto(numeratore: number, denominatore: number): number | null {
  if (!Number.isFinite(numeratore) || !Number.isFinite(denominatore)) return null;
  if (denominatore <= 0) return null;
  return numeratore / denominatore;
}

/** Una quota (0-1) come si legge a schermo: «94,0%». `null` diventa «—». */
export function percentualeATesto(quota: number | null): string {
  if (quota === null) return NON_LETTO;
  return `${(quota * 100).toFixed(1).replace('.', ',')}%`;
}

/** Un importo come si legge a schermo. `null` diventa «—», non «0,00 €». */
export function euroATesto(valore: number | null): string {
  return valore === null ? NON_LETTO : formatPrice(valore);
}

/** Quello che si sa delle consegne quando si disegna il riquadro. */
export interface LetturaConsegne {
  /** La lettura è arrivata? Finché è `false` non si afferma niente. */
  letto: boolean;
  /** La lettura è fallita. Un guasto batte tutto: non si scrive una percentuale su un buco. */
  errore?: unknown;
  /** Ordini consegnati. */
  consegnati: number;
  /** Ordini che hanno passato la preparazione: il denominatore vero. */
  chiusi: number;
}

export interface VerdettoConsegne extends Targhetta {
  /** Da 0 a 1. `null` quando non c'è niente da contare: non è zero, è «non lo so». */
  tasso: number | null;
  /**
   * La frase dell'avviso, oppure `null` quando non c'è niente da segnalare.
   * Il rimando agli Ordini lo aggiunge la pagina: qui sta la diagnosi, non il link.
   */
  avviso: string | null;
}

/** La riga che ammette il guasto, con le stesse parole del cruscotto del venditore. */
const NON_LETTO_NOTA = 'Non sono riuscito a leggerlo';

export function verdettoConsegne(l: LetturaConsegne): VerdettoConsegne {
  // I tre stati non li decide questo file: li decide la regola di casa.
  // `chiusi` è «quanti ordini ho su cui posso dire qualcosa».
  const vista = statoDellaVista({ letto: l.letto, errore: l.errore, quanti: l.chiusi });

  // ① NON L'HO LETTO. Nessuna percentuale: sarebbe un numero inventato.
  if (vista.stato === 'rotto' || vista.stato === 'carico') {
    return {
      tasso: null,
      valore: NON_LETTO,
      nota: vista.mostraErrore ? NON_LETTO_NOTA : 'lettura in corso',
      guasto: vista.mostraErrore,
      avviso: null,
    };
  }

  // ② HO LETTO, E NON C'È ANCORA NIENTE DA CONTARE. Un marketplace senza
  // ordini lavorati non ha un tasso di consegna dello zero per cento: non ce
  // l'ha. Gridare qui vorrebbe dire gridare il primo giorno, e un avviso che
  // grida sempre si impara a ignorare.
  if (vista.stato === 'vuoto') {
    return {
      tasso: null,
      valore: NON_LETTO,
      nota: 'nessun ordine ancora lavorato',
      guasto: false,
      avviso: null,
    };
  }

  // ③ HO LETTO E HO DA CONTARE. Qui `chiusi > 0`, quindi il rapporto esiste.
  const tasso = rapporto(l.consegnati, l.chiusi) ?? 0;
  const sotto = tasso < OBIETTIVO_CONSEGNA;

  return {
    tasso,
    valore: percentualeATesto(tasso),
    nota: `obiettivo ≥ ${OBIETTIVO_CONSEGNA_TESTO}`,
    guasto: false,
    avviso: !sotto
      ? null
      : l.consegnati === 0
        ? // Il caso che prima restava muto, e che adesso è quello che parla più forte.
          l.chiusi === 1
          ? 'L\'unico ordine lavorato non risulta consegnato'
          : `Nessuno dei ${l.chiusi} ordini lavorati risulta consegnato`
        : 'Il tasso di consegna è sotto l\'obiettivo',
  };
}

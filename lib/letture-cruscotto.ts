/**
 * UNA LETTURA FALLITA NON È UNO ZERO — chi lo decide sta qui.
 *
 * ── Il difetto che ha prodotto questo file ───────────────────────────────────
 * Il cruscotto del venditore fa sei letture in parallelo e ne guardava UNA.
 * `if (ordiniRes.error) throw ordiniRes.error` era l'unico controllo del file:
 * le righe d'ordine, le recensioni e i due conteggi dei prodotti avevano
 * `?? 0` e `?? []` e basta. Se la funzione `store_review_stats` spariva — un
 * permesso tolto, una migrazione non applicata, il database che risponde male
 * per dieci secondi — la targhetta scriveva «—» e sotto «Nessuna recensione»,
 * cioè ESATTAMENTE quello che vede un negozio appena aperto. Stessa cosa per
 * «0 articoli venduti».
 *
 * È la prima schermata che il negoziante apre la mattina. Gli dice che nessuno
 * l'ha recensito e che non ha venduto niente, e non ha nessun modo di sapere
 * che invece nessuno è andato a guardare. Fra i due errori possibili, il sito
 * sceglieva sempre quello che fa male: affermare invece di ammettere.
 *
 * ── La regola, ed è la stessa di `lib/stato-vista.ts` ────────────────────────
 * Gli stati sono TRE, non due: **letto e pieno · letto e vuoto · non letto**.
 * «Vuoto» è un'affermazione sul mondo — *ho guardato e non c'è niente* — e non
 * si può fare prima di aver guardato. Qui la regola arriva fino alla targhetta:
 * si passa la risposta del database e si riceve QUELLO CHE VA SCRITTO A
 * SCHERMO, numero e riga piccola. La pagina non ha più un ramo da scrivere a
 * mano, quindi non ha più un ramo da dimenticare — ed è per questo che non
 * bastava mettere tre `if` in più dentro il componente: il quarto sarebbe
 * mancato di nuovo, e dentro un componente nessuna prova può eseguirlo.
 *
 * 🟢 Puro: nessuna rete, nessun React, nessun orologio. Una prova lo ESEGUE.
 */

import type { FinestraTotali } from './metriche-venditore';
import { etichettaFinestra } from './metriche-venditore';

/**
 * La parte di una risposta di Supabase che serve per sapere se è andata.
 *
 * Le altre chiavi — `data`, `count`, `status` — ci sono e non ci interessano:
 * la domanda qui è una sola, e tenerla stretta è il punto.
 */
export type Lettura = {
  error?: unknown;
  data?: unknown;
  count?: number | null;
  status?: number;
};

/** Quando un numero non l'abbiamo potuto leggere, a schermo va questo. */
export const NON_LETTO = '—';

/**
 * Una lettura è riuscita solo se ha risposto E non porta un errore.
 *
 * Il `null` non è una formalità: `Promise.all` restituisce quello che le hanno
 * dato, e una riga tolta dall'elenco lascia un buco. Un buco non è un dato.
 */
export function letturaRiuscita(res: Lettura | null | undefined): boolean {
  if (res === null || res === undefined) return false;
  return res.error === null || res.error === undefined;
}

/** I nomi delle letture fallite, nell'ordine in cui sono dichiarate. */
export function lettureFallite(letture: Record<string, Lettura | null | undefined>): string[] {
  return Object.keys(letture).filter((nome) => !letturaRiuscita(letture[nome]));
}

/** Cosa va scritto in una targhetta del cruscotto. */
export interface Targhetta {
  /** Il numero grosso. `—` quando non l'abbiamo potuto leggere. */
  valore: string;
  /** La riga piccola sotto. */
  nota: string;
  /**
   * Vero quando la riga piccola sta dicendo che una lettura è fallita, e non
   * che il dato vale zero. Serve al colore e al lettore di schermo: il trattino
   * da solo non dice niente a chi non vede.
   */
  guasto: boolean;
}

/** La riga che ammette il guasto: una sola, scritta una volta. */
const NON_LETTO_NOTA = 'Non sono riuscito a leggerlo';

/** La valutazione media e quante recensioni. */
export function targhettaValutazione(l: { letta: boolean; media: number; quante: number }): Targhetta {
  if (!l.letta) return { valore: NON_LETTO, nota: NON_LETTO_NOTA, guasto: true };
  return {
    valore: l.media > 0 ? `${l.media.toFixed(1).replace('.', ',')} ★` : NON_LETTO,
    nota: l.quante > 0 ? `${l.quante} recensioni` : 'Nessuna recensione',
    guasto: false,
  };
}

/**
 * Gli articoli venduti negli ultimi trenta giorni.
 *
 * 6/9/2026 — questa targhetta diceva «Dall'inizio» mentre contava mille righe
 * scelte dal server: da allora dichiara la finestra che ha davvero letto. È il
 * precedente da cui nasce anche `targhettaNetto` qui sotto, che quella lezione
 * non l'aveva ricevuta.
 *
 * `troncato` vuol dire che il tetto delle righe è stato toccato: allora il
 * numero è un «almeno», e a schermo si scrive come tale.
 */
export function targhettaArticoli(l: { letta: boolean; quanti: number; troncato: boolean }): Targhetta {
  if (!l.letta) return { valore: NON_LETTO, nota: NON_LETTO_NOTA, guasto: true };
  return {
    valore: l.troncato ? `${l.quanti}+` : String(l.quanti),
    nota: l.troncato ? 'Ultimi 30 giorni · almeno' : 'Ultimi 30 giorni',
    guasto: false,
  };
}

/** Quanti prodotti sono in vendita, su quanti ne ha in tutto. */
export function targhettaProdotti(l: { letta: boolean; disponibili: number; totali: number }): Targhetta {
  if (!l.letta) return { valore: NON_LETTO, nota: NON_LETTO_NOTA, guasto: true };
  return {
    valore: String(l.disponibili),
    nota: `su ${l.totali} totali`,
    guasto: false,
  };
}

/**
 * «IL TUO NETTO», CHE ADESSO DICE CHE PERIODO COPRE.
 *
 * Stava di fianco ad «Articoli venduti», che la sua finestra la dichiara
 * («Ultimi 30 giorni»), e lui no. E non era una dimenticanza da poco: lo stesso
 * riquadro vale *dall'inizio* quando `numeri_del_negozio` risponde e sa dei
 * rimborsi, e *ultimi 30 giorni* quando ripiega sul conto del browser — cioè
 * oggi, sempre, perché quella funzione i rimborsi non li espone ancora. Due
 * grandezze diverse, la stessa scritta, e nessun modo di accorgersene: il
 * negoziante confronta il numero di lunedì con quello di martedì e non sa che
 * il metro è cambiato.
 *
 * Adesso la finestra arriva insieme al numero — la decide `totaliDiSempre` — e
 * qui finisce nella riga sotto, con le stesse parole del riquadro accanto.
 */
export function targhettaNetto(l: {
  netto: string;
  incassato: string;
  finestra: FinestraTotali;
}): Targhetta {
  return {
    valore: l.netto,
    nota: `su ${l.incassato} incassati · ${etichettaFinestra(l.finestra)}`,
    guasto: false,
  };
}

/** Come si chiamano, in italiano, le letture che il cruscotto fa. */
const NOMI_LETTURE: Record<string, string> = {
  prodotti: 'quanti prodotti hai',
  disponibili: 'quanti prodotti sono in vendita',
  righe: 'gli articoli venduti',
  recensioni: 'le recensioni',
};

/** Un elenco all'italiana: «a, b e c». */
export function elenco(voci: string[]): string {
  if (voci.length <= 1) return voci[0] ?? '';
  return `${voci.slice(0, -1).join(', ')} e ${voci[voci.length - 1]}`;
}

/**
 * L'avviso da mettere sopra le targhette quando una parte della pagina non è
 * arrivata. `null` quando è andato tutto bene.
 *
 * Non è un doppione delle targhette: il trattino dice «questo numero no», ma
 * solo se lo stai guardando. Questo dice all'intera pagina di che cosa non
 * fidarsi, e — cosa che prima non esisteva da nessuna parte — che si può
 * riprovare.
 */
export function avvisoLettureFallite(fallite: string[]): { titolo: string; dettaglio: string } | null {
  const nomi = fallite.map((f) => NOMI_LETTURE[f] ?? f);
  if (nomi.length === 0) return null;
  return {
    titolo: `Non sono riuscito a leggere ${elenco(nomi)}.`,
    dettaglio: 'Non vuol dire che il dato non ci sia: vuol dire che non l\'ho potuto guardare. Il resto della pagina è vero.',
  };
}

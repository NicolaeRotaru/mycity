import {
  FREE_SHIPPING_THRESHOLD,
  PICKUP_DISCOUNT_PERCENT,
  RITIRO_IN_NEGOZIO_ATTIVO,
} from './constants';
import { EXPRESS_ETA_LABEL } from './delivery';

/**
 * LE PROMESSE PUBBLICHE — quelle scritte nelle pagine, derivate da chi le mantiene.
 *
 * ── Il difetto che ha prodotto questo file ───────────────────────────────────────────────────
 * Le pagine FAQ e Spedizioni promettevano tre cose che il sito non fa:
 *
 *   ① «Ritiro in negozio, e ottieni il 10% di sconto: selezionalo al checkout».
 *      Al checkout quel blocco è dentro `RITIRO_IN_NEGOZIO_ATTIVO`, che vale `false`. Le due rotte
 *      che creano l'ordine forzano `pickupInStore = false`. L'opzione non esiste, e nella FAQ c'è
 *      perfino l'istruzione per selezionarla.
 *   ② «Se il negozio è chiuso, l'ordine parte alla riapertura e te lo diciamo prima che tu paghi».
 *      Le due rotte fanno l'opposto: se il negozio è chiuso rifiutano con un conflitto. Nessun
 *      ordine viene messo in coda.
 *   ③ «30-60 minuti», scritto a mano in quattro punti mentre `EXPRESS_ETA_LABEL` esiste dal giorno
 *      in cui qualcuno ha deciso quel numero.
 *
 * ── Perché un file e non tre correzioni di testo ────────────────────────────────────────────
 * Perché correggere il testo lascia in piedi il meccanismo: la funzione ha un interruttore, la
 * frase che la promette non lo legge, e le due si separano il giorno dopo. `RITIRO_IN_NEGOZIO_ATTIVO`
 * esiste già ed è letto dal checkout, dalle due rotte e dalla pagina di amministrazione — cioè da
 * tutti tranne che dalle pagine che lo promettono ai clienti.
 *
 * Qui le promesse NASCONO dagli stessi interruttori. Riaccendere il ritiro fa ricomparire la FAQ e
 * il riquadro da sé; spegnerlo li fa sparire. Non c'è più un testo da ricordarsi di aggiornare.
 *
 * 🟢 Puro: nessuna rete, nessun orologio. Una prova lo ESEGUE con gli interruttori nei due versi.
 */

export interface DomandaRisposta {
  q: string;
  a: string;
}

/**
 * Le promesse sul RITIRO IN NEGOZIO. Elenco vuoto quando la funzione è spenta: una promessa che
 * nessuno può accettare non è un'informazione in meno, è una bugia in più.
 */
export function promesseRitiroInNegozio(
  attivo: boolean = RITIRO_IN_NEGOZIO_ATTIVO,
  scontoPercento: number = PICKUP_DISCOUNT_PERCENT,
): DomandaRisposta[] {
  if (!attivo) return [];
  // Lo sconto è un secondo interruttore, e vale zero (`PICKUP_DISCOUNT_PERCENT = 0`): la FAQ ne
  // prometteva il 10%. Se un giorno il ritiro si riaccende senza sconto, la promessa non deve
  // resuscitare la percentuale — nasce da quel numero, e a zero non si nomina.
  const sconto = scontoPercento > 0 ? `, e ottieni il ${scontoPercento}% di sconto` : '';
  return [
    {
      q: 'Posso ritirare in negozio?',
      a: `Sì${sconto}. Seleziona "Ritiro in negozio" al checkout: ti avviseremo appena l'ordine sarà pronto.`,
    },
  ];
}

/** Il riquadro «Ritiro in negozio» della pagina Spedizioni, o niente se la funzione è spenta. */
export function riquadroRitiroInNegozio(
  attivo: boolean = RITIRO_IN_NEGOZIO_ATTIVO,
  scontoPercento: number = PICKUP_DISCOUNT_PERCENT,
): { titolo: string; sottotitolo: string } | null {
  if (!attivo) return null;
  return {
    titolo: 'Ritiro in negozio',
    sottotitolo: scontoPercento > 0 ? `${scontoPercento}% di sconto sull'ordine` : 'Niente spese di spedizione',
  };
}

/**
 * Cosa succede se il negozio è chiuso — e la risposta è quella che danno le rotte, non quella che
 * faceva più piacere leggere.
 *
 * Il codice che decide (`app/api/orders/cod/route.ts` e `app/api/stripe/checkout/route.ts`) su
 * negozio chiuso risponde con un conflitto: «<negozio> è chiuso in questo momento. Riprova durante
 * gli orari di apertura». Quindi la promessa pubblica dice la stessa cosa.
 */
export const NEGOZIO_CHIUSO_COSA_SUCCEDE =
  "Se il negozio è chiuso non puoi ordinare in quel momento: l'ordine non parte e non viene messo in coda. Torna negli orari di apertura, che trovi sulla pagina del negozio.";

/** La risposta sui tempi di consegna, col numero preso da dove è deciso. */
export function rispostaTempiDiConsegna(): DomandaRisposta {
  return {
    q: "In quanto tempo arriva l'ordine?",
    a: `In ${EXPRESS_ETA_LABEL} dalla conferma del negozio, nei comuni serviti e negli orari di apertura del negozio. ${NEGOZIO_CHIUSO_COSA_SUCCEDE}`,
  };
}

/** La riga sulla spedizione gratuita, con la soglia presa da dove è decisa. */
export function rispostaCostoSpedizione(): DomandaRisposta {
  return {
    q: 'Quanto costa la spedizione?',
    a: `La spedizione è GRATUITA per ordini sopra €${FREE_SHIPPING_THRESHOLD} dallo stesso venditore — la soglia vale per ciascun negozio, non sul totale del carrello. Sotto soglia il costo varia in base alla distanza dal negozio (in media €2,50–4,50). Vedi tutti i dettagli nella pagina Spedizioni.`,
  };
}

/**
 * COSA SI PUÒ PAGARE E QUANDO — e la promessa dice quello che offre il checkout.
 *
 * Il claim scritto a mano era: «Puoi pagare alla consegna — carta o contanti, decidi tu», sulla
 * scheda prodotto (l'ultimo schermo prima di aggiungere al carrello) e nel carrello.
 *
 * Al checkout le opzioni sono due e diverse: **carta adesso**, uscendo dal sito su Stripe, oppure
 * **contanti al rider**. La carta alla consegna non esiste. Chi si è fidato proprio perché non
 * voleva anticipare i soldi lo scopre alla cassa, dopo aver riempito il carrello e scritto
 * l'indirizzo — cioè nel punto in cui abbandonare costa di più.
 *
 * Qui la frase nasce dall'elenco dei metodi. Aggiungerne uno cambia la promessa da sé.
 */
export type MetodoPagamento = 'carta-adesso' | 'contanti-alla-consegna';

export const METODI_AL_CHECKOUT: readonly MetodoPagamento[] = Object.freeze([
  'carta-adesso',
  'contanti-alla-consegna',
]);

export function frasePagamento(metodi: readonly MetodoPagamento[] = METODI_AL_CHECKOUT): string {
  const contanti = metodi.includes('contanti-alla-consegna');
  const carta = metodi.includes('carta-adesso');
  if (contanti && carta) return 'Paghi in contanti alla consegna, oppure con carta adesso';
  if (contanti) return 'Paghi in contanti alla consegna';
  if (carta) return 'Paghi con carta adesso';
  return 'Metodi di pagamento in aggiornamento';
}

/**
 * IL RESO — «gratuito» era vero solo per il difetto di conformità, non per il ripensamento.
 *
 * La scheda prodotto prometteva «Reso gratuito entro 14 giorni» su ogni prodotto. La pagina resi
 * dice l'opposto in due punti: «Cambio idea: le spese di restituzione sono a tuo carico», e i
 * prodotti deperibili — cioè il cuore di un marketplace di negozi di quartiere — sono esclusi.
 * Carrello e checkout scrivevano già la versione onesta: la scheda prodotto era l'unica a promettere
 * la gratuità, ed è l'ultimo schermo prima dell'acquisto.
 */
export const FRASE_RESO = 'Reso entro 14 giorni';

/**
 * IL RIQUADRO «LO SAPEVI?» DEL CARRELLO — la frase che non reggeva i numeri sopra di sé.
 *
 * Diceva: «Niente intermediari, niente commissioni nascoste». Stava nella colonna del riepilogo,
 * poche righe sotto la voce che addebita 3 € di «Consegna MyCity», su una piattaforma che trattiene
 * anche il 10% al negozio (`MARKETPLACE_FEE_BPS`, e la parte venditori lo scrive per esteso:
 * «Abbonamento €50/mese e commissione del 10% sulle vendite»).
 *
 * MyCity **è** l'intermediario, e la commissione c'è. La contraddizione si vedeva senza uscire dalla
 * pagina: il numero era venti righe sopra la frase. In un carrello la fiducia è l'unica leva, e una
 * frase smentita dalla riga sopra la toglie invece di darla.
 *
 * La versione onesta non rinuncia al vantaggio: dice quello vero — che il costo c'è ed è scritto lì.
 */
export const RIQUADRO_LO_SAPEVI =
  'Ogni euro di questo carrello va ai commercianti di Piacenza. La nostra parte è la consegna, ed è la riga qui sopra: nessun costo a sorpresa.';

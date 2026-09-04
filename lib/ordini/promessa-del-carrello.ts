import { FREE_SHIPPING_THRESHOLD } from '@/lib/constants';
import { promessaSpedizione, type PromessaSpedizione } from '@/lib/promesse-pubbliche';

/**
 * LA SPEDIZIONE PROMESSA A UN CARRELLO CON PIÙ NEGOZI.
 *
 * ── Il difetto che ha prodotto questa funzione ──────────────────────────────
 * In cassa la barra «Spedizione gratis» riceveva `grandSubtotal`, cioè la somma
 * di TUTTO il carrello. La soglia dei 30 € però vale per negozio:
 * `shippingForEuro` azzera la spedizione solo se il subtotale DI QUEL negozio
 * la supera, e la cassa la chiama una volta per gruppo.
 *
 * Coi numeri veri: 18 € dal fornaio più 18 € dal macellaio fanno 36, quindi la
 * barra scriveva «Spedizione gratis» — e due righe sotto il riepilogo
 * addebitava due spedizioni. Nel punto peggiore: l'ultimo schermo prima di
 * pagare, dove la sorpresa costa l'ordine.
 *
 * ── Perché una funzione e non il numero giusto passato a mano ───────────────
 * Perché `promessaSpedizione` prende UN numero e non sa da quanti negozi
 * arriva: chi la chiama deve ricordarsi di passargli il sottototale del
 * negozio. Il carrello se n'era ricordato, la cassa no — e domani tocca alla
 * mail di conferma. Qui la regola non è più affidata alla memoria: si entra con
 * l'elenco dei negozi, e un totale unico non ci passa nemmeno per sbaglio.
 *
 * ── La regola ───────────────────────────────────────────────────────────────
 * La frase la decide il negozio PIÙ LONTANO dalla soglia. Così «gratis» compare
 * solo quando nessun negozio del carrello paga la spedizione, cioè solo quando
 * è vero; e quando manca qualcosa, quello che manca è una cifra che serve
 * davvero ad arrivarci.
 *
 * ⚠️ Le parole restano di `promessaSpedizione`: qui non se ne scrive nessuna.
 *
 * 🟢 Pura: nessuna rete, nessun orologio.
 */
export type PromessaDelCarrello = {
  /** La frase da mostrare, decisa dalla casa unica sul negozio giusto. */
  promessa: PromessaSpedizione;
  /**
   * Il numero da dare alla barra `FreeShippingProgress`, che rifà la stessa
   * domanda a `promessaSpedizione`: passandole questo legge esattamente
   * `promessa`, e la barra avanza col negozio a cui manca di più.
   */
  sottototaleDellaBarra: number;
};

export function promessaSpedizioneDelCarrello(
  /** Il sottototale della merce di ciascun negozio, in euro. */
  sottototaliPerNegozio: number[],
  soglia: number = FREE_SHIPPING_THRESHOLD,
): PromessaDelCarrello {
  const validi = sottototaliPerNegozio.filter((s) => Number.isFinite(s));
  // Carrello vuoto: la promessa parte da zero, come prima.
  const negozioPiuLontano = validi.length === 0 ? 0 : Math.min(...validi);
  return {
    promessa: promessaSpedizione(negozioPiuLontano, soglia),
    sottototaleDellaBarra: negozioPiuLontano,
  };
}

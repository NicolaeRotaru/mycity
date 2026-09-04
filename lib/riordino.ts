'use client';

import { addToCart, clearCart, getCart, type CartItem } from '@/lib/cart';
import { confirmDialog } from '@/components/ConfirmDialog';
import { toast } from 'sonner';

/**
 * «Riordina», in un posto solo.
 *
 * Il difetto (#113). Il pulsante esisteva in quattro punti — dettaglio ordine,
 * elenco ordini, e due volte nella striscia in home — e tutti e quattro
 * facevano la stessa cosa: `clearCart()` e via. Due conseguenze, tutte e due
 * brutte.
 *
 * ① Il carrello veniva svuotato senza chiedere niente. Chi aveva dentro la
 *    spesa della settimana e cliccava «riordina» per curiosità la perdeva:
 *    nessun avviso, nessun modo di tornare indietro.
 * ② Gli articoli rientravano col prezzo del giorno dell'ordine (`unit_price`
 *    storico). Il cliente vedeva il totale vecchio e al momento di pagare ne
 *    trovava un altro — o, se il prezzo era sceso, credeva di pagare di più.
 *
 * Con una funzione sola la conferma non si può dimenticare nel quinto punto.
 */

export type ArticoloDaRiordinare = {
  productId: string;
  name: string;
  quantity: number;
  image?: string;
  sellerId?: string;
  storeName?: string;
  variantId?: string;
  variantLabel?: string;
  /** Prezzo pagato allora: usato solo se il prodotto non è più leggibile. */
  prezzoStorico: number;
};

async function prezziDiAdesso(ids: string[]): Promise<Map<string, number>> {
  const mappa = new Map<string, number>();
  if (ids.length === 0) return mappa;
  try {
    const { supabase } = await import('@/lib/supabase/client');
    const { data } = await supabase.from('products').select('id, price').in('id', Array.from(new Set(ids)));
    for (const p of (data ?? []) as Array<{ id: string; price: number | string | null }>) {
      const n = Number(p.price);
      if (Number.isFinite(n)) mappa.set(p.id, n);
    }
  } catch {
    /* senza rete si usano i prezzi storici: meglio un riordino che niente */
  }
  return mappa;
}

/**
 * 3/9/2026 — DUE TOCCHI METTEVANO NEL CARRELLO IL DOPPIO DELLA ROBA.
 *
 * Prima di aggiungere, `riordina` va a rileggere i prezzi di adesso sul
 * database: su un telefono lento sono qualche decimo di secondo in cui non si
 * vede succedere niente. Chi tocca una seconda volta — cosa normale quando lo
 * schermo non reagisce — faceva partire un secondo giro, e `addToCart` somma
 * alla quantità già presente. Maria riordinava due focacce e nel carrello ne
 * trovava quattro: per lei è il doppio da pagare, per il fornaio è merce
 * preparata e buttata.
 *
 * La cura non è un pulsante spento per mezzo secondo. Spegnere il pulsante
 * cura il punto in cui si è visto il danno: restavano gli altri tre pulsanti
 * «riordina» del sito, e il quinto che qualcuno aggiungerà domani. La cura è
 * qui, sull'azione: ripetere lo stesso riordino non aggiunge una seconda
 * volta. Il pulsante che si spegne resta — ma come cortesia, non come diga.
 *
 * Due tempi, perché il doppio tocco arriva in due modi:
 * ① il secondo tocco arriva MENTRE il primo sta ancora lavorando;
 * ② il secondo tocco arriva subito DOPO che il primo ha finito (su una rete
 *    veloce il primo giro dura 150 millesimi di secondo: il dito è più lento).
 */

/** Cosa rende «lo stesso riordino» uguale a se stesso: gli articoli e le quantità. */
function improntaDi(articoli: ArticoloDaRiordinare[]): string {
  return articoli
    .map((a) => `${a.productId}|${a.variantId ?? ''}|${a.quantity}`)
    .sort()
    .join(';');
}

/**
 * Per quanto tempo, dopo un riordino riuscito, ripetere lo stesso identico
 * riordino è considerato un dito che ha toccato due volte e non una seconda
 * intenzione.
 *
 * Cinque secondi. Dopo un riordino riuscito la pagina va al carrello: per
 * riordinare davvero una seconda volta lo stesso ordine bisogna tornare
 * indietro alla pagina dell'ordine, e non lo si fa in cinque secondi. Chi
 * vuole comunque il doppio ha lo stepper della quantità, dentro il carrello,
 * dove il totale si vede mentre cambia.
 */
export const FINESTRA_DOPPIO_TOCCO_MS = 5000;

/** Il riordino che sta girando adesso (la sua impronta), o niente. */
let inCorso: string | null = null;
/** L'ultimo riordino andato a buon fine: impronta e quando. */
let ultimoRiuscito: { impronta: string; quando: number } | null = null;

/**
 * Dice se questa richiesta è la ripetizione di un riordino appena fatto.
 * Funzione pura: la decisione si può provare senza toccare il carrello.
 */
export function eUnDoppioTocco(
  impronta: string,
  precedente: { impronta: string; quando: number } | null,
  adesso: number,
  finestraMs: number = FINESTRA_DOPPIO_TOCCO_MS,
): boolean {
  if (!precedente) return false;
  if (precedente.impronta !== impronta) return false;
  const passati = adesso - precedente.quando;
  // Un orologio che va indietro (cambio d'ora, sincronizzazione) darebbe un
  // numero negativo: resta dentro la finestra, che è il lato prudente.
  return passati < finestraMs;
}

/**
 * Rimette nel carrello gli articoli di un ordine.
 * Ritorna quanti articoli sono stati aggiunti (0 = annullato, niente da fare,
 * oppure secondo tocco sullo stesso riordino).
 */
export async function riordina(articoli: ArticoloDaRiordinare[]): Promise<number> {
  const validi = articoli.filter((a) => a.productId && a.name);
  if (validi.length === 0) {
    toast.error('Nessun prodotto di questo ordine è più disponibile.');
    return 0;
  }

  // Il guardiano. Fra il controllo e il segno non c'è nessun `await`: nessun
  // secondo giro può infilarsi in mezzo.
  const impronta = improntaDi(validi);
  if (inCorso === impronta) return 0;
  if (eUnDoppioTocco(impronta, ultimoRiuscito, Date.now())) return 0;
  inCorso = impronta;
  try {
    return await eseguiRiordino(validi, impronta);
  } finally {
    inCorso = null;
  }
}

async function eseguiRiordino(validi: ArticoloDaRiordinare[], impronta: string): Promise<number> {
  const carrelloAttuale: CartItem[] = getCart();
  let sostituisci = true;

  if (carrelloAttuale.length > 0) {
    // Due strade dette per nome. La conferma non è un «sei sicuro?»: dice cosa
    // succede al carrello che c'è adesso.
    sostituisci = await confirmDialog({
      title: 'Hai già qualcosa nel carrello',
      message: `Nel carrello ci sono ${carrelloAttuale.length} ${carrelloAttuale.length === 1 ? 'articolo' : 'articoli'}. Vuoi sostituirli con questo ordine, oppure aggiungerli?`,
      confirmLabel: 'Sostituisci',
      cancelLabel: 'Aggiungi',
    });
  }

  if (sostituisci && carrelloAttuale.length > 0) clearCart();

  const prezzi = await prezziDiAdesso(validi.map((a) => a.productId));
  let aggiunti = 0;
  let prezziCambiati = 0;

  for (const a of validi) {
    const adesso = prezzi.get(a.productId);
    if (adesso != null && Math.abs(adesso - a.prezzoStorico) >= 0.01) prezziCambiati += 1;
    addToCart({
      id: a.productId,
      name: a.name,
      price: adesso ?? a.prezzoStorico,
      image: a.image,
      quantity: a.quantity,
      sellerId: a.sellerId,
      storeName: a.storeName,
      variantId: a.variantId,
      variantLabel: a.variantLabel,
    });
    aggiunti += 1;
  }

  if (aggiunti === 0) {
    toast.error('Nessun prodotto di questo ordine è più disponibile.');
    return 0;
  }

  // Da qui in poi lo stesso riordino, ripetuto subito, non aggiunge di nuovo.
  ultimoRiuscito = { impronta, quando: Date.now() };

  toast.success(
    prezziCambiati > 0
      ? `${aggiunti} ${aggiunti === 1 ? 'articolo aggiunto' : 'articoli aggiunti'} · ${prezziCambiati === 1 ? 'un prezzo è cambiato' : `${prezziCambiati} prezzi sono cambiati`} dall'ultima volta`
      : `${aggiunti} ${aggiunti === 1 ? 'articolo aggiunto' : 'articoli aggiunti'} al carrello!`,
  );
  return aggiunti;
}

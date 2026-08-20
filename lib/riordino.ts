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
 * Rimette nel carrello gli articoli di un ordine.
 * Ritorna quanti articoli sono stati aggiunti (0 = annullato o niente da fare).
 */
export async function riordina(articoli: ArticoloDaRiordinare[]): Promise<number> {
  const validi = articoli.filter((a) => a.productId && a.name);
  if (validi.length === 0) {
    toast.error('Nessun prodotto di questo ordine è più disponibile.');
    return 0;
  }

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

  toast.success(
    prezziCambiati > 0
      ? `${aggiunti} ${aggiunti === 1 ? 'articolo aggiunto' : 'articoli aggiunti'} · ${prezziCambiati === 1 ? 'un prezzo è cambiato' : `${prezziCambiati} prezzi sono cambiati`} dall'ultima volta`
      : `${aggiunti} ${aggiunti === 1 ? 'articolo aggiunto' : 'articoli aggiunti'} al carrello!`,
  );
  return aggiunti;
}

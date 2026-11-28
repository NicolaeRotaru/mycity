/**
 * Gli articoli (`order_items`) di un ordine con carta che un tentativo precedente del webhook ha
 * lasciato a metà.
 *
 * 28/11/2026 (R03-001) — L'ORDINE NATO SENZA ARTICOLI SI COMPLETA ALLA RICONSEGNA.
 *
 * Il webhook scrive l'ordine e, subito dopo, i suoi articoli. Se la funzione moriva fra le due
 * scritture (il tetto dei 60 secondi di Vercel, il server riavviato), restava un ordine PAGATO senza
 * articoli. Stripe riconsegnava l'avviso, l'inserimento dell'ordine rispondeva 23505 (indice unico
 * sessione+negozio) e il webhook lo dava per «già fatto» senza guardare gli articoli: il carrello si
 * chiudeva COMPLETED, il negozio riceveva un ordine vuoto (non sa cosa preparare), e la merce tolta
 * dalla vendita al checkout (`reserve_stock`) restava legata a un ordine senza articoli.
 * `restore_stock_for_order` rimette solo da `order_items`: a un annullo o a un rimborso non rimetteva
 * niente, e nessuno la liberava più.
 *
 * Adesso la riconsegna che trova l'ordine guarda se ha i suoi articoli e, se non ne ha, li scrive con
 * le righe del carrello (le stesse del primo tentativo). Due consegne dello stesso avviso non lavorano
 * insieme: le separa il turno di `stripe_event_log` (registro-eventi.ts).
 */
import type { getAdminSupabase } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import type { PendingGroup } from './ordini';

type Admin = ReturnType<typeof getAdminSupabase>;

/** Le righe di `order_items` di un gruppo del carrello: una per articolo, col prezzo pagato. */
export function righeDegliArticoli(orderId: string, g: PendingGroup) {
  return g.items.map((it) => ({
    order_id: orderId,
    product_id: it.productId,
    quantity: it.quantity,
    unit_price: it.unitAmountCents / 100,
    variant_id: it.variantId ?? null,
    variant_label: it.variantLabel ?? null,
  }));
}

/**
 * L'ordine già esistente ha i suoi articoli? Se no, li scrive. Torna `true` se li ha scritti adesso
 * (l'ordine si è completato in questa consegna). Se la lettura o la scrittura cadono lancia: la rotta
 * risponde 500 e Stripe riconsegna, invece di chiudere il carrello con un ordine vuoto.
 */
export async function completaGliArticoliDelTentativoMorto(
  admin: Admin,
  orderId: string,
  g: PendingGroup,
): Promise<boolean> {
  const { data, error } = await admin.from('order_items').select('id').eq('order_id', orderId).limit(1);
  if (error) {
    logger.error('[stripe] ordine già nato: articoli non letti, Stripe deve riprovare', { orderId, message: error.message });
    throw new Error(`[stripe] articoli dell'ordine ${orderId} non letti: ${error.message}`);
  }
  if (Array.isArray(data) && data.length > 0) return false;

  const { error: errArticoli } = await admin.from('order_items').insert(righeDegliArticoli(orderId, g));
  if (errArticoli) {
    logger.error('[stripe] ordine già nato senza articoli: articoli non scritti, Stripe deve riprovare', {
      orderId, message: errArticoli.message,
    });
    throw new Error(`[stripe] articoli dell'ordine ${orderId} non scritti: ${errArticoli.message}`);
  }
  logger.warn('[stripe] ordine nato senza articoli da un tentativo morto: articoli scritti adesso', {
    orderId, sellerId: g.sellerId, righe: g.items.length,
  });
  return true;
}

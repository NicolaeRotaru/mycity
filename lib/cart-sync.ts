'use client';

import type { CartItem } from '@/lib/cart';

/**
 * LA COPIA DEL CARRELLO SUL SERVER — quella che serve a dire «hai dimenticato
 * qualcosa», e a sapere se quel messaggio ha funzionato.
 *
 * Sta in un file suo, e non più dentro `lib/cart.ts`, per un motivo pratico:
 * era una funzione privata e nessuna prova poteva guardarla lavorare.
 *
 * ── 30/8/2026 (R164) — IL RECUPERO CARRELLI NON ERA MISURABILE ──────────────
 *
 * La tabella `abandoned_carts` ha da sempre una colonna `recovered`, e la
 * funzione che sceglie chi ricontattare filtra su `recovered = false`. Ma quel
 * `true` non lo scriveva nessuno, in nessun punto del progetto: la colonna era
 * nata e rimasta a zero.
 *
 * Il motivo era qui dentro: alla fine di un ordine il browser chiama
 * `clearCart()`, che chiamava questa funzione con il carrello vuoto — e il
 * carrello vuoto voleva dire CANCELLA LA RIGA. Il carrello recuperato spariva
 * nell'istante esatto in cui diventava una notizia. Risultato: la campagna di
 * recupero — una delle poche leve di ricavo già costruite — girava alla cieca.
 * Non si poteva sapere quanto rendeva, quindi non si poteva decidere se
 * tenerla, cambiarla o spegnerla.
 *
 * Adesso «vuoto perché ha comprato» e «vuoto perché ha tolto tutto» sono due
 * cose diverse: la prima marca la riga come recuperata (e il filtro
 * `recovered = false` la esclude dai prossimi invii), la seconda cancella.
 *
 * Secondo effetto riparato: l'upsert non azzerava `recovery_email_sent_at`,
 * e la funzione di scelta pretende che sia NULL. Chi riceveva l'email e non
 * comprava non ne riceveva più una, qualunque cosa mettesse nel carrello dopo:
 * la riga restava lì, marcata per sempre. Ora un carrello con dentro roba
 * diversa è un carrello nuovo, e può tornare in coda — non subito, perché la
 * scelta vuole comunque quattro ore di inattività.
 */

/** Quanto vale la roba nel carrello, in euro. */
type Opzioni = {
  totale: number;
  /**
   * Vuoto PERCHÉ ha comprato. Cambia tutto: la riga non si cancella, si marca
   * come recuperata — altrimenti la vittoria non la conta nessuno.
   */
  dopoUnOrdine?: boolean;
};

export async function syncAbandonedCart(items: CartItem[], opzioni: Opzioni): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    const { supabase } = await import('@/lib/supabase/client');
    const { data } = await supabase.auth.getSession();
    const userId = data.session?.user?.id;
    if (!userId) return; // solo utenti autenticati

    if (items.length === 0) {
      if (opzioni.dopoUnOrdine) {
        await supabase
          .from('abandoned_carts')
          .update({ recovered: true, recovered_at: new Date().toISOString() })
          .eq('user_id', userId);
        return;
      }
      await supabase.from('abandoned_carts').delete().eq('user_id', userId);
      return;
    }

    await supabase.from('abandoned_carts').upsert(
      {
        user_id: userId,
        cart_data: items,
        cart_total: opzioni.totale,
        last_activity: new Date().toISOString(),
        // Il contenuto è cambiato: questo è un carrello nuovo, non quello per
        // cui abbiamo già scritto una volta.
        recovery_email_sent_at: null,
        recovered: false,
        recovered_at: null,
      },
      { onConflict: 'user_id' },
    );
  } catch {
    /* best-effort: il recupero carrello non deve mai rompere il carrello locale */
  }
}

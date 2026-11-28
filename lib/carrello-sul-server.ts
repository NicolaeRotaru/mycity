import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';

/**
 * R10-006 — LA SPESA PAGATA CON LA CARTA TORNAVA NEL CARRELLO.
 *
 * Chi paga su Stripe e non torna sul sito (chiude la scheda, il telefono si spegne) non passa mai
 * dal `clearCart()` della pagina ordini: il carrello del browser E la sua copia sul server
 * (`user_carts`) restavano pieni della merce appena pagata. Al giro dopo, su quel dispositivo o su
 * un altro, `CartCrossDeviceSync` rimetteva tutto nel carrello, e un secondo tocco su «Paga» la
 * faceva comprare due volte.
 *
 * Qui il server, dove il pagamento è un fatto certo, toglie dalla copia sul server le righe pagate,
 * della quantità pagata: una riga aggiunta dopo (o un pezzo in più dello stesso prodotto) resta.
 * Con la copia cambiata, `CartCrossDeviceSync` prende il cloud intero sui dispositivi che dopo
 * l'ultimo allineamento non hanno toccato il carrello, anche quello che ha pagato.
 *
 * La scrittura passa solo se la riga è ancora quella letta (`updated_at` uguale): se intanto un
 * browser ha salvato il suo carrello, si rilegge e si rifà il conto, senza coprire il suo cambio.
 *
 * Non lancia mai: l'ordine è già scritto e pagato, e un carrello non aggiornato non deve far
 * ripetere l'avviso di Stripe.
 */

export type RigaPagata = { productId: string; variantId?: string | null; quantity: number };

type RigaDelCarrello = { id?: unknown; variantId?: unknown; quantity?: unknown } & Record<string, unknown>;

const chiave = (id: unknown, variantId: unknown) => `${String(id)}|${variantId == null || variantId === '' ? '' : String(variantId)}`;

/** Il carrello senza la merce pagata. `null` se non c'è niente da togliere. */
export function carrelloSenzaIlPagato(righe: RigaDelCarrello[], pagate: RigaPagata[]): RigaDelCarrello[] | null {
  const daTogliere = new Map<string, number>();
  for (const p of pagate) {
    const q = Math.max(0, Math.floor(Number(p.quantity) || 0));
    if (q === 0) continue;
    const k = chiave(p.productId, p.variantId);
    daTogliere.set(k, (daTogliere.get(k) ?? 0) + q);
  }
  let cambiato = false;
  const restano: RigaDelCarrello[] = [];
  for (const r of righe) {
    const k = chiave(r?.id, r?.variantId);
    const togli = daTogliere.get(k) ?? 0;
    if (togli === 0) {
      restano.push(r);
      continue;
    }
    cambiato = true;
    const q = Math.floor(Number(r.quantity) || 0);
    const tolte = Math.min(q, togli);
    daTogliere.set(k, togli - tolte);
    if (q - tolte > 0) restano.push({ ...r, quantity: q - tolte });
  }
  return cambiato ? restano : null;
}

const TENTATIVI = 3;

export async function togliIlPagatoDalCarrelloSalvato(
  admin: SupabaseClient,
  userId: string,
  pagate: RigaPagata[],
): Promise<void> {
  try {
    for (let tentativo = 0; tentativo < TENTATIVI; tentativo++) {
      const { data, error } = await admin
        .from('user_carts')
        .select('items, updated_at')
        .eq('user_id', userId)
        .maybeSingle();
      if (error || !data) return;
      const righe = Array.isArray(data.items) ? (data.items as RigaDelCarrello[]) : [];
      const restano = carrelloSenzaIlPagato(righe, pagate);
      if (!restano) return;
      const { data: scritte, error: errScrittura } = await admin
        .from('user_carts')
        .update({ items: restano, updated_at: new Date().toISOString() })
        .eq('user_id', userId)
        .eq('updated_at', data.updated_at)
        .select('user_id');
      if (errScrittura) {
        logger.warn('[carrello] la merce pagata non è uscita dal carrello salvato', { message: errScrittura.message });
        return;
      }
      if (Array.isArray(scritte) && scritte.length > 0) return;
      // Un browser ha salvato in mezzo: si rilegge e si rifà il conto.
    }
    logger.warn('[carrello] la merce pagata non è uscita dal carrello salvato', { message: 'carrello cambiato a ogni tentativo' });
  } catch (e) {
    logger.warn('[carrello] la merce pagata non è uscita dal carrello salvato', {
      message: e instanceof Error ? e.message : 'unknown',
    });
  }
}

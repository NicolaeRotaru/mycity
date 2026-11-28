import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';

/**
 * LA CHIAVE DEL CARRELLO IN CONTANTI, SCRITTA SULL'ORDINE (R06-009, R09-007; onda 2, 28/11/2026).
 *
 * Il carrello con la carta si ritrova dalla sessione di pagamento, che sta su ogni ordine. Quello in
 * contanti si ritrovava solo dalla riga contro il doppio clic (`cod_checkout_attempts.order_ids`),
 * scritta dalla rotta della cassa DOPO gli ordini, in una scrittura a parte: se cadeva, la regola del
 * negozio che rifiuta (lib/ordini/annulla.ts) e il freno della veloce (lib/ordini/veloce-non-confermata.ts)
 * trattavano ogni ordine da solo.
 *
 * Ora la rotta della cassa scrive la chiave del carrello (`orders.cod_cart_key`, la stessa della riga
 * del tentativo) nella stessa insert dell'ordine (migrazione 999p): un ordine nato ha la sua
 * chiave. Chi legge il carrello usa prima la riga del tentativo, come prima (porta anche l'ordine del
 * carrello); se la riga non c'è o non si legge, la chiave sull'ordine.
 *
 * Finché la migrazione non è applicata la colonna non c'è: la scrittura si ripete senza
 * (`conLaChiaveDelCarrello`) e la lettura risponde «nessuna chiave», cioè il comportamento di prima.
 */

export const COLONNA_CHIAVE_DEL_CARRELLO = 'cod_cart_key';

/** L'errore dice che `orders.cod_cart_key` non c'è ancora (migrazione 999p non applicata)? Per NOME. */
export function mancaLaChiaveDelCarrello(errore: unknown): boolean {
  const e = errore as { code?: unknown; message?: unknown; details?: unknown } | null;
  if (!e || (e.code !== 'PGRST204' && e.code !== '42703')) return false;
  const testo = `${typeof e.message === 'string' ? e.message : ''} ${typeof e.details === 'string' ? e.details : ''}`;
  return /\bcod_cart_key\b/.test(testo);
}

/**
 * La scrittura con la chiave del carrello; se il database non ha ancora la colonna, la stessa senza.
 * Un altro errore torna com'è.
 */
export async function conLaChiaveDelCarrello<T extends { error: unknown }>(
  dove: string,
  conChiave: () => PromiseLike<T>,
  senzaChiave: () => PromiseLike<T>,
): Promise<T> {
  const primo = await conChiave();
  if (!primo.error || !mancaLaChiaveDelCarrello(primo.error)) return primo;
  logger.warn('[db] migrazione 999p non ancora applicata: ordine scritto senza la chiave del carrello', { dove });
  return senzaChiave();
}

/**
 * La chiave del carrello in contanti di un ordine, letta dall'ordine. null se l'ordine non ce l'ha
 * (nato prima della migrazione, o con la carta), se la colonna non c'è ancora, o se la lettura cade:
 * chi chiama fa quello che faceva senza la riga del tentativo. Non lancia mai.
 */
export async function chiaveDelCarrelloInContanti(admin: SupabaseClient, orderId: string, dove: string): Promise<string | null> {
  try {
    const { data, error } = await admin.from('orders').select('cod_cart_key').eq('id', orderId).maybeSingle();
    if (error) {
      if (!mancaLaChiaveDelCarrello(error)) {
        logger.warn(`[${dove}] chiave del carrello in contanti non letta`, { orderId, message: (error as { message?: string }).message });
      }
      return null;
    }
    const chiave = (data as { cod_cart_key?: unknown } | null)?.cod_cart_key;
    return typeof chiave === 'string' && chiave.trim() ? chiave : null;
  } catch (e) {
    logger.warn(`[${dove}] chiave del carrello in contanti non letta`, { orderId, message: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

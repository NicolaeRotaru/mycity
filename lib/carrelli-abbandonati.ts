import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';

/**
 * IL CARRELLO ABBANDONATO CHE TORNA — e come si fa a saperlo.
 *
 * 30/8/2026 (R164) — LA CAMPAGNA DI RECUPERO GIRAVA ALLA CIECA.
 *
 * `abandoned_carts` ha da sempre una colonna `recovered`, e la funzione che
 * sceglie chi ricontattare filtra su `recovered = false`. Ma quel `true` non lo
 * scriveva NESSUNO, in nessun punto del progetto: la colonna era nata e rimasta
 * a zero. E la riga spariva del tutto al momento dell'acquisto, perché il
 * browser, a ordine fatto, svuotava il carrello e con lui cancellava la copia
 * sul server. Il carrello recuperato si cancellava nell'istante esatto in cui
 * diventava una notizia.
 *
 * Conseguenza: una delle poche leve di ricavo già costruite — l'email «hai
 * dimenticato qualcosa» — non si poteva misurare, quindi non si poteva
 * decidere se tenerla, cambiarla o spegnerla.
 *
 * Il browser lo marca da solo (`clearCart({ dopoUnOrdine: true })`), ma il
 * browser può chiudersi: chi paga e chiude la scheda non passa mai di lì. Qui
 * lo fa il server, dove l'ordine è un fatto certo. Le due strade scrivono la
 * stessa cosa e non si danno fastidio.
 */

/** Da quanti giorni una riga già recuperata non serve più a nessuno. */
export const GIORNI_DI_MEMORIA_CARRELLI = 90;

/**
 * Il carrello di questa persona è tornato: è diventato un ordine.
 *
 * Non lancia mai. Un ordine è già stato scritto e pagato: una misura che non
 * riesce non deve poter far ritentare un webhook o far fallire una cassa.
 */
export async function marcaCarrelloRecuperato(
  admin: SupabaseClient,
  userId: string,
  oraIso = new Date().toISOString(),
): Promise<void> {
  try {
    const { error } = await admin
      .from('abandoned_carts')
      .update({ recovered: true, recovered_at: oraIso })
      .eq('user_id', userId)
      .eq('recovered', false);
    if (error) {
      logger.warn('[carrelli] recupero non registrato: il conto della campagna resta incompleto', {
        message: error.message,
      });
    }
  } catch (e) {
    logger.warn('[carrelli] recupero non registrato', {
      message: e instanceof Error ? e.message : 'unknown',
    });
  }
}

/**
 * Le righe già recuperate da più di `GIORNI_DI_MEMORIA_CARRELLI` si potano.
 *
 * Servono a misurare, e una misura vecchia di tre mesi l'ha già letta chi
 * doveva. Tenerle per sempre vorrebbe dire conservare la spesa di una persona
 * senza motivo — e questa è la ragione vera del taglio, non lo spazio.
 */
export async function potaCarrelliRecuperati(
  admin: SupabaseClient,
  oraMs = Date.now(),
): Promise<number> {
  const limite = new Date(oraMs - GIORNI_DI_MEMORIA_CARRELLI * 86_400_000).toISOString();
  const { data, error } = await admin
    .from('abandoned_carts')
    .delete()
    .eq('recovered', true)
    .lt('recovered_at', limite)
    .select('user_id');
  if (error) {
    logger.warn('[carrelli] potatura non riuscita', { message: error.message });
    return 0;
  }
  return (data ?? []).length;
}

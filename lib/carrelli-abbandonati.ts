import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import { COLONNE_148, scriviAncheSeMancaUnaColonnaNuova } from '@/lib/db/migrazione-148';

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
 *
 * 3/9/2026 — E NON SI ARRENDE SE IL DATABASE È INDIETRO DI UNA MIGRAZIONE.
 *
 * `recovered_at` arriva con la migrazione 148, che si applica a mano: finché
 * non è firmata, il database rifiutava questa riga INTERA — non «senza quella
 * colonna»: tutta. Questa è la strada che conta più dell'altra, perché chi paga
 * con la carta e chiude la scheda non passa mai dal browser che marca: se cade
 * qui, il mattino dopo riceve «hai lasciato qualcosa nel carrello» dopo aver
 * pagato. Ora, se il rifiuto è per la colonna nuova, si riscrive senza quella:
 * si perde il QUANDO, non il fatto. La regola sta in un posto solo, insieme al
 * gemello nel browser (`lib/cart-sync.ts`).
 */
export async function marcaCarrelloRecuperato(
  admin: SupabaseClient,
  userId: string,
  oraIso = new Date().toISOString(),
): Promise<void> {
  try {
    const esito = await scriviAncheSeMancaUnaColonnaNuova(
      'il carrello di chi ha appena comprato',
      { recovered: true, recovered_at: oraIso },
      COLONNE_148,
      (campi) =>
        admin.from('abandoned_carts').update(campi).eq('user_id', userId).eq('recovered', false),
    );
    if (esito.avviso) {
      logger.warn(`[carrelli] ${esito.avviso}`, { riuscita: esito.riuscita });
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

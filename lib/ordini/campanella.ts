import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import { notifyAdmins } from '@/lib/stripe/webhook/comune';

/**
 * 5/11/2026 — LA CAMPANELLA CHE CADE NON SPARISCE PIÙ SENZA TRACCIA.
 *
 * Dopo un annullo, un reso o un reclamo l'avviso nella campanella si scriveva
 * con `await admin.from('notifications').insert(...)` senza leggere `{ error }`.
 * La libreria di Supabase non lancia: se la scrittura cadeva, il negozio non
 * sapeva che il cliente aveva annullato (o che era arrivato un reso) e nel
 * registro non restava nemmeno una riga.
 *
 * Qui la scrittura si fa una volta sola: l'errore va nel registro con l'ordine o
 * il reso, e per gli avvisi a chi deve agire (il negozio) si ripiega sugli
 * amministratori, che possono avvisarlo a voce. Non lancia mai: la campanella è
 * il contorno di un lavoro già fatto (l'annullo, il rimborso), non lo disfa.
 */
export type RigaCampanella = {
  user_id: string;
  title: string;
  body?: string | null;
  link?: string | null;
  category?: string;
  [k: string]: unknown;
};

export async function scriviCampanella(
  admin: SupabaseClient,
  righe: RigaCampanella | RigaCampanella[],
  contesto: {
    dove: string;
    ordine?: string | null;
    reso?: string | null;
    /** Se la scrittura cade, gli amministratori ricevono questo avviso al posto del destinatario. */
    ripiego?: { titolo: string; corpo: string; link: string };
  },
): Promise<boolean> {
  let errore: { message?: string } | null = null;
  try {
    const esito = await admin.from('notifications').insert(righe as never);
    errore = (esito?.error as { message?: string } | null) ?? null;
  } catch (e) {
    errore = { message: e instanceof Error ? e.message : String(e) };
  }
  if (!errore) return true;
  logger.error(`[${contesto.dove}] avviso nella campanella non scritto`, {
    orderId: contesto.ordine ?? null,
    returnId: contesto.reso ?? null,
    message: errore.message ?? 'errore del database',
  });
  if (contesto.ripiego) {
    try {
      await notifyAdmins(contesto.ripiego.titolo, contesto.ripiego.corpo, contesto.ripiego.link);
    } catch (e) {
      logger.error(`[${contesto.dove}] anche l'avviso agli amministratori non è partito`, {
        orderId: contesto.ordine ?? null,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return false;
}

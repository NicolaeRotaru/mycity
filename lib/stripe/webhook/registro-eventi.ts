/**
 * Il registro degli avvisi di Stripe (`stripe_event_log`): il turno su un
 * avviso si prende con la riga, e si restituisce quando il gestore fallisce.
 *
 * 15/10/2026 — Spostato qui dalla rotta, senza cambiare una riga di logica:
 * la rotta deve restare corta (la prova `webhook-diviso-per-mestiere` la tiene
 * sotto le 250 righe), e la seconda porta della firma (R77) e le scritture
 * controllate (R81) le hanno aggiunto righe.
 */
import type { getAdminSupabase } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';

/**
 * 27/8/2026 (R134) — QUANDO IL GESTORE FALLIVA, IL TURNO RESTAVA PRESO: la
 * riconsegna di Stripe entro cinque minuti riceveva `200 { duplicated: true }`,
 * per Stripe la consegna era riuscita, e l'evento spariva. Su una sessione
 * pagata vuol dire cliente addebitato e ordine mai nato.
 */
export async function liberaIlTurno(
  admin: ReturnType<typeof getAdminSupabase>,
  eventId: string,
): Promise<void> {
  const { error } = await admin
    .from('stripe_event_log')
    .update({ claimed_at: null })
    .eq('event_id', eventId)
    .eq('processed', false);
  if (error) logger.error(error, { context: 'stripe-event-log-rilascio-turno' });
}

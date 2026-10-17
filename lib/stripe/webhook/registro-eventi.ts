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

type Admin = ReturnType<typeof getAdminSupabase>;

/** Dopo quanto un turno preso e mai chiuso vuol dire «chi l'aveva preso è morto». */
export const TURNO_SCADUTO_DOPO_MS = 5 * 60_000;

/**
 * Com'è andata la presa del turno su un avviso già registrato:
 * - `preso`: tocca a questa consegna lavorarlo;
 * - `occupato`: è già lavorato, o un'altra consegna lo sta lavorando adesso;
 * - `guasto`: il database non ha risposto, e non si sa (Stripe deve riprovare).
 */
export type Turno = 'preso' | 'occupato' | 'guasto';

/**
 * 15/10/2026 (R81, collaudo) — IL TURNO NON SI RIPRENDEVA MAI.
 *
 * Qui c'era UNA scrittura sola con dentro un «oppure»:
 * `.or('claimed_at.is.null,claimed_at.lt.…')` e poi `.select('event_id')`.
 * Il database finto delle prove la eseguiva come ci si aspetta. PostgREST, il
 * traduttore davanti al database vero, no: applica l'«oppure» due volte, alla
 * scrittura E alle righe che restituisce. Con `select('event_id')` le righe
 * restituite non hanno `claimed_at`, e risponde 42703 «column
 * stripe_event_log.claimed_at does not exist» senza scrivere niente. Senza
 * `select` risponde una lista vuota, anche se ha scritto. Misurato sulle
 * versioni 12.2.3, 12.2.8, 13.0.5 e 14.0.
 *
 * Il danno era tutto qui: dopo un errore del gestore (500, turno liberato),
 * la consegna successiva di Stripe non riusciva mai a riprendere il turno.
 * Prima del 15/10 la rotta leggeva quel silenzio come «già lavorato» e
 * rispondeva 200: l'avviso si perdeva. Col 15/10 lo leggeva come guasto e
 * rispondeva 503 per tre giorni, anche ai doppioni di un avviso già lavorato
 * bene. In tutti e due i casi il patto «se il database sbaglia, Stripe
 * riprova» non valeva in produzione.
 *
 * Adesso il turno si prende con due scritture a filtri semplici, che PostgREST
 * applica solo alla scrittura: prima il turno libero (`claimed_at` vuoto, cioè
 * liberato dopo un errore), poi il turno scaduto (preso più di cinque minuti
 * fa da un processo morto a metà). Ognuna è una sola istruzione UPDATE: fra
 * due consegne in gara la prende una sola, l'altra trova la riga già cambiata.
 */
export async function prendiIlTurno(admin: Admin, eventId: string, adesso: Date = new Date()): Promise<Turno> {
  const presoAlle = adesso.toISOString();
  const scadeSePresoPrima = new Date(adesso.getTime() - TURNO_SCADUTO_DOPO_MS).toISOString();

  const libero = await admin
    .from('stripe_event_log')
    .update({ claimed_at: presoAlle })
    .eq('event_id', eventId)
    .eq('processed', false)
    .is('claimed_at', null)
    .select('event_id');
  if (libero.error) {
    logger.error(libero.error, { context: 'stripe-event-log-turno-libero' });
    return 'guasto';
  }
  if ((libero.data ?? []).length > 0) return 'preso';

  const scaduto = await admin
    .from('stripe_event_log')
    .update({ claimed_at: presoAlle })
    .eq('event_id', eventId)
    .eq('processed', false)
    .lt('claimed_at', scadeSePresoPrima)
    .select('event_id');
  if (scaduto.error) {
    logger.error(scaduto.error, { context: 'stripe-event-log-turno-scaduto' });
    return 'guasto';
  }
  return (scaduto.data ?? []).length > 0 ? 'preso' : 'occupato';
}

/**
 * 27/8/2026 (R134) — QUANDO IL GESTORE FALLIVA, IL TURNO RESTAVA PRESO: la
 * riconsegna di Stripe entro cinque minuti riceveva `200 { duplicated: true }`,
 * per Stripe la consegna era riuscita, e l'evento spariva. Su una sessione
 * pagata vuol dire cliente addebitato e ordine mai nato.
 */
export async function liberaIlTurno(admin: Admin, eventId: string): Promise<void> {
  const { error } = await admin
    .from('stripe_event_log')
    .update({ claimed_at: null })
    .eq('event_id', eventId)
    .eq('processed', false);
  if (error) logger.error(error, { context: 'stripe-event-log-rilascio-turno' });
}

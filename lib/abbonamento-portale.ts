import { ABBONAMENTO_NEGOZI_ACCESO } from '@/lib/funzioni-al-lancio';

/**
 * 12/11/2026 (R10-021) — CHI PUO' APRIRE IL PORTALE DELL'ABBONAMENTO, DETTO IN UN POSTO SOLO.
 *
 * La rotta del portale (app/api/seller/subscription/portal) con l'abbonamento spento al
 * lancio apre solo a chi ne ha uno in corso, per lasciargli la porta per disdire. Il
 * bottone «Gestisci abbonamento» invece si mostrava a ogni stato diverso da «nessuno»:
 * un negozio disdetto lo vedeva, lo premeva e leggeva «L'abbonamento dei negozi non è
 * attivo al momento». Adesso bottone e rotta leggono la stessa regola.
 */

/** Gli stati Stripe in cui il negozio ha ancora un abbonamento da gestire o disdire. */
export const STATI_ABBONAMENTO_IN_CORSO = ['active', 'past_due', 'trialing', 'unpaid'] as const;

export function abbonamentoInCorso(stato: string | null | undefined): boolean {
  return (STATI_ABBONAMENTO_IN_CORSO as readonly string[]).includes(String(stato ?? ''));
}

/** Il portale si apre? Senza un abbonamento mai attivato no; a funzione spenta solo se è in corso. */
export function portaleApribile(
  stato: string | null | undefined,
  abbonamentoAcceso: boolean = ABBONAMENTO_NEGOZI_ACCESO,
): boolean {
  if (!stato || stato === 'none' || stato === 'inactive') return false;
  return abbonamentoAcceso || abbonamentoInCorso(stato);
}

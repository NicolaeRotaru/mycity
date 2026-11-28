import { env } from '@/lib/env';

/**
 * 28/11/2026 (onda 2, R05-009) — IL FRENO DEL CONTO DI PROVA, IN UN POSTO SOLO.
 *
 * Una chiave Stripe di prova non conosce i conti veri. Se il conto salvato sul profilo le risulta
 * sconosciuto, non si sostituisce con un conto di prova (lib/stripe/client.ts,
 * `createConnectOnboardingLink`) e la persona legge cosa fare. Il freno valeva solo nell'anteprima
 * di Vercel (VERCEL_ENV === 'preview'): adesso vale per ogni chiave di prova. Sta fuori da
 * lib/stripe/client.ts perché le prove che fingono quel modulo non lo perdano.
 */

/** La chiave Stripe in uso è di prova (`sk_test_`, `rk_test_`)? */
export function eChiaveDiProva(chiave: string | null | undefined = env.stripeSecretKey()): boolean {
  return /^(sk|rk)_test_/.test(chiave ?? '');
}

/** Stripe dice che il conto non esiste per queste chiavi: «No such account», un conto non valido, o un 404. */
export function contoSconosciutoAStripe(err: unknown): boolean {
  const { code, statusCode } = (err ?? {}) as { code?: string; statusCode?: number };
  return code === 'resource_missing' || code === 'account_invalid' || statusCode === 404;
}

/**
 * Cosa legge la persona quando la chiave di prova non riconosce il conto del suo profilo. Vale ovunque
 * giri una chiave di prova (anteprima, sviluppo, un ambiente di prova): niente «in questa anteprima».
 * Senza id del conto né chiave, sotto i 200 caratteri e senza parentesi, così il bottone la mostra
 * com'è (friendlyError, lib/errors.ts).
 */
export const FRASE_CONTO_SCONOSCIUTO_ALLA_CHIAVE_DI_PROVA =
  'Qui Stripe usa le chiavi di prova e non riconosce il conto salvato sul tuo profilo. Se stai provando con dati di prova, togli il conto dal profilo e riprova.';

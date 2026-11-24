import { createHash } from 'node:crypto';
import type { NextResponse } from 'next/server';
import { env } from '@/lib/env';
import type { Abbonamento } from '@/lib/agenzia/preventivo';
import { apriCassaServizi } from '@/lib/agenzia/cassa-servizi';

/**
 * La cassa dell'abbonamento aperta dal link col codice (24/11/2026): al primo «Accetto e pago» e,
 * se il titolare non ha chiuso il pagamento, dal pulsante «Paga» della pagina accettata. Un negozio
 * in revisione non entra ancora nella sua dashboard (collaudo del 24/11): per questo il pagamento
 * resta sul link.
 */
export function apriCassaDalLink(a: { codice: string; sellerId: string; email: string; fascia: Abbonamento }): Promise<NextResponse> {
  const qui = `${env.appUrl()}/preventivo/${a.codice}`;
  const ritorno = { pagato: `${qui}?pagato=1`, annullato: `${qui}?pagato=0` };
  const impronta = createHash('sha256').update(`${a.email}|${ritorno.pagato}`).digest('hex').slice(0, 16);
  return apriCassaServizi({ sellerId: a.sellerId, email: a.email, fascia: a.fascia, ritorno, chiaveExtra: `link-${impronta}` });
}

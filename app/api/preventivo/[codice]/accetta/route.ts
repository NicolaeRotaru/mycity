import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ApiErrors } from '@/lib/api/responses';
import { CorpoTroppoGrande, jsonRichiesta, TETTO_JSON } from '@/lib/api/corpo';
import { rateLimitAsync, getClientIp } from '@/lib/rate-limit';
import { isStripeConfigured } from '@/lib/stripe/client';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { ABBONAMENTI } from '@/lib/agenzia/preventivo';
import { apriCassaServizi } from '@/lib/agenzia/cassa-servizi';
import { accettaPreventivoColCodice, CODICE_VALIDO, leggiPreventivoColCodice } from '@/lib/agenzia/preventivo-col-codice';

export const runtime = 'nodejs';

/**
 * IL TITOLARE ACCETTA IL PREVENTIVO DAL LINK COL CODICE — 24/11/2026.
 *
 * Nessun accesso: la chiave è il codice del link (256 bit casuali). Il titolare manda l'email,
 * l'abbonamento scelto e il sì alle condizioni; il server accetta (lib/agenzia/preventivo-col-codice.ts)
 * e apre subito la cassa Stripe dell'abbonamento, con l'email appena data. Se i pagamenti non sono
 * attivi, l'accettazione vale lo stesso: il titolare entra dal link nell'email e paga dalla sua pagina.
 * Il canone lo rilegge il server; il browser manda solo il nome della fascia.
 */

const Richiesta = z.object({
  email: z.string().trim().toLowerCase().max(254).email('Scrivi un’email valida'),
  abbonamento: z.enum(ABBONAMENTI, { message: 'Scegli uno dei tre abbonamenti' }),
  accettoCondizioni: z.literal(true, { message: 'Per continuare accetta le condizioni e l’informativa privacy' }),
});

export async function POST(req: Request, ctx: { params: Promise<{ codice: string }> }): Promise<NextResponse> {
  const { codice } = await ctx.params;
  // Un codice nella forma sbagliata non tocca nemmeno il database.
  if (!CODICE_VALIDO.test(codice)) return ApiErrors.notFound('Preventivo non trovato');

  const ip = getClientIp(req);
  const rl = await rateLimitAsync({ key: `preventivo-codice:${ip}`, max: 10, windowMs: 10 * 60_000 });
  if (!rl.allowed) return ApiErrors.rateLimited(rl.retryAfterSec);

  let corpo: unknown;
  try {
    corpo = await jsonRichiesta(req, TETTO_JSON);
  } catch (errore) {
    if (errore instanceof CorpoTroppoGrande) return ApiErrors.payloadTooLarge(errore.message);
    return ApiErrors.invalidRequest('Richiesta non leggibile');
  }
  const esito = Richiesta.safeParse(corpo);
  if (!esito.success) return ApiErrors.invalidRequest(esito.error.issues[0]?.message ?? 'Dati non validi');
  const { email, abbonamento } = esito.data;

  let preventivo;
  try {
    preventivo = await leggiPreventivoColCodice(codice);
  } catch (errore) {
    logger.error('[preventivo-codice] lettura non riuscita', { errore: String(errore) });
    return ApiErrors.unavailable('Non riesco a leggere il preventivo in questo momento. Riprova fra poco.');
  }
  if (!preventivo) return ApiErrors.notFound('Preventivo non trovato');

  const accettato = await accettaPreventivoColCodice({ preventivo, codice, email, fascia: abbonamento });
  if (!accettato.ok) {
    if (accettato.motivo === 'GUASTO') return ApiErrors.unavailable(accettato.messaggio);
    return ApiErrors.conflict(accettato.messaggio);
  }

  const qui = `${env.appUrl()}/preventivo/${codice}`;
  if (!isStripeConfigured()) {
    return NextResponse.json({ ok: true, data: { url: null, accessoInviato: accettato.accessoInviato } }, { status: 200 });
  }
  const cassa = await apriCassaServizi({
    sellerId: accettato.sellerId,
    email,
    fascia: abbonamento,
    ritorno: { pagato: `${qui}?pagato=1`, annullato: `${qui}?pagato=0` },
  });
  // Se la cassa non si apre, l'accettazione resta: il titolare paga dalla sua pagina.
  if (!cassa.ok) {
    return NextResponse.json({ ok: true, data: { url: null, accessoInviato: accettato.accessoInviato } }, { status: 200 });
  }
  const dati = (await cassa.json()) as { data?: { url?: string } };
  return NextResponse.json({ ok: true, data: { url: dati.data?.url ?? null, accessoInviato: accettato.accessoInviato } }, { status: 200 });
}

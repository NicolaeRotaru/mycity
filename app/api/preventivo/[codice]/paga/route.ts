import { NextResponse } from 'next/server';
import { ApiErrors } from '@/lib/api/responses';
import { rateLimitAsync, getClientIp } from '@/lib/rate-limit';
import { isStripeConfigured } from '@/lib/stripe/client';
import { getAdminSupabase } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { apriCassaDalLink } from '@/lib/agenzia/cassa-dal-link';
import { MESSAGGIO_CASSA_SPENTA, pagamentoOnlineAttivo } from '@/lib/agenzia/pagamento-servizi';
import { CODICE_VALIDO, leggiPreventivoColCodice } from '@/lib/agenzia/preventivo-col-codice';

export const runtime = 'nodejs';

/**
 * «PAGA» DAL LINK COL CODICE, DOPO AVER ACCETTATO — 24/11/2026 (dal collaudo).
 *
 * Il titolare ha accettato ma non ha chiuso il pagamento (ha chiuso Stripe, o la cassa non si è
 * aperta). Il suo negozio è in revisione e la dashboard non lo fa ancora entrare: paga da qui.
 * Solo un preventivo già accettato, con l'abbonamento scelto allora e l'email già collegata
 * all'attività (nessuna email nuova da questa porta). Un abbonamento in corso ferma la cassa
 * (lo controlla apriCassaServizi).
 */
export async function POST(req: Request, ctx: { params: Promise<{ codice: string }> }): Promise<NextResponse> {
  const { codice } = await ctx.params;
  if (!CODICE_VALIDO.test(codice)) return ApiErrors.notFound('Preventivo non trovato');
  const rl = await rateLimitAsync({ key: `preventivo-codice-paga:${getClientIp(req)}`, max: 10, windowMs: 10 * 60_000 });
  if (!rl.allowed) return ApiErrors.rateLimited(rl.retryAfterSec);
  // 26/11/2026 — Per ora si paga in contanti (lib/agenzia/pagamento-servizi.ts).
  if (!pagamentoOnlineAttivo()) return ApiErrors.conflict(MESSAGGIO_CASSA_SPENTA);
  if (!isStripeConfigured()) return ApiErrors.unavailable('I pagamenti non sono disponibili in questo momento. Scrivici e ti richiamiamo.');

  let preventivo;
  try {
    preventivo = await leggiPreventivoColCodice(codice);
  } catch (e) {
    logger.error('[preventivo-codice] paga: lettura non riuscita', { errore: String(e) });
    return ApiErrors.unavailable('Non riesco a leggere il preventivo in questo momento. Riprova fra poco.');
  }
  if (!preventivo) return ApiErrors.notFound('Preventivo non trovato');
  if (preventivo.stato !== 'accettato' || !preventivo.fasciaScelta) {
    return ApiErrors.conflict('Prima accetta il preventivo: scegli l’abbonamento e lascia la tua email.');
  }
  const utente = await getAdminSupabase().auth.admin.getUserById(preventivo.sellerId);
  const email = utente.data?.user?.email ?? '';
  if (utente.error || !email || email.endsWith('.local')) {
    logger.error('[preventivo-codice] paga: email del titolare non trovata', { sellerId: preventivo.sellerId });
    return ApiErrors.unavailable('Non riesco ad aprire il pagamento. Scrivici e lo sistemiamo noi.');
  }
  return apriCassaDalLink({ codice, sellerId: preventivo.sellerId, email, fascia: preventivo.fasciaScelta });
}

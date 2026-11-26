import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ApiErrors } from '@/lib/api/responses';
import { CorpoTroppoGrande, jsonRichiesta, TETTO_JSON } from '@/lib/api/corpo';
import { rateLimitAsync, getClientIp } from '@/lib/rate-limit';
import { getAdminSupabase } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { CODICE_INVITO, faiAgente, leggiInvito, restituisciInvito, statoInvito, usaInvito } from '@/lib/agenti/inviti';

export const runtime = 'nodejs';

/**
 * L'AGENTE SI ISCRIVE DAL LINK D'INVITO — 26/11/2026 (migrazione 865).
 *
 * L'unica porta per diventare agente: il link creato in Admin → Agenti. Chi lo apre sceglie email e password,
 * e il server crea il suo account MyCity (email già confermata: il link gliel'ha dato Nicola di persona) e la
 * sua riga di agente. Il posto nel link si prende PRIMA di creare l'account, in modo atomico: due persone sullo
 * stesso link monouso, ne entra una. Se l'account non si crea, il posto torna libero.
 * Chi ha già un account MyCity non ne crea un altro: entra e preme «Attiva» (rotta /attiva).
 */

const Richiesta = z.object({
  email: z.string().trim().toLowerCase().max(254).email('Scrivi un’email valida'),
  password: z.string().min(8, 'La password deve avere almeno 8 caratteri').max(200, 'Password troppo lunga'),
  accettoCondizioni: z.literal(true, { message: 'Per continuare accetta le condizioni e l’informativa privacy' }),
});

export async function POST(req: Request, ctx: { params: Promise<{ codice: string }> }): Promise<NextResponse> {
  const { codice } = await ctx.params;
  if (!CODICE_INVITO.test(codice)) return ApiErrors.notFound('Link non valido');

  const rl = await rateLimitAsync({ key: `invito-agente:${getClientIp(req)}`, max: 8, windowMs: 10 * 60_000 });
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
  const { email, password } = esito.data;

  let invito;
  try {
    invito = await leggiInvito(codice);
  } catch (errore) {
    logger.error('[invito-agente] lettura non riuscita', { errore: String(errore) });
    return ApiErrors.unavailable('Non riesco a leggere il link in questo momento. Riprova fra poco.');
  }
  const stato = statoInvito(invito);
  if (stato !== 'valido') return ApiErrors.conflict(stato === 'scaduto' ? 'Questo link è scaduto: chiedi a Nicola un link nuovo.' : 'Questo link non vale più: chiedi a Nicola un link nuovo.');

  // 1. Il posto nel link, in modo atomico.
  let invitoId: string | null;
  try {
    invitoId = await usaInvito(codice);
  } catch (errore) {
    logger.error('[invito-agente] uso non riuscito', { errore: String(errore) });
    return ApiErrors.unavailable('Non riesco a usare il link in questo momento. Riprova fra poco.');
  }
  if (!invitoId) return ApiErrors.conflict('Questo link non vale più: chiedi a Nicola un link nuovo.');

  // 2. L'account MyCity, già confermato.
  const admin = getAdminSupabase();
  const creato = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { role: 'customer', origine: 'invito-agente' } });
  if (!creato.data?.user) {
    await restituisciInvito(invitoId).catch(() => undefined);
    const gia = /already|registered|exists/i.test(creato.error?.message ?? '');
    if (gia) return ApiErrors.conflict('Questa email ha già un account MyCity: entra con la tua password e riapri questo link per attivarti come agente.');
    logger.error('[invito-agente] account non creato', { errore: creato.error?.message });
    return ApiErrors.unavailable('Non riesco a creare l’account in questo momento. Riprova fra poco.');
  }

  // 3. La riga di agente.
  try {
    await faiAgente({ userId: creato.data.user.id, email, invitoId });
  } catch (errore) {
    logger.error('[invito-agente] agente non scritto', { errore: String(errore), utente: creato.data.user.id });
    return ApiErrors.unavailable('L’account c’è, ma non riesco ad attivarti come agente: riapri il link, entra e premi «Attiva».');
  }
  return NextResponse.json({ ok: true }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
}

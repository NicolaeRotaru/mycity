import { NextResponse } from 'next/server';
import { withAuthRateLimit } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';
import { logger } from '@/lib/logger';
import { CODICE_INVITO, agenteDi, faiAgente, leggiInvito, statoInvito, usaInvito } from '@/lib/agenti/inviti';

export const runtime = 'nodejs';

/**
 * CHI HA GIÀ UN ACCOUNT MYCITY SI ATTIVA COME AGENTE DAL LINK — 26/11/2026 (migrazione 865).
 * Entrato col suo account, riapre il link e preme «Attiva»: il posto nel link si usa e lui diventa agente.
 * Un agente già attivo non consuma un altro link.
 */
export const POST = withAuthRateLimit({ name: 'invito-agente-attiva', max: 8, windowMs: 10 * 60_000 }, async ({ user, params }) => {
  const codice = String(params.codice ?? '');
  if (!CODICE_INVITO.test(codice)) return ApiErrors.notFound('Link non valido');
  if (!user.email) return ApiErrors.invalidRequest('Il tuo account non ha un’email: scrivi a Nicola.');
  try {
    const gia = await agenteDi(user.id);
    if (gia?.attivo) return NextResponse.json({ ok: true, data: { gia: true } }, { status: 200 });
    const stato = statoInvito(await leggiInvito(codice));
    if (stato !== 'valido') return ApiErrors.conflict(stato === 'scaduto' ? 'Questo link è scaduto: chiedi a Nicola un link nuovo.' : 'Questo link non vale più: chiedi a Nicola un link nuovo.');
    const invitoId = await usaInvito(codice);
    if (!invitoId) return ApiErrors.conflict('Questo link non vale più: chiedi a Nicola un link nuovo.');
    await faiAgente({ userId: user.id, email: user.email, invitoId });
    return NextResponse.json({ ok: true, data: { gia: false } }, { status: 200 });
  } catch (errore) {
    logger.error('[invito-agente] attivazione non riuscita', { errore: String(errore) });
    return ApiErrors.unavailable('Non riesco ad attivarti in questo momento. Riprova fra poco.');
  }
});

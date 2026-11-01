import { NextResponse } from 'next/server';
import { getAdminSupabase } from '@/lib/supabase/server';
import { withAuthRateLimit } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';

/** Quante conversazioni si guardano: le stesse 50 dell'elenco /messages, con margine. */
const TETTO_CONVERSAZIONI = 200;

/**
 * 1/11/2026 — IL NEGOZIANTE LEGGE «CLIENTE» AL POSTO DEL NOME DI CHI GLI SCRIVE.
 *
 * Il nome del cliente sta in `profiles`, e nessuna regola lascia a un negozio
 * leggere la riga di un suo cliente: la funzione della migrazione 181 lo
 * risolve, ma finché non è applicata in produzione il negozio vede «Cliente»
 * su ogni riga. Questa rotta legge col client di servizio, ma restituisce
 * SOLO il nome dei clienti delle conversazioni in cui chi chiede è il
 * negozio (`seller_id = utente autenticato`): chi non è il negozio di
 * nessuna conversazione riceve una mappa vuota. Solo id e nome, niente altro
 * del profilo.
 *
 * GET /api/chat/nomi-clienti → { nomi: { [buyer_id]: full_name } }
 */
export const GET = withAuthRateLimit({ name: 'chat-nomi-clienti', max: 120, windowMs: 5 * 60_000 }, async ({ user }): Promise<NextResponse> => {
  const admin = getAdminSupabase();

  const { data: conversazioni, error: erroreConv } = await admin
    .from('conversations')
    .select('buyer_id')
    .eq('seller_id', user.id)
    .limit(TETTO_CONVERSAZIONI);
  if (erroreConv) {
    logger.error('[chat/nomi-clienti] conversazioni del negozio non lette', erroreConv);
    return ApiErrors.internal('Nomi dei clienti non letti');
  }

  const ids = [...new Set(((conversazioni ?? []) as Array<{ buyer_id: string | null }>)
    .map((c) => c.buyer_id)
    .filter((id): id is string => !!id))];
  if (ids.length === 0) return NextResponse.json({ nomi: {} });

  const { data: profili, error: erroreProfili } = await admin
    .from('profiles')
    .select('id, full_name')
    .in('id', ids);
  if (erroreProfili) {
    logger.error('[chat/nomi-clienti] profili dei clienti non letti', erroreProfili);
    return ApiErrors.internal('Nomi dei clienti non letti');
  }

  const nomi: Record<string, string> = {};
  for (const p of (profili ?? []) as Array<{ id: string; full_name: string | null }>) {
    // Doppia guardia: si restituisce solo chi è davvero un cliente di questo negozio.
    if (p.full_name && ids.includes(p.id)) nomi[p.id] = p.full_name;
  }
  return NextResponse.json({ nomi });
});

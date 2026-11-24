import { NextResponse } from 'next/server';
import { withAdminAuth } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';
import { logger } from '@/lib/logger';
import { negoziCheAspettanoLaBozza } from '@/lib/agenzia/bozze-in-attesa';

export const runtime = 'nodejs';

/**
 * I NEGOZI CHE ASPETTANO LA BOZZA DEL SITO, PER L'AREA ADMIN — 24/11/2026.
 *
 * La bozza fatta con l'IA la scrive l'AD nel suo giro (Nicola, 24/11): qui l'admin vede chi aspetta,
 * e perché (nessuna bozza, o una scheda di n8n più nuova dell'ultima bozza). Solo nomi e date.
 */
export const GET = withAdminAuth(async () => {
  try {
    const negozi = await negoziCheAspettanoLaBozza();
    return NextResponse.json({ ok: true, data: negozi }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  } catch (errore) {
    logger.error('[admin] bozze del sito non lette', { errore: String(errore) });
    return ApiErrors.unavailable('Non riesco a leggere l’elenco. Controlla che la migrazione 711 sia applicata.');
  }
});

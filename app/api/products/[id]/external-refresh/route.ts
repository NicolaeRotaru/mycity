import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getAdminSupabase } from '@/lib/supabase/server';
import { withAdminAuth } from '@/lib/api/middleware';
import { apiSuccess, ApiErrors } from '@/lib/api/responses';
import { rateLimit } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import {
  fetchExternalSnapshot,
  isStale,
  type Marketplace,
  type ExternalData,
} from '@/lib/products/externalSync';

/**
 * GET/POST /api/products/[id]/external-refresh
 *
 * GET (pubblico): usato dalle pagine cliente. Restituisce SUBITO lo snapshot in
 * cache; se è scaduto (TTL) lancia un refresh in background con debounce — al
 * massimo ~1 chiamata AI per prodotto per TTL, anche sotto traffico.
 *
 * POST (admin): forza un refresh sincrono (ignora il TTL) per il bottone
 * "Aggiorna ora" del pannello prodotto admin.
 */
export const runtime = 'nodejs';

type Row = {
  external_source_url: string | null;
  external_marketplace: string | null;
  external_data: ExternalData | null;
  external_synced_at: string | null;
  external_sync_status: string | null;
};

async function loadRow(id: string): Promise<Row | null> {
  const admin = getAdminSupabase();
  const { data } = await admin
    .from('products')
    .select('external_source_url, external_marketplace, external_data, external_synced_at, external_sync_status')
    .eq('id', id)
    .single();
  return (data as Row | null) ?? null;
}

/** Recupera lo snapshot fresco dal marketplace e lo salva. Best-effort. */
async function doRefresh(id: string, sourceUrl: string, marketplace: string | null): Promise<ExternalData | null> {
  const admin = getAdminSupabase();
  try {
    const extract = await fetchExternalSnapshot(sourceUrl, (marketplace as Marketplace) ?? undefined);
    const data = extract.external;
    await admin
      .from('products')
      .update({ external_data: data, external_synced_at: new Date().toISOString(), external_sync_status: 'idle' })
      .eq('id', id);
    return data;
  } catch (err) {
    // Segna l'errore e fai backoff (synced_at=now) per non martellare l'AI.
    logger.warn('external-refresh fallito', { id, status: err instanceof Error ? err.message : 'err' });
    await admin
      .from('products')
      .update({ external_synced_at: new Date().toISOString(), external_sync_status: 'error' })
      .eq('id', id);
    return null;
  }
}

const idSchema = z.string().uuid();

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await ctx.params;
  if (!idSchema.safeParse(id).success) return ApiErrors.invalidRequest('ID non valido');

  const row = await loadRow(id);
  if (!row || !row.external_source_url) return apiSuccess({ external: null });

  const stale = isStale(row.external_synced_at);
  const pending = row.external_sync_status === 'pending';

  // Path comune: dati freschi o refresh già in corso → nessuna chiamata AI.
  if (!stale || pending) {
    return apiSuccess({ external: row.external_data ?? null, synced_at: row.external_synced_at, stale: false });
  }

  // Gate in-memory (cheap) + lock in Postgres (cross-instance) per il debounce.
  const gate = rateLimit({ key: `ext-refresh:${id}`, max: 1, windowMs: 30 * 60_000 });
  if (gate.allowed) {
    const admin = getAdminSupabase();
    const { data: claimed } = await admin
      .from('products')
      .update({ external_sync_status: 'pending' })
      .eq('id', id)
      .neq('external_sync_status', 'pending')
      .select('id');
    if (claimed && claimed.length > 0) {
      // Fire-and-forget: il cliente riceve subito la cache, il fresco arriverà
      // alla prossima vista (l'app gira su processo Node persistente).
      void doRefresh(id, row.external_source_url, row.external_marketplace);
    }
  }

  return apiSuccess({ external: row.external_data ?? null, synced_at: row.external_synced_at, stale: true });
}

export const POST = (req: NextRequest, ctx: { params: Promise<{ id: string }> }) =>
  withAdminAuth(async (): Promise<NextResponse> => {
    const { id } = await ctx.params;
    if (!idSchema.safeParse(id).success) return ApiErrors.invalidRequest('ID non valido');

    const row = await loadRow(id);
    if (!row || !row.external_source_url) return ApiErrors.invalidRequest('Prodotto senza sorgente esterna');

    const data = await doRefresh(id, row.external_source_url, row.external_marketplace);
    if (!data) return ApiErrors.badGateway('Aggiornamento non riuscito. Riprova.');
    return apiSuccess({ external: data, synced_at: new Date().toISOString() });
  })(req);

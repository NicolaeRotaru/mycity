import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { env, requireSupabaseService } from '@/lib/env';
import { withCronAuth } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';
import { logger } from '@/lib/logger';
import { fetchExternalSnapshot } from '@/lib/products/externalSync';
import { isStale, type ExternalData, type Marketplace } from '@/lib/products/externalSyncShared';
import { detectExternalChange, changeMessage } from '@/lib/products/externalAlert';

/**
 * Cron: alert riprezzo/stock sui prodotti importati.
 *
 * Ricontrolla i prodotti importati da marketplace (external_source_url) il cui
 * snapshot è "stale", ri-recupera prezzo e disponibilità alla fonte e — se sono
 * cambiati in modo notevole — notifica il venditore e aggiorna lo snapshot. Cap
 * per giro (la verifica usa l'AI: costosa) e sempre solo sugli stale, così i giri
 * si distribuiscono nel tempo.
 *
 * Trigger esterno (cron-job.org, es. ogni ora):
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://yoursite/api/cron/external-price-alerts
 */

export const runtime = 'nodejs';

const BATCH = 10; // prodotti per giro (la verifica AI costa)

type Row = {
  id: string;
  name: string | null;
  seller_id: string | null;
  external_marketplace: Marketplace | null;
  external_data: ExternalData | null;
  external_source_url: string | null;
  external_synced_at: string | null;
};

const handler = withCronAuth(async (): Promise<NextResponse> => {
  if (!env.anthropicKey()) return ApiErrors.unavailable('Servizio AI non configurato.');
  let supaCfg;
  try {
    supaCfg = requireSupabaseService();
  } catch (e) {
    return ApiErrors.unavailable(e instanceof Error ? e.message : 'service unavailable');
  }
  const supa = createClient(supaCfg.url, supaCfg.key, { auth: { persistSession: false, autoRefreshToken: false } });

  // Candidati: prodotti importati, dal meno recente. Filtro "stale" in codice.
  const { data, error } = await supa
    .from('products')
    .select('id, name, seller_id, external_marketplace, external_data, external_source_url, external_synced_at')
    .not('external_source_url', 'is', null)
    .order('external_synced_at', { ascending: true, nullsFirst: true })
    .limit(BATCH * 3);
  if (error) return ApiErrors.internal(error.message);

  const rows = ((data ?? []) as Row[]).filter((r) => isStale(r.external_synced_at)).slice(0, BATCH);

  let checked = 0, alerts = 0, errors = 0;
  const now = new Date().toISOString();

  for (const r of rows) {
    const prev = r.external_data;
    const query = prev?.source_title || r.name || '';
    if (!query) continue;
    try {
      const extract = await fetchExternalSnapshot(query, r.external_marketplace ?? undefined);
      checked += 1;

      const next = { price: extract.price, availability: extract.external.availability };
      const delta = prev ? detectExternalChange({ price: prev.price, availability: prev.availability }, next) : null;

      // Aggiorna sempre lo snapshot (così il prodotto non resta stale ad ogni giro).
      const newData: ExternalData = { ...extract.external, fetched_at: now };
      await supa
        .from('products')
        .update({ external_data: newData, external_synced_at: now, external_sync_status: 'idle' })
        .eq('id', r.id);

      if (delta && r.seller_id) {
        const { title, body } = changeMessage(r.name ?? 'prodotto', delta);
        await supa.from('notifications').insert({
          user_id: r.seller_id,
          title,
          body,
          link: `/seller/products/${r.id}/edit`,
        });
        alerts += 1;
      }
    } catch (err) {
      errors += 1;
      logger.warn('external-price-alerts: check failed', { productId: r.id });
      // Marca come errore per non ritentare in loop stretto.
      await supa.from('products').update({ external_sync_status: 'error', external_synced_at: now }).eq('id', r.id);
    }
  }

  return NextResponse.json({ ok: true, candidates: rows.length, checked, alerts, errors });
});

export const POST = handler;
export const GET = handler;

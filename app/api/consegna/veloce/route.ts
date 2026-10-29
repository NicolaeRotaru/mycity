import { NextResponse } from 'next/server';
import { getAdminSupabase } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { romeNow } from '@/lib/store-hours';
import { contaFattoriniOnline, veloceSiPuo, type EsitoVeloce } from '@/lib/ordini/consegna-veloce';

/**
 * GET /api/consegna/veloce?negozi=<id>,<id> — la cassa e il carrello chiedono qui se possono
 * offrire «Adesso». La decisione è `veloceSiPuo`, la stessa delle due rotte che creano l'ordine.
 * Risponde solo sì/no e il perché: nessun dato dei fattorini esce da qui.
 */
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_NEGOZI = 20;
const NON_RIESCO: EsitoVeloce = {
  possibile: false,
  perche: 'Adesso non riesco a confermare la consegna veloce. Scegli una fascia oraria.',
};

function rispondi(esito: EsitoVeloce, status = 200) {
  return NextResponse.json(esito, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function GET(req: Request) {
  const ids = Array.from(
    new Set(
      (new URL(req.url).searchParams.get('negozi') ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  );
  if (ids.length > MAX_NEGOZI || ids.some((id) => !UUID.test(id))) {
    return rispondi({ possibile: false, perche: 'Richiesta non valida.' }, 400);
  }
  try {
    const admin = getAdminSupabase();
    let negozi: Array<{ nome: string; orari: unknown }> | null = [];
    if (ids.length > 0) {
      const { data, error } = await admin.from('profiles').select('id, store_name, store_hours').in('id', ids);
      if (error || !data || data.length !== ids.length) {
        logger.error('consegna veloce: orari dei negozi non letti', { error: error?.message, chiesti: ids.length });
        negozi = null;
      } else {
        negozi = data.map((p) => ({ nome: p.store_name ?? 'Il negozio', orari: p.store_hours }));
      }
    }
    const fattoriniOnline = await contaFattoriniOnline(admin);
    if (fattoriniOnline === null) logger.error('consegna veloce: fattorini online non letti');
    return rispondi(veloceSiPuo({ adesso: romeNow(), negozi, fattoriniOnline }));
  } catch (e) {
    logger.error('consegna veloce: verifica non riuscita', { error: e instanceof Error ? e.message : String(e) });
    return rispondi(NON_RIESCO);
  }
}

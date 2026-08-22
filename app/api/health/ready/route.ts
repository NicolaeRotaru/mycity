import { NextResponse, type NextRequest } from 'next/server';
import { getAdminSupabase } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * «È pronto a servire?» — la domanda che include il database.
 *
 * 22/8/2026 — PERCHÉ QUESTA ROTTA È SEPARATA DA /api/health.
 *
 * Quella la interroga l'hosting per decidere se ammazzare il processo. Se ci si
 * mette dentro il database, un database lento fa riavviare istanze sane: si
 * perdono le richieste in corso, il processo riparte, ritrova lo stesso
 * database lento, riparte di nuovo. Un rallentamento diventa un blackout, per
 * mano nostra.
 *
 * Qui invece ci può stare, perché questa rotta la guarda un monitor esterno:
 * avvisa una persona, non riavvia niente. È la stessa distinzione che fanno i
 * sistemi di orchestrazione fra «vivo» e «pronto», e serve esattamente a questo.
 */
const TETTO_MS = 3000;

export async function GET(_req: NextRequest): Promise<NextResponse> {
  const t0 = Date.now();
  let dbOk = false;
  let dettaglio: string | undefined;

  try {
    const admin = getAdminSupabase();
    const query = admin.from('categories').select('id').limit(1);
    const esito = await Promise.race([
      query.then(({ error }) => ({ scaduto: false as const, error })),
      new Promise<{ scaduto: true; error: null }>((r) =>
        setTimeout(() => r({ scaduto: true, error: null }), TETTO_MS)),
    ]);
    if (esito.scaduto) dettaglio = `nessuna risposta entro ${TETTO_MS}ms`;
    else if (esito.error) dettaglio = esito.error.message;
    else dbOk = true;
  } catch (e) {
    dettaglio = e instanceof Error ? e.message : 'errore sconosciuto';
  }

  return NextResponse.json(
    {
      status: dbOk ? 'ready' : 'not_ready',
      db: { ok: dbOk, latencyMs: Date.now() - t0, error: dettaglio },
      timestamp: new Date().toISOString(),
    },
    { status: dbOk ? 200 : 503, headers: { 'cache-control': 'no-store' } },
  );
}

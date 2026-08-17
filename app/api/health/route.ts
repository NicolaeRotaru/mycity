import { NextResponse } from 'next/server';
import { getAdminSupabase } from '@/lib/supabase/server';

export const runtime = 'nodejs';
// Sempre fresh: i monitor esterni devono sapere lo stato reale, no cache.
export const dynamic = 'force-dynamic';

/**
 * Health check endpoint per uptime monitor esterni (UptimeRobot, BetterStack).
 *
 * Esperti consultati:
 * - SRE: "Health check NON deve fare query pesanti. SELECT 1 sul DB e basta.
 *   Se piu' di 1s di response time, il monitor pinga troppo spesso."
 * - Security: "Non esporre version, build hash, env. Solo status + timestamp."
 *
 * Stati possibili:
 * - 200 ok: tutto verde
 * - 503 service_unavailable: DB raggiungibile ma con problemi (slow, etc)
 * - 500: errore non recuperabile
 *
 * NON protetto da auth: deve essere pingabile esternamente.
 */
export async function GET() {
  const startedAt = Date.now();
  const checks: Record<string, { ok: boolean; latencyMs?: number; error?: string }> = {};

  // Check 1: Supabase DB raggiungibile, con un tetto di tempo.
  // Senza tetto, un database lento teneva la richiesta appesa: e questo
  // endpoint e' quello che Render interroga per decidere se l'istanza e' viva,
  // quindi un database lento diventava un'istanza dichiarata morta e riavviata.
  const TETTO_MS = 3000;
  try {
    const admin = getAdminSupabase();
    const t0 = Date.now();
    const query = admin.from('categories').select('id').limit(1);
    const esito = await Promise.race([
      query.then(({ error }) => ({ scaduto: false, error })),
      new Promise<{ scaduto: true; error: null }>((r) =>
        setTimeout(() => r({ scaduto: true, error: null }), TETTO_MS)),
    ]);
    checks.db = esito.scaduto
      ? { ok: false, latencyMs: TETTO_MS, error: `nessuna risposta entro ${TETTO_MS}ms` }
      : { ok: !esito.error, latencyMs: Date.now() - t0, error: esito.error?.message };
  } catch (e) {
    checks.db = { ok: false, error: e instanceof Error ? e.message : 'unknown' };
  }

  // Check 2: le variabili senza cui il marketplace non incassa e non scrive.
  // Prima l'elenco ne conteneva tre e lasciava fuori pagamenti, webhook, posta
  // e segreto dei lavori periodici: il sito risultava «a posto» mentre nessun
  // ordine poteva essere pagato.
  const requiredEnv = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'NEXT_PUBLIC_APP_URL',
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'RESEND_API_KEY',
    'CRON_SECRET',
  ];
  const missingEnv = requiredEnv.filter((k) => !process.env[k]);
  checks.env = { ok: missingEnv.length === 0, error: missingEnv.join(',') || undefined };

  const allOk = Object.values(checks).every((c) => c.ok);
  const status = allOk ? 'ok' : 'degraded';
  const httpStatus = allOk ? 200 : 503;

  return NextResponse.json(
    {
      status,
      timestamp: new Date().toISOString(),
      uptimeSec: process.uptime?.() ?? null,
      latencyMs: Date.now() - startedAt,
      checks,
    },
    { status: httpStatus, headers: { 'cache-control': 'no-store' } },
  );
}

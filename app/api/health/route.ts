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

  // Check 1: Supabase DB raggiungibile
  try {
    const admin = getAdminSupabase();
    const t0 = Date.now();
    const { error } = await admin.from('categories').select('id').limit(1);
    checks.db = { ok: !error, latencyMs: Date.now() - t0, error: error?.message };
  } catch (e) {
    checks.db = { ok: false, error: e instanceof Error ? e.message : 'unknown' };
  }

  // Check 2: env vars critiche presenti
  const requiredEnv = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'NEXT_PUBLIC_APP_URL',
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

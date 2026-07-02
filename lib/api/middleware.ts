import type { NextRequest, NextResponse } from 'next/server';
import { createClient, type User } from '@supabase/supabase-js';
import { timingSafeEqual } from 'node:crypto';
import { ApiErrors } from './responses';
import { rateLimitAsync } from '@/lib/rate-limit';
import { purchaseBlockReason } from '@/lib/shopping-access';

/** Confronto a tempo costante per secret (anti timing-attack). */
function secretsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Middleware riusabili per API routes.
 *
 * Esperti consultati:
 * - Backend Engineer: "Auth boilerplate in 25 routes = -200 LOC. Helper aspetta
 *   solo (req, handler) e estrae bearer + auth + role check."
 * - Security Engineer: "Bearer token verification + role check + rate limit
 *   = 3 layer obbligatori per endpoint sensibili."
 */

type Profile = { id: string; role: string; is_approved: boolean };
type Handler<T> = (ctx: { user: User; profile: Profile; req: NextRequest }) => Promise<NextResponse<T>>;
type GenericHandler = (ctx: { user: User; profile: Profile; req: NextRequest }) => Promise<NextResponse>;

function getSupabaseAuthClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function authenticate(req: NextRequest): Promise<
  | { ok: true; user: User; profile: Profile }
  | { ok: false; response: NextResponse }
> {
  // Tentativo 1: Bearer token nell'Authorization header (client fetch)
  const authHeader = req.headers.get('authorization');
  const bearer = authHeader?.toLowerCase().startsWith('bearer ')
    ? authHeader.slice(7).trim()
    : null;

  let user: User | null = null;

  if (bearer) {
    const supa = getSupabaseAuthClient();
    if (!supa) return { ok: false, response: ApiErrors.unavailable('Auth non configurato') };
    const { data, error } = await supa.auth.getUser(bearer);
    if (!error && data?.user) user = data.user;
  } else {
    // Tentativo 2: cookie session (server-side)
    try {
      const { getCurrentUser } = await import('@/lib/supabase/server');
      user = await getCurrentUser();
    } catch { /* server module non disponibile in alcuni contesti */ }
  }

  if (!user) return { ok: false, response: ApiErrors.unauthorized() };

  // Fetch profile via service-role (admin), NON via client anon. Il client anon
  // non porta la sessione utente: con auth.uid()=NULL le policy RLS di `profiles`
  // non espongono la riga di un buyer/rider ordinario (solo i seller approvati
  // sono pubblici), quindi ogni route withAuth* risponderebbe 403 "Profilo non
  // trovato". L'admin bypassa RLS in modo sicuro (server-only). Vedi audit 🔴-1.
  let profile: Profile | null = null;
  try {
    const { getAdminSupabase } = await import('@/lib/supabase/server');
    const { data } = await getAdminSupabase()
      .from('profiles')
      .select('id, role, is_approved')
      .eq('id', user.id)
      .single();
    profile = (data as Profile | null) ?? null;
  } catch {
    return { ok: false, response: ApiErrors.unavailable('Auth non configurato') };
  }
  if (!profile) return { ok: false, response: ApiErrors.forbidden('Profilo non trovato') };

  return { ok: true, user, profile };
}

/** Blocco acquisto per ruolo (admin, rider, …). Null = può acquistare. */
export function assertCanPurchase(profile: Profile): NextResponse | null {
  const reason = purchaseBlockReason(profile.role);
  return reason ? ApiErrors.forbidden(reason) : null;
}

/**
 * Wrapper: richiede auth (qualsiasi role).
 *   export const POST = withAuth(async ({ user, profile }) => {...});
 */
export function withAuth(handler: GenericHandler) {
  return async (req: NextRequest): Promise<NextResponse> => {
    const auth = await authenticate(req);
    if (!auth.ok) return auth.response;
    return handler({ user: auth.user, profile: auth.profile, req });
  };
}

/**
 * Wrapper: richiede auth + rate limit per-user.
 *
 * Esempio:
 *   export const POST = withAuthRateLimit(
 *     { name: 'returns-create', max: 10, windowMs: 60_000 },
 *     async ({ user }) => {...}
 *   );
 *
 * Il rate limit usa user.id come chiave (piu' robusto di IP per utenti
 * autenticati: condivisione IP in NAT/CGNAT non penalizza). Risponde 429
 * con Retry-After se superato.
 */
export type AuthRateLimitOpts = {
  name: string;
  max: number;
  windowMs: number;
};

export function withAuthRateLimit(opts: AuthRateLimitOpts, handler: GenericHandler) {
  return async (req: NextRequest): Promise<NextResponse> => {
    const auth = await authenticate(req);
    if (!auth.ok) return auth.response;
    const rl = await rateLimitAsync({ key: `${opts.name}:${auth.user.id}`, max: opts.max, windowMs: opts.windowMs });
    if (!rl.allowed) return ApiErrors.rateLimited(rl.retryAfterSec);
    return handler({ user: auth.user, profile: auth.profile, req });
  };
}

/**
 * Wrapper: richiede auth + role 'seller' approvato (o admin).
 */
export function withSellerAuth(handler: GenericHandler) {
  return async (req: NextRequest): Promise<NextResponse> => {
    const auth = await authenticate(req);
    if (!auth.ok) return auth.response;
    const { profile } = auth;
    if (profile.role !== 'admin' && (profile.role !== 'seller' || !profile.is_approved)) {
      return ApiErrors.forbidden('Solo seller approvati o admin');
    }
    return handler({ user: auth.user, profile: auth.profile, req });
  };
}

/**
 * Wrapper: richiede auth + role 'seller' approvato (o admin) + rate limit.
 */
export function withSellerAuthRateLimit(opts: AuthRateLimitOpts, handler: GenericHandler) {
  return async (req: NextRequest): Promise<NextResponse> => {
    const auth = await authenticate(req);
    if (!auth.ok) return auth.response;
    const { profile } = auth;
    if (profile.role !== 'admin' && (profile.role !== 'seller' || !profile.is_approved)) {
      return ApiErrors.forbidden('Solo seller approvati o admin');
    }
    const rl = await rateLimitAsync({ key: `${opts.name}:${auth.user.id}`, max: opts.max, windowMs: opts.windowMs });
    if (!rl.allowed) return ApiErrors.rateLimited(rl.retryAfterSec);
    return handler({ user: auth.user, profile: auth.profile, req });
  };
}

/**
 * Wrapper: richiede auth + role 'admin'.
 */
export function withAdminAuth(handler: GenericHandler) {
  return async (req: NextRequest): Promise<NextResponse> => {
    const auth = await authenticate(req);
    if (!auth.ok) return auth.response;
    if (auth.profile.role !== 'admin') return ApiErrors.forbidden('Solo admin');
    return handler({ user: auth.user, profile: auth.profile, req });
  };
}

/**
 * Wrapper: richiede auth + role 'admin' + rate limit per-user.
 */
export function withAdminAuthRateLimit(opts: AuthRateLimitOpts, handler: GenericHandler) {
  return async (req: NextRequest): Promise<NextResponse> => {
    const auth = await authenticate(req);
    if (!auth.ok) return auth.response;
    if (auth.profile.role !== 'admin') return ApiErrors.forbidden('Solo admin');
    const rl = await rateLimitAsync({ key: `${opts.name}:${auth.user.id}`, max: opts.max, windowMs: opts.windowMs });
    if (!rl.allowed) return ApiErrors.rateLimited(rl.retryAfterSec);
    return handler({ user: auth.user, profile: auth.profile, req });
  };
}

/**
 * Heartbeat best-effort del cron (audit 🟠-25): registra l'ultima esecuzione in
 * cron_heartbeats, così operational-alerts può accorgersi se un cron SMETTE di
 * girare (dead-man's switch). Trasparente per tutti i cron (passano da qui).
 * Tutto in try/catch fire-and-forget: non deve MAI far fallire il cron.
 */
async function recordCronHeartbeat(req: NextRequest): Promise<void> {
  try {
    const name = new URL(req.url).pathname.split('/').filter(Boolean).pop();
    if (!name) return;
    const { getAdminSupabase } = await import('@/lib/supabase/server');
    await getAdminSupabase()
      .from('cron_heartbeats')
      .upsert({ name, last_run_at: new Date().toISOString() }, { onConflict: 'name' });
  } catch {
    /* best-effort: il heartbeat non deve mai bloccare o far fallire il cron. */
  }
}

/**
 * Wrapper: richiede CRON_SECRET nell'header Authorization.
 * Per endpoint chiamati da cron esterni (cron-job.org, Vercel cron).
 */
export function withCronAuth(handler: (req: NextRequest) => Promise<NextResponse>) {
  return async (req: NextRequest): Promise<NextResponse> => {
    const expected = process.env.CRON_SECRET;
    if (!expected) return ApiErrors.unavailable('CRON_SECRET non configurato');
    const authHeader = req.headers.get('authorization');
    const bearer = authHeader?.toLowerCase().startsWith('bearer ')
      ? authHeader.slice(7).trim()
      : null;
    if (!secretsMatch(bearer, expected)) return ApiErrors.unauthorized();
    void recordCronHeartbeat(req); // dead-man's switch (🟠-25), best-effort
    return handler(req);
  };
}

/**
 * Wrapper: richiede x-internal-secret per endpoint server-to-server (trigger DB,
 * cron interni, edge functions). Non esporre mai a client browser.
 *
 * 🟡-1: usa un secret DEDICATO `INTERNAL_API_SECRET` (rotabile indipendentemente,
 * blast-radius ridotto). Fallback a `SUPABASE_SERVICE_ROLE_KEY` per retro-
 * compatibilità con i caller esistenti finché non viene configurato il dedicato.
 */
export function withInternalAuth(handler: (req: NextRequest) => Promise<NextResponse>) {
  return async (req: NextRequest): Promise<NextResponse> => {
    const expected = process.env.INTERNAL_API_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
    const provided = req.headers.get('x-internal-secret');
    if (!secretsMatch(provided, expected)) {
      return ApiErrors.forbidden();
    }
    return handler(req);
  };
}

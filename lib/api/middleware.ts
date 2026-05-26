import type { NextRequest, NextResponse } from 'next/server';
import { createClient, type User } from '@supabase/supabase-js';
import { ApiErrors } from './responses';

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
  const supa = getSupabaseAuthClient();
  if (!supa) return { ok: false, response: ApiErrors.unavailable('Auth non configurato') };

  const authHeader = req.headers.get('authorization');
  const bearer = authHeader?.toLowerCase().startsWith('bearer ')
    ? authHeader.slice(7).trim()
    : null;
  if (!bearer) return { ok: false, response: ApiErrors.unauthorized() };

  const { data: { user }, error: userErr } = await supa.auth.getUser(bearer);
  if (userErr || !user) return { ok: false, response: ApiErrors.unauthorized('Sessione non valida') };

  const { data: profile } = await supa
    .from('profiles')
    .select('id, role, is_approved')
    .eq('id', user.id)
    .single();
  if (!profile) return { ok: false, response: ApiErrors.forbidden('Profilo non trovato') };

  return { ok: true, user, profile: profile as Profile };
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
    if (bearer !== expected) return ApiErrors.unauthorized();
    return handler(req);
  };
}

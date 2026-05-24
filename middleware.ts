import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

/**
 * Middleware strict: il client browser usa @supabase/ssr, la sessione
 * viaggia nei cookie. Il middleware verifica il JWT lato server in
 * modo affidabile e fa due cose:
 *
 *  1) Refresh dei cookie sessione se scaduti (chiamando getUser()).
 *  2) Enforcement delle aree role-protected (/admin, /seller, /rider):
 *     se l'utente non ha il ruolo giusto, redirect a /.
 *  3) Gate verifica email: se non confermata, redirect a /auth/verify-email.
 */

const ROLE_PROTECTED: Array<{ prefix: string; allowed: ('admin' | 'seller' | 'rider')[] }> = [
  { prefix: '/admin',  allowed: ['admin'] },
  { prefix: '/seller', allowed: ['seller', 'admin'] },
  { prefix: '/rider',  allowed: ['rider', 'admin'] },
];

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function findRoleRule(pathname: string) {
  return ROLE_PROTECTED.find((r) => pathname.startsWith(r.prefix));
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const res = NextResponse.next({ request: { headers: req.headers } });

  if (!SUPABASE_URL || !SUPABASE_KEY) return res;

  // Client server-side che legge/scrive cookie su richiesta+risposta.
  const supabase = createServerClient(SUPABASE_URL, SUPABASE_KEY, {
    cookies: {
      get(name: string) {
        return req.cookies.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        req.cookies.set({ name, value, ...options });
        res.cookies.set({ name, value, ...options });
      },
      remove(name: string, options: CookieOptions) {
        req.cookies.set({ name, value: '', ...options });
        res.cookies.set({ name, value: '', ...options });
      },
    },
  });

  // Refresh sessione (best-effort)
  const { data: userResp } = await supabase.auth.getUser();
  const user = userResp?.user ?? null;

  const roleRule = findRoleRule(pathname);
  if (!roleRule) return res;

  if (!user) {
    const url = req.nextUrl.clone();
    url.pathname = '/sign-in';
    url.searchParams.set('returnTo', pathname);
    return NextResponse.redirect(url);
  }

  if (!user.email_confirmed_at) {
    const url = req.nextUrl.clone();
    url.pathname = '/auth/verify-email';
    return NextResponse.redirect(url);
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, is_approved')
    .eq('id', user.id)
    .single();

  const role = profile?.role as 'buyer' | 'seller' | 'rider' | 'admin' | undefined;
  const approved = !!profile?.is_approved;

  if (!role || !roleRule.allowed.includes(role as any) || !approved) {
    const url = req.nextUrl.clone();
    url.pathname = '/';
    return NextResponse.redirect(url);
  }

  return res;
}

export const config = {
  matcher: [
    '/((?!_next/|api/|favicon|icon-|manifest|sitemap|robots).*)',
  ],
};

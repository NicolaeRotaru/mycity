import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Route che richiedono ruolo specifico server-side. La protezione client
// nei layout resta come UX, ma qui blocchiamo prima ancora di renderizzare.
const ROLE_PROTECTED: Array<{ prefix: string; allowed: ('admin' | 'seller' | 'rider')[] }> = [
  { prefix: '/admin',  allowed: ['admin'] },
  { prefix: '/seller', allowed: ['seller', 'admin'] },
  { prefix: '/rider',  allowed: ['rider', 'admin'] },
];

// Aree che richiedono solo autenticazione (qualsiasi ruolo).
const AUTH_REQUIRED_PREFIXES = [
  '/profile',
  '/checkout',
  '/orders',
  '/favorites',
  '/notifications',
  '/cart',
];

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function findRoleRule(pathname: string) {
  return ROLE_PROTECTED.find((r) => pathname.startsWith(r.prefix));
}

function needsAuth(pathname: string) {
  return AUTH_REQUIRED_PREFIXES.some((p) => pathname.startsWith(p));
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const roleRule = findRoleRule(pathname);
  const authOnly = !roleRule && needsAuth(pathname);

  if (!roleRule && !authOnly) return NextResponse.next();
  if (!SUPABASE_URL || !SUPABASE_KEY) return NextResponse.next();

  // Estrae il JWT Supabase dal cookie. Supabase salva i token come cookie
  // "sb-<project>-auth-token" in formato JSON. Tolleriamo nomi diversi.
  const authCookie = req.cookies
    .getAll()
    .find((c) => c.name.startsWith('sb-') && c.name.endsWith('-auth-token'));

  let accessToken: string | null = null;
  if (authCookie?.value) {
    try {
      // Cookie chunked (v2): potrebbe iniziare con "base64-" + payload base64
      const raw = authCookie.value.startsWith('base64-')
        ? atob(authCookie.value.slice('base64-'.length))
        : authCookie.value;
      const parsed = JSON.parse(raw);
      accessToken = parsed?.access_token ?? null;
    } catch {
      accessToken = null;
    }
  }

  // Nessuna sessione → redirect a sign-in con returnTo
  if (!accessToken) {
    const url = req.nextUrl.clone();
    url.pathname = '/sign-in';
    url.searchParams.set('returnTo', pathname);
    return NextResponse.redirect(url);
  }

  // Se è solo auth-required, basta il token
  if (authOnly) return NextResponse.next();

  // Verifica ruolo via Supabase REST (no SDK in edge runtime per evitare bundle pesante)
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userResp } = await supabase.auth.getUser(accessToken);
    const userId = userResp?.user?.id;
    if (!userId) {
      const url = req.nextUrl.clone();
      url.pathname = '/sign-in';
      url.searchParams.set('returnTo', pathname);
      return NextResponse.redirect(url);
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('role, is_approved')
      .eq('id', userId)
      .single();

    const role = profile?.role as 'buyer' | 'seller' | 'rider' | 'admin' | undefined;
    const approved = !!profile?.is_approved;

    if (!role || !roleRule!.allowed.includes(role as any) || !approved) {
      const url = req.nextUrl.clone();
      url.pathname = '/';
      return NextResponse.redirect(url);
    }

    return NextResponse.next();
  } catch {
    // In caso di errore di rete non blocchiamo l'utente, il layout client farà
    // comunque la sua verifica (defense in depth).
    return NextResponse.next();
  }
}

export const config = {
  // Esclude asset statici e api per non rallentare ogni richiesta
  matcher: ['/((?!_next/|api/|favicon|icon-|manifest|sitemap|robots).*)'],
};

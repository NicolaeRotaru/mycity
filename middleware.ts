import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// NOTA IMPORTANTE
// ----------------
// In questa app il client Supabase usa localStorage (default), quindi la
// sessione NON viaggia nei cookie HTTP. Il middleware non può quindi
// verificarla in modo affidabile lato server.
//
// Per non rompere la navigazione, il middleware funziona in modalità
// "defense-in-depth": se trova un cookie Supabase valido e l'utente non
// ha i permessi giusti, blocca; altrimenti lascia passare e si affida al
// check client-side nei layout di /admin, /seller, /rider.
//
// Per protezione server-side reale, in futuro: switch a `@supabase/ssr`
// con `createServerClient` (sessione in cookie firmati) e poi questo
// middleware potrà essere strict.

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
  const roleRule = findRoleRule(pathname);

  // Solo le aree role-protected attivano la verifica. Per /profile, /orders,
  // /cart, ecc. ci affidiamo al client perché senza cookie non possiamo
  // distinguere un guest da un utente loggato via localStorage.
  if (!roleRule) return NextResponse.next();
  if (!SUPABASE_URL || !SUPABASE_KEY) return NextResponse.next();

  // Cerca cookie Supabase. Se non c'è, lascia passare (client farà il check).
  const authCookie = req.cookies
    .getAll()
    .find((c) => c.name.startsWith('sb-') && c.name.endsWith('-auth-token'));
  if (!authCookie?.value) return NextResponse.next();

  let accessToken: string | null = null;
  try {
    const raw = authCookie.value.startsWith('base64-')
      ? atob(authCookie.value.slice('base64-'.length))
      : authCookie.value;
    const parsed = JSON.parse(raw);
    accessToken = parsed?.access_token ?? null;
  } catch {
    return NextResponse.next();
  }
  if (!accessToken) return NextResponse.next();

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userResp } = await supabase.auth.getUser(accessToken);
    const userId = userResp?.user?.id;
    if (!userId) return NextResponse.next();

    const { data: profile } = await supabase
      .from('profiles')
      .select('role, is_approved')
      .eq('id', userId)
      .single();

    const role = profile?.role as 'buyer' | 'seller' | 'rider' | 'admin' | undefined;
    const approved = !!profile?.is_approved;

    // Solo se siamo SICURI che l'utente non ha il ruolo, blocca.
    if (role && (!roleRule.allowed.includes(role as any) || !approved)) {
      const url = req.nextUrl.clone();
      url.pathname = '/';
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  } catch {
    return NextResponse.next();
  }
}

export const config = {
  matcher: ['/((?!_next/|api/|favicon|icon-|manifest|sitemap|robots).*)'],
};

import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { env, requireSupabasePublic } from '@/lib/env';

export const runtime = 'nodejs';

/**
 * Callback PKCE / OAuth / email confirmation.
 * Supabase Auth invia gli utenti qui dopo:
 *  - conferma email registrazione
 *  - reset password
 *  - login via provider OAuth (se configurato)
 *
 * Scambia il `code` con una sessione e setta i cookie httpOnly via
 * @supabase/ssr. Poi redirect a `next` (sanificato) o a `/`.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const nextParam = url.searchParams.get('next') ?? '/';
  // Sanitize: solo path interni
  const next = nextParam.startsWith('/') && !nextParam.startsWith('//') ? nextParam : '/';

  if (!code) {
    return NextResponse.redirect(new URL('/sign-in?error=missing_code', env.appUrl()));
  }

  const { url: supaUrl, key: supaKey } = requireSupabasePublic();
  const res = NextResponse.redirect(new URL(next, env.appUrl()));

  const supabase = createServerClient(supaUrl, supaKey, {
    cookies: {
      get(name: string) {
        return req.cookies.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        res.cookies.set({ name, value, ...options });
      },
      remove(name: string, options: CookieOptions) {
        res.cookies.set({ name, value: '', ...options });
      },
    },
  });

  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(new URL('/sign-in?error=callback_failed', env.appUrl()));
  }

  // Chi entra con Google finiva nel funnel come se non fosse mai entrato.
  //
  // Gli eventi di registrazione e di accesso venivano emessi solo dai moduli
  // email/password. Il percorso Google passa da qui, e qui non c'era nulla:
  // quindi «quanti si registrano» e «quanti accedono» contavano solo una parte
  // delle persone, e la parte esclusa era proprio quella che fa meno fatica a
  // iscriversi. Il segnale si passa al browser con un parametro, e la pagina di
  // arrivo emette l'evento: qui siamo sul server, dove PostHog non gira.
  const utente = data?.user;
  const destinazione = new URL(next, env.appUrl());
  if (utente) {
    const creato = utente.created_at ? new Date(utente.created_at).getTime() : 0;
    const appenaNato = creato > 0 && Date.now() - creato < 60_000;
    destinazione.searchParams.set('auth', appenaNato ? 'signup' : 'signin');
    destinazione.searchParams.set('via', 'oauth');
  }

  // Il redirect va ricostruito con la destinazione aggiornata, tenendo i cookie
  // di sessione che `res` ha raccolto durante lo scambio.
  const finale = NextResponse.redirect(destinazione);
  for (const c of res.cookies.getAll()) finale.cookies.set(c);
  return finale;
}

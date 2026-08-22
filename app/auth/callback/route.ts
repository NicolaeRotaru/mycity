import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { env, requireSupabasePublic } from '@/lib/env';
import { safeInternalPath } from '@/lib/safe-redirect';
import { getAdminSupabase } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';

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
  // 019: il controllo scritto a mano qui lasciava passare `/\evil.com`, che i
  // browser normalizzano in `//evil.com` — cioè un sito esterno. La funzione
  // giusta esiste già ed è una sola per tutti i ritorni: quando si corregge, si
  // corregge ovunque.
  const next = safeInternalPath(nextParam, '/');

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

  /**
   * #79 — Il verbale dell'accettazione, scritto dal server.
   *
   * Chi si registra spunta «accetto Termini e Informativa», e finora quella
   * spunta viveva solo nel browser: nessuna riga da nessuna parte, nessuna
   * versione del testo. Qui c'e' la sessione vera, quindi l'utente e' quello
   * che dice di essere: si registra una volta sola, al primo accesso.
   */
  if (utente) {
    /**
     * 22/8/2026 — LA VERSIONE ARRIVA ANCHE DALL'INDIRIZZO DI RITORNO.
     *
     * Chi si registra con email e password porta la versione dei testi dentro
     * i propri dati. Chi entra con Google no: quel percorso non passava da
     * nessuna spunta, e qui la versione era sempre vuota — quindi il verbale
     * non si scriveva e la persona restava operativa senza aver accettato
     * niente. Adesso il pulsante Google mette la versione nell'indirizzo di
     * ritorno, e questa e' la riga che la raccoglie.
     */
    const versione =
      (utente.user_metadata?.versione_testi_accettati as string | undefined) ??
      req.nextUrl.searchParams.get('versione') ??
      null;
    if (versione) {
      try {
        const admin = getAdminSupabase();
        const { data: profilo } = await admin
          .from('profiles')
          .select('tos_accepted_at')
          .eq('id', utente.id)
          .maybeSingle();
        if (profilo && !profilo.tos_accepted_at) {
          const adesso = new Date().toISOString();
          await admin.from('consent_log').insert({
            user_id: utente.id,
            categoria: 'privacy_terms',
            valore: true,
            versione_testo: versione.slice(0, 60),
            ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
            user_agent: req.headers.get('user-agent')?.slice(0, 300) ?? null,
          });
          await admin.from('profiles').update({ tos_accepted_at: adesso }).eq('id', utente.id);
        }
      } catch (e) {
        logger.warn('[callback] accettazione dei testi non registrata', { e });
      }
    } else {
      /**
       * 22/8/2026 — SENZA VERSIONE NON SI TIRA DRITTO IN SILENZIO.
       *
       * Qui, quando la versione mancava, non succedeva niente: l'utente
       * arrivava operativo senza aver accettato Termini e Informativa e senza
       * una riga che lo dicesse. Adesso, se non risulta nemmeno un'accettazione
       * precedente, si passa da una pagina che la chiede. Chi l'aveva gia'
       * accettata non se ne accorge.
       */
      try {
        const admin = getAdminSupabase();
        const { data: profilo } = await admin
          .from('profiles')
          .select('tos_accepted_at')
          .eq('id', utente.id)
          .maybeSingle();
        if (profilo && !profilo.tos_accepted_at) {
          const chiedi = new URL('/accetta-condizioni', env.appUrl());
          chiedi.searchParams.set('next', next);
          return NextResponse.redirect(chiedi);
        }
      } catch (e) {
        logger.warn('[callback] accettazione dei testi non verificabile', { e });
      }
    }
  }

  const destinazione = new URL(next, env.appUrl());
  if (utente) {
    const creato = utente.created_at ? new Date(utente.created_at).getTime() : 0;
    const appenaNato = creato > 0 && Date.now() - creato < 60_000;
    destinazione.searchParams.set('auth', appenaNato ? 'signup' : 'signin');
    // #214 — Il canale vero. Prima qui c'era scritto 'oauth' per tutti, anche
    // per chi arrivava dal link di conferma di una registrazione con email:
    // il dato diceva il contrario di quello che era successo.
    const canale = (utente.app_metadata?.provider as string | undefined) ?? 'email';
    destinazione.searchParams.set('via', canale);
  }

  // Il redirect va ricostruito con la destinazione aggiornata, tenendo i cookie
  // di sessione che `res` ha raccolto durante lo scambio.
  const finale = NextResponse.redirect(destinazione);
  for (const c of res.cookies.getAll()) finale.cookies.set(c);
  return finale;
}

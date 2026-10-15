import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { env, requireSupabasePublic } from '@/lib/env';
import { safeInternalPath } from '@/lib/safe-redirect';
import { getAdminSupabase } from '@/lib/supabase/server';
import { getClientIp } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { rimandoDelRitornoSenzaSessione } from '@/lib/auth/link-email';
import { vaChiestaLAccettazione, verbalizzaSenzaTrattenere, versioneAccettata } from '@/lib/auth/accettazione-testi';

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

  /**
   * 15/10/2026 (R13) — CHI ARRIVA SENZA SESSIONE NON ATTERRA PIU' SU UNA PAGINA MUTA.
   *
   * Prima: `/sign-in?error=…` e basta, e la pagina di accesso quell'errore non
   * lo leggeva. Adesso il motivo e' uno che la pagina sa spiegare, e la strada
   * da cui si veniva (`next`) resta, cosi' dopo l'accesso si torna li'.
   */
  if (!code) {
    return NextResponse.redirect(new URL(rimandoDelRitornoSenzaSessione(url.searchParams, next, 'senza-codice'), env.appUrl()));
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
    // Il caso piu' comune: il link della conferma aperto su un altro
    // dispositivo, senza il cookie del browser di partenza. L'email a quel
    // punto e' gia' confermata: lo si dice, e si accede con la password.
    logger.warn('[callback] scambio del codice non riuscito', { codice: error.code ?? null });
    return NextResponse.redirect(new URL(rimandoDelRitornoSenzaSessione(url.searchParams, next, 'scambio-fallito'), env.appUrl()));
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
    //
    // 15/10/2026 (R13) — Il verbale ora lo scrive `lib/auth/accettazione-testi.ts`,
    // la stessa copia usata da /auth/confirm e dall'accesso con la password.
    const versione = versioneAccettata(utente, req.nextUrl.searchParams.get('versione'));
    try {
      const admin = getAdminSupabase();
      if (versione) {
        // 27/8/2026 (R024 · R062) — `getClientIp` legge da destra scartando i
        // proxy fidati: l'indirizzo nel verbale non se lo detta l'utente.
        // Mai oltre `TETTO_VERBALE_MS`: un database muto non trattiene l'ingresso.
        const verbale = await verbalizzaSenzaTrattenere(() => admin, {
          utenteId: utente.id,
          versione,
          ip: getClientIp(req),
          userAgent: req.headers.get('user-agent'),
        });
        if (verbale === 'scaduto' || verbale === 'rotto' || verbale === 'non-scritta') {
          logger.warn('[callback] accettazione dei testi non registrata', { esito: verbale });
        }
      } else if (await vaChiestaLAccettazione(admin, utente.id)) {
        /**
         * 22/8/2026 — SENZA VERSIONE NON SI TIRA DRITTO IN SILENZIO.
         *
         * Qui, quando la versione mancava, non succedeva niente: l'utente
         * arrivava operativo senza aver accettato Termini e Informativa e senza
         * una riga che lo dicesse. Adesso, se non risulta nemmeno un'accettazione
         * precedente, si passa da una pagina che la chiede. Chi l'aveva gia'
         * accettata non se ne accorge.
         *
         * 15/10/2026 — Con i cookie della sessione appena aperta: senza, la
         * pagina che chiede l'accettazione trovava una persona non entrata e il
         * suo «accetto» rispondeva «autenticazione richiesta».
         */
        const chiedi = new URL('/accetta-condizioni', env.appUrl());
        chiedi.searchParams.set('next', next);
        const r = NextResponse.redirect(chiedi);
        for (const c of res.cookies.getAll()) r.cookies.set(c);
        return r;
      }
    } catch (e) {
      logger.warn('[callback] accettazione dei testi non registrata', { e });
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

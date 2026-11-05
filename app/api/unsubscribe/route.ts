import { NextResponse } from 'next/server';
import { getAdminSupabase } from '@/lib/supabase/server';
import { verificaDisiscrizione } from '@/lib/email/unsubscribe';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { rateLimitAsync, getClientIp } from '@/lib/rate-limit';

export const runtime = 'nodejs';

/**
 * Disiscrizione con un clic, senza accedere. È il link nel footer delle email.
 * Il token è firmato: vale solo per quell'indirizzo e per quell'ambito.
 *
 * Due difetti riparati qui, trovati dalla radiografia del 18/8:
 *
 * ① L'indirizzo di ritorno veniva letto da NEXT_PUBLIC_SITE_URL, che in questo
 *    progetto non esiste: non è in .env.example, non è fra le variabili di
 *    produzione, non è in
 *    lib/env.ts. Valeva quindi stringa vuota, e `NextResponse.redirect('/?...')`
 *    con un indirizzo relativo in Next 15 lancia «URL is malformed». La pagina
 *    rispondeva errore. Il punto unico dichiarato è `env.appUrl()`.
 *
 * ② L'aggiornamento del profilo filtrava su `profiles.email`, colonna che non
 *    esiste (le email stanno in auth.users): PostgREST rifiutava con 42703 e
 *    nessuno guardava l'esito. Chi cliccava «Cancellami» non veniva tolto da
 *    niente e continuava a ricevere le email — fino a segnare il messaggio come
 *    spam, il che rovina la consegna anche delle conferme d'ordine.
 *    Ora il collegamento email→profilo lo fa la funzione `disiscrivi` nel
 *    database, dove auth.users e profiles vivono insieme, e l'esito si legge.
 */
/**
 * 5/11/2026 — APRIRE IL LINK NON DISISCRIVE PIÙ: SERVE LA CONFERMA.
 *
 * La GET disiscriveva subito: i sistemi che aprono in anticipo i link delle email (Outlook Safe
 * Links, antivirus aziendali, anteprime) toglievano il consenso a persone che non avevano fatto
 * niente. Adesso la GET porta alla pagina /disiscrizione, che chiede la conferma con un pulsante
 * (una POST); la POST — anche quella «con un clic» dei client di posta, RFC 8058 — disiscrive e
 * porta alla stessa pagina con l'esito, che prima nessuna pagina leggeva.
 */
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get('token') ?? '';
  const base = env.appUrl();
  if (!verificaDisiscrizione(token)) {
    return NextResponse.redirect(`${base}/disiscrizione?disiscrizione=link-non-valido`);
  }
  return NextResponse.redirect(`${base}/disiscrizione?token=${encodeURIComponent(token)}`);
}

/** La disiscrizione vera: il pulsante della pagina, o il «con un clic» dei client di posta. */
export async function POST(request: Request) {
  const token = new URL(request.url).searchParams.get('token') ?? '';
  const base = env.appUrl();
  // 303: dopo una POST il browser apre la pagina dell'esito con una GET.
  const vaiA = (esito: string) => NextResponse.redirect(`${base}/disiscrizione?disiscrizione=${esito}`, 303);

  // 27/8/2026 (R140) — GET PUBBLICO NUDO CHE CHIAMA UNA FUNZIONE DEL DATABASE
  // a ogni richiesta. La firma del gettone protegge il DATO, non la macchina:
  // un client solo poteva far girare `disiscrivi` a raffica. La soglia e'
  // larga: disiscriversi si fa una volta, e i client di posta che aprono il
  // link in anticipo ne fanno pochissime.
  const freno = await rateLimitAsync({
    key: `disiscrizione:${getClientIp(request)}`,
    max: 30,
    windowMs: 10 * 60_000,
  });
  if (!freno.allowed) {
    return vaiA('non-riuscita');
  }

  const dati = verificaDisiscrizione(token);

  if (!dati) {
    return vaiA('link-non-valido');
  }

  const admin = getAdminSupabase();
  const { data, error } = await admin.rpc('disiscrivi', {
    p_email: dati.email,
    p_ambito: dati.ambito,
  });

  // Un errore qui non è un dettaglio: vuol dire che la persona ha chiesto di
  // smettere e non è stata tolta da niente. Va detto a lei, non solo al log.
  if (error) {
    logger.error('[disiscrizione] non riuscita', { message: error.message, ambito: dati.ambito });
    return vaiA('non-riuscita');
  }

  const esito = data as { ok?: boolean; newsletter?: number; profilo?: number } | null;

  // Nessuna riga toccata: l'indirizzo non risulta né in lista né fra gli
  // account. Non è un errore del sito, ma neanche un «fatto»: chi ha cliccato
  // deve sapere che non c'era niente da spegnere.
  if (!esito?.ok) {
    return vaiA('non-trovato');
  }

  return vaiA('fatta');
}

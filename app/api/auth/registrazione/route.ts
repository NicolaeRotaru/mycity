import { NextResponse } from 'next/server';
import { authServer } from '@/lib/supabase/auth-server';
import { rateLimitAsync, getClientIp } from '@/lib/rate-limit';
import { verifyTurnstileToken } from '@/lib/captcha';
import { env } from '@/lib/env';
import { ApiErrors, apiError } from '@/lib/api/responses';
import { jsonRichiesta, TETTO_JSON } from '@/lib/api/corpo';
import { VERSIONE_TESTI_LEGALI } from '@/lib/legal/versione';
import { ritornoDopoLaConferma } from '@/lib/analytics/porta-di-ingresso';
import { esitoErroreDiAccesso } from '@/lib/auth/errore-di-accesso';

export const runtime = 'nodejs';

/**
 * 13/11/2026 (R24-020) — LA REGISTRAZIONE PASSA DAL SERVER.
 *
 * La pagina /sign-up chiamava `supabase.auth.signUp` dal browser con la chiave
 * pubblica: il freno sulle iscrizioni e la verifica del gettone anti-robot
 * stavano in `app/api/auth/signup`, che nessuno chiamava. Chiunque poteva
 * creare account a raffica e far partire email di conferma verso indirizzi di
 * altri.
 *
 * Questa rotta fa quello che faceva la pagina — ruolo, nome, versione dei testi
 * accettati, ritorno dopo la conferma — più il freno per rete e la verifica del
 * gettone. Il freno usa la stessa chiave della rotta vecchia, così le due porte
 * non sommano i loro tetti. La versione dei testi la scrive il server, non il
 * browser: è il verbale di cosa la persona aveva davanti.
 *
 * L'errore di Supabase torna al browser con il suo codice e il suo testo, come
 * lo vedeva prima la pagina: la traduzione resta una sola, `friendlyError`.
 * Se Supabase non risponde (rete caduta, 5xx) la risposta è 503, come
 * sull'accesso: non è colpa della persona né della sua rete.
 *
 * IL GETTONE ANTI-ROBOT LO VERIFICA UNO SOLO. Cloudflare dà un gettone valido una
 * volta sola: verificarlo qui con siteverify e poi passarlo a Supabase col CAPTCHA
 * acceso fa fallire la seconda verifica (timeout-or-duplicate) e ogni iscrizione
 * riceve 400 captcha_failed, bruciando anche un posto del freno. Chi verifica lo
 * dice `CAPTCHA_SU_SUPABASE` (variabile non segreta):
 *  - accesa («1» o «true»), col CAPTCHA acceso in Supabase → Attack Protection:
 *    niente siteverify qui, il gettone va a Supabase;
 *  - spenta (il resto dei casi), col CAPTCHA spento in Supabase: siteverify qui,
 *    e il gettone NON va a Supabase.
 */

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const RUOLI = new Set(['buyer', 'seller', 'rider']);
const NOME_MAX = 120;

/** Accesa = il gettone lo verifica Supabase (CAPTCHA acceso lì), non questa rotta. */
function captchaSuSupabase(): boolean {
  const v = (process.env.CAPTCHA_SU_SUPABASE ?? '').trim().toLowerCase();
  return v === '1' || v === 'true';
}

export async function POST(request: Request) {
  const ip = getClientIp(request);
  const rl = await rateLimitAsync({ key: `signup:${ip}`, max: 5, windowMs: 60 * 60_000 });
  if (!rl.allowed) {
    return ApiErrors.rateLimited(rl.retryAfterSec, 'Troppe registrazioni da questa rete. Riprova più tardi.');
  }

  let body: Record<string, unknown>;
  try {
    body = await jsonRichiesta(request, TETTO_JSON);
  } catch {
    return ApiErrors.invalidRequest('Richiesta non valida: ricarica la pagina e riprova.');
  }
  if (!body || typeof body !== 'object') {
    return ApiErrors.invalidRequest('Richiesta non valida: ricarica la pagina e riprova.');
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const captchaToken = typeof body.captchaToken === 'string' ? body.captchaToken : '';
  const ruolo = typeof body.role === 'string' && RUOLI.has(body.role) ? body.role : 'buyer';
  const nome = typeof body.fullName === 'string' ? body.fullName.trim() : '';
  const returnTo = typeof body.returnTo === 'string' ? body.returnTo : '';

  if (!EMAIL_RE.test(email) || email.length > 254) {
    return ApiErrors.invalidRequest('Questa email non sembra valida. Controlla come l’hai scritta.');
  }
  if (password.length < 8 || password.length > 200) {
    return ApiErrors.invalidRequest('La password deve avere almeno 8 caratteri.');
  }
  if (nome.length > NOME_MAX) {
    return ApiErrors.invalidRequest(`Il nome è troppo lungo: al massimo ${NOME_MAX} caratteri.`);
  }
  if (body.accettaTermini !== true) {
    return ApiErrors.invalidRequest('Spunta la casella per accettare Termini e Privacy');
  }

  const suSupabase = captchaSuSupabase();
  if (suSupabase) {
    // Lo verifica Supabase: senza gettone rifiuterebbe comunque, inutile chiamarlo.
    if (!captchaToken) return ApiErrors.invalidRequest('CAPTCHA mancante');
  } else {
    const cap = await verifyTurnstileToken(captchaToken, ip);
    if (!cap.ok) {
      return ApiErrors.invalidRequest(cap.reason);
    }
  }

  try {
    const { data, error } = await authServer.signUp(email, password, {
      // Già speso da siteverify se la verifica è stata fatta qui: a Supabase va solo se tocca a lui.
      captchaToken: suSupabase ? captchaToken : undefined,
      emailRedirectTo: ritornoDopoLaConferma(env.appUrl(), returnTo, 'email'),
      data: {
        role: ruolo,
        full_name: nome || undefined,
        versione_testi_accettati: VERSIONE_TESTI_LEGALI,
      },
    });
    if (error) {
      if (esitoErroreDiAccesso(error) === 'servizio_giu') {
        return ApiErrors.unavailable('Il servizio di registrazione non risponde in questo momento. Riprova fra poco.');
      }
      const stato = typeof error.status === 'number' && error.status >= 400 && error.status < 600 ? error.status : 400;
      const codice = typeof (error as { code?: unknown }).code === 'string' ? (error as { code: string }).code : 'SIGNUP_FAILED';
      return apiError(stato, error.message || 'Registrazione non riuscita. Riprova fra un momento.', codice);
    }
    // Con la conferma dell'email accesa la sessione non c'è: la pagina manda alla verifica.
    const sessione = data?.session
      ? { access_token: data.session.access_token, refresh_token: data.session.refresh_token }
      : null;
    return NextResponse.json({ ok: true, session: sessione }, { status: 201 });
  } catch {
    return ApiErrors.internal('Registrazione non riuscita. Riprova fra un momento.');
  }
}

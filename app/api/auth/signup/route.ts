import { NextResponse } from 'next/server';
import { authServer } from '@/lib/supabase/auth-server';
import { rateLimitAsync, getClientIp } from '@/lib/rate-limit';
import { verifyTurnstileToken } from '@/lib/captcha';
import { env } from '@/lib/env';
import { ApiErrors } from '@/lib/api/responses';
import { jsonRichiesta, TETTO_JSON } from '@/lib/api/corpo';
import {
  PASSWORD_RUBATA,
  PASSWORD_SEMPLICE,
  traduciErroreNuovaPassword,
  type ErroreDiSupabase,
} from '@/lib/auth/errori-nuova-password';

export const runtime = 'nodejs';

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

/**
 * 26/11/2026 (R28-013) — I DATI DELL'ISCRIZIONE VIAGGIANO ANCHE DA QUI.
 *
 * La pagina di registrazione passa a Supabase ruolo, nome e versione dei testi
 * accettati (`options.data`): il grilletto handle_new_user crea il profilo dal
 * ruolo, il primo accesso mette a verbale la versione. Questa rotta non li
 * passava: un account creato da qui nasceva senza ruolo scelto e senza versione
 * dei Termini. Il ruolo si accetta solo fra i tre della pagina (un «admin» nei
 * metadati non deve nemmeno arrivarci), il nome con lo stesso tetto del grilletto.
 */
const RUOLI_DELL_ISCRIZIONE = new Set(['buyer', 'seller', 'rider']);

function datiDellIscrizione(body: { role?: unknown; full_name?: unknown; versione_testi_accettati?: unknown }) {
  const role = typeof body.role === 'string' && RUOLI_DELL_ISCRIZIONE.has(body.role) ? body.role : 'buyer';
  const nome = typeof body.full_name === 'string' ? body.full_name.trim().slice(0, 200) : '';
  const versione = typeof body.versione_testi_accettati === 'string' ? body.versione_testi_accettati.trim() : '';
  return {
    role,
    ...(nome ? { full_name: nome } : {}),
    ...(versione && versione.length <= 100 ? { versione_testi_accettati: versione } : {}),
  };
}

/**
 * 26/11/2026 (R28-013) — IL GETTONE ANTI-ROBOT LO VERIFICA UNO SOLO.
 *
 * Come nella rotta di accesso (app/api/auth/signin/route.ts): un gettone
 * Turnstile vale una volta. Col CAPTCHA acceso su Supabase, verificarlo qui e
 * poi passarlo a Supabase farebbe cadere ogni iscrizione alla seconda verifica.
 * `CAPTCHA_SU_SUPABASE_ACCESO=1` (insieme al CAPTCHA acceso su Supabase, mai
 * prima): verifica Supabase. Spenta: verifica il server, come prima.
 */
/**
 * 26/11/2026 (R28-005) — LA PASSWORD DEBOLE O RUBATA SI DICE, IN ITALIANO.
 *
 * Supabase la rifiuta con `weak_password` (e i motivi: `pwned`, `length`,
 * `characters`), e qui diventava «Controlla i dati e riprova»: la persona non
 * sapeva che il problema era la password. Le frasi sono quelle di /reset-password.
 * Un testo che l'aiutante non riconosce lo farebbe ripiegare su una frase dei link
 * di reset («richiedi un nuovo link qui sotto»), che qui non c'è: col codice
 * `weak_password` il rifiuto è comunque della password, e vale «troppo semplice».
 */
function ePasswordRifiutata(errore: { code?: unknown; name?: unknown; reasons?: unknown }): boolean {
  return errore.code === 'weak_password' || errore.name === 'AuthWeakPasswordError' || Array.isArray(errore.reasons);
}

function fraseDellaPasswordRifiutata(errore: ErroreDiSupabase): string {
  const frase = traduciErroreNuovaPassword(errore);
  return frase === PASSWORD_RUBATA || frase === PASSWORD_SEMPLICE || frase.startsWith('La password è troppo corta')
    ? frase
    : PASSWORD_SEMPLICE;
}

function captchaVerificatoDaSupabase(): boolean {
  return /^(1|true)$/i.test((process.env.CAPTCHA_SU_SUPABASE_ACCESO ?? '').trim());
}

export async function POST(request: Request) {
  // Rate limit: 5 / ora per IP (anti spam account)
  const ip = getClientIp(request);
  const rl = await rateLimitAsync({ key: `signup:${ip}`, max: 5, windowMs: 60 * 60_000 });
  if (!rl.allowed) {
    return ApiErrors.rateLimited(rl.retryAfterSec, 'Troppe registrazioni da questo indirizzo. Riprova più tardi.');
  }

  let body: {
    email?: unknown;
    password?: unknown;
    captchaToken?: unknown;
    role?: unknown;
    full_name?: unknown;
    versione_testi_accettati?: unknown;
  };
  try {
    body = await jsonRichiesta(request, TETTO_JSON);
  } catch {
    return ApiErrors.invalidRequest('Body JSON non valido');
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const captchaToken = typeof body.captchaToken === 'string' ? body.captchaToken : '';

  if (!EMAIL_RE.test(email) || email.length > 254) {
    return ApiErrors.invalidRequest('Email non valida');
  }
  if (password.length < 8 || password.length > 200) {
    return ApiErrors.invalidRequest('La password deve avere almeno 8 caratteri');
  }

  // CAPTCHA: se la chiave non è configurata la verifica è skipped (dev).
  if (!captchaVerificatoDaSupabase()) {
    const cap = await verifyTurnstileToken(captchaToken, ip);
    if (!cap.ok) {
      return ApiErrors.invalidRequest(cap.reason);
    }
  }

  try {
    const emailRedirectTo = `${env.appUrl()}/auth/callback`;
    const { data, error } = await authServer.signUp(email, password, {
      captchaToken,
      emailRedirectTo,
      data: datiDellIscrizione(body),
    });
    if (error) {
      // Il gettone rifiutato da Supabase si dice come nella rotta di accesso.
      if (error.code === 'captcha_failed') return ApiErrors.invalidRequest('CAPTCHA non valido');
      if (ePasswordRifiutata(error)) return ApiErrors.invalidRequest(fraseDellaPasswordRifiutata(error));
      return ApiErrors.invalidRequest('Registrazione non riuscita. Controlla i dati e riprova.');
    }
    return NextResponse.json(data, { status: 201 });
  } catch {
    return ApiErrors.internal('Errore durante la registrazione');
  }
}

import { NextResponse } from 'next/server';
import { authServer } from '@/lib/supabase/auth-server';
import { rateLimitAsync, getClientIp } from '@/lib/rate-limit';
import { verifyTurnstileToken } from '@/lib/captcha';
import { env } from '@/lib/env';
import { ApiErrors } from '@/lib/api/responses';
import { jsonRichiesta, TETTO_JSON } from '@/lib/api/corpo';
import { ritornoDopoLaConferma } from '@/lib/analytics/porta-di-ingresso';
import { VERSIONE_TESTI_LEGALI } from '@/lib/legal/versione';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

/**
 * Una regola sola per il controllo anti-robot.
 *
 * Il controllo e' acceso quando ci sono tutte e due le chiavi: la segreta per
 * il server e la pubblica che fa disegnare il riquadro alla pagina. Allora vale
 * qui, sul server, per la registrazione come per l'accesso. Senza la coppia la
 * porta resta aperta alle persone e restano i limiti di frequenza.
 */
function antiRobotAcceso(): boolean {
  const segreta = Boolean(process.env.TURNSTILE_SECRET_KEY?.trim());
  const pubblica = Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY);
  if (segreta !== pubblica) {
    logger.error(new Error("Chiavi anti-robot a meta': serve la coppia, segreta e pubblica"), { context: 'captcha' });
  }
  return segreta && pubblica;
}

/**
 * Limiti di frequenza. Con il controllo anti-robot acceso il tetto per
 * indirizzo di rete e' largo: una famiglia, un forno o un ufficio escono tutti
 * dalla stessa rete e si devono poter iscrivere tutti nella stessa ora, e i
 * programmi automatici li ferma il controllo. Senza il controllo resta il
 * limite di frequenza di prima, che e' l'unica difesa. Il tetto stretto sta
 * sempre anche sull'email.
 */
const ISCRIZIONI_PER_RETE_ORA_CON_CONTROLLO = 30;
const ISCRIZIONI_PER_RETE_ORA_SENZA_CONTROLLO = 5;
const ISCRIZIONI_PER_EMAIL_ORA = 5;
const UN_ORA_MS = 60 * 60_000;

const RUOLI = ['buyer', 'seller', 'rider'] as const;
type Ruolo = (typeof RUOLI)[number];
const NOME_MAX = 120;

export async function POST(request: Request) {
  const ip = getClientIp(request);
  const controlloAcceso = antiRobotAcceso();
  const rl = await rateLimitAsync({
    key: `signup:${ip}`,
    max: controlloAcceso ? ISCRIZIONI_PER_RETE_ORA_CON_CONTROLLO : ISCRIZIONI_PER_RETE_ORA_SENZA_CONTROLLO,
    windowMs: UN_ORA_MS,
  });
  if (!rl.allowed) {
    return ApiErrors.rateLimited(rl.retryAfterSec, 'Troppe registrazioni da questo indirizzo. Riprova più tardi.');
  }

  let body: {
    email?: unknown;
    password?: unknown;
    captchaToken?: unknown;
    role?: unknown;
    fullName?: unknown;
    returnTo?: unknown;
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

  const rlEmail = await rateLimitAsync({
    key: `signup-email:${email}`,
    max: ISCRIZIONI_PER_EMAIL_ORA,
    windowMs: UN_ORA_MS,
  });
  if (!rlEmail.allowed) {
    return ApiErrors.rateLimited(rlEmail.retryAfterSec, 'Troppe registrazioni per questa email. Riprova più tardi.');
  }

  if (controlloAcceso) {
    const cap = await verifyTurnstileToken(captchaToken, ip);
    if (!cap.ok) {
      return ApiErrors.invalidRequest(cap.reason);
    }
  }

  const role: Ruolo = RUOLI.includes(body.role as Ruolo) ? (body.role as Ruolo) : 'buyer';
  const fullName = typeof body.fullName === 'string' ? body.fullName.trim().slice(0, NOME_MAX) : '';

  try {
    // Il ritorno dal link porta il segnale «si stava registrando» e la pagina da
    // cui era partito (R160). Chi non manda returnTo torna alla richiamata semplice.
    const emailRedirectTo =
      typeof body.returnTo === 'string'
        ? ritornoDopoLaConferma(env.appUrl(), body.returnTo, 'email')
        : `${env.appUrl()}/auth/callback`;
    const { data, error } = await authServer.signUp(email, password, {
      captchaToken,
      emailRedirectTo,
      data: {
        role,
        full_name: fullName || undefined,
        versione_testi_accettati: VERSIONE_TESTI_LEGALI,
      },
    });
    if (error) {
      return ApiErrors.invalidRequest('Registrazione non riuscita. Controlla i dati e riprova.');
    }
    return NextResponse.json(data, { status: 201 });
  } catch {
    return ApiErrors.internal('Errore durante la registrazione');
  }
}

import { NextResponse } from 'next/server';
import { auth } from '@/lib/supabase/client';
import { rateLimit, getClientIp } from '@/lib/rate-limit';
import { verifyTurnstileToken } from '@/lib/captcha';
import { env } from '@/lib/env';
import { ApiErrors } from '@/lib/api/responses';

export const runtime = 'nodejs';

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

export async function POST(request: Request) {
  // Rate limit: 5 / ora per IP (anti spam account)
  const ip = getClientIp(request);
  const rl = rateLimit({ key: `signup:${ip}`, max: 5, windowMs: 60 * 60_000 });
  if (!rl.allowed) {
    return ApiErrors.rateLimited(rl.retryAfterSec, 'Troppe registrazioni da questo indirizzo. Riprova più tardi.');
  }

  let body: { email?: unknown; password?: unknown; captchaToken?: unknown };
  try {
    body = await request.json();
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
  const cap = await verifyTurnstileToken(captchaToken, ip);
  if (!cap.ok) {
    return ApiErrors.invalidRequest(cap.reason);
  }

  try {
    const emailRedirectTo = `${env.appUrl()}/auth/callback`;
    const { data, error } = await auth.signUp(email, password, {
      captchaToken,
      emailRedirectTo,
    });
    if (error) {
      return ApiErrors.invalidRequest('Registrazione non riuscita. Controlla i dati e riprova.');
    }
    return NextResponse.json(data, { status: 201 });
  } catch {
    return ApiErrors.internal('Errore durante la registrazione');
  }
}

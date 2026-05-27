import { NextResponse } from 'next/server';
import { auth } from '@/lib/supabase/client';
import { rateLimit, getClientIp } from '@/lib/rate-limit';
import { verifyTurnstileToken } from '@/lib/captcha';
import { ApiErrors } from '@/lib/api/responses';

export const runtime = 'nodejs';

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

export async function POST(request: Request) {
  // Rate limit per IP: 10 tentativi / 5 min (anti brute-force)
  const ip = getClientIp(request);
  const rl = rateLimit({ key: `signin:${ip}`, max: 10, windowMs: 5 * 60_000 });
  if (!rl.allowed) {
    return ApiErrors.rateLimited(rl.retryAfterSec, 'Troppi tentativi di accesso. Riprova tra qualche minuto.');
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
  if (password.length < 6 || password.length > 200) {
    return ApiErrors.invalidRequest('Password non valida');
  }

  const cap = await verifyTurnstileToken(captchaToken, ip);
  if (!cap.ok) {
    return ApiErrors.invalidRequest(cap.reason);
  }

  try {
    const { data, error } = await auth.signIn(email, password, { captchaToken });
    if (error) {
      return ApiErrors.unauthorized('Email o password non corretti');
    }

    // Gate verifica email: blocca login se non confermata
    if (data?.user && !data.user.email_confirmed_at) {
      // Logout pulito per non lasciare cookie semi-validi
      try { await auth.signOut(); } catch { /* noop */ }
      return NextResponse.json(
        { ok: false, error: { code: 'EMAIL_NOT_VERIFIED', message: 'Devi confermare la tua email prima di accedere. Controlla la posta.' } },
        { status: 403 },
      );
    }

    return NextResponse.json(data, { status: 200 });
  } catch {
    return ApiErrors.internal('Errore durante il login');
  }
}

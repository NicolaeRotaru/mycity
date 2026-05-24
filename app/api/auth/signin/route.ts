import { NextResponse } from 'next/server';
import { auth } from '@/lib/supabase/client';
import { rateLimit, getClientIp } from '@/lib/rate-limit';
import { verifyTurnstileToken } from '@/lib/captcha';

export const runtime = 'nodejs';

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

export async function POST(request: Request) {
  // Rate limit per IP: 10 tentativi / 5 min (anti brute-force)
  const ip = getClientIp(request);
  const rl = rateLimit({ key: `signin:${ip}`, max: 10, windowMs: 5 * 60_000 });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Troppi tentativi di accesso. Riprova tra qualche minuto.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } },
    );
  }

  let body: { email?: unknown; password?: unknown; captchaToken?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body JSON non valido' }, { status: 400 });
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const captchaToken = typeof body.captchaToken === 'string' ? body.captchaToken : '';

  if (!EMAIL_RE.test(email) || email.length > 254) {
    return NextResponse.json({ error: 'Email non valida' }, { status: 400 });
  }
  if (password.length < 6 || password.length > 200) {
    return NextResponse.json({ error: 'Password non valida' }, { status: 400 });
  }

  const cap = await verifyTurnstileToken(captchaToken, ip);
  if (!cap.ok) {
    return NextResponse.json({ error: cap.reason }, { status: 400 });
  }

  try {
    const { data, error } = await auth.signIn(email, password, { captchaToken });
    if (error) {
      return NextResponse.json({ error: 'Email o password non corretti' }, { status: 401 });
    }

    // Gate verifica email: blocca login se non confermata
    if (data?.user && !data.user.email_confirmed_at) {
      // Logout pulito per non lasciare cookie semi-validi
      try { await auth.signOut(); } catch { /* noop */ }
      return NextResponse.json(
        { error: 'Devi confermare la tua email prima di accedere. Controlla la posta.', code: 'EMAIL_NOT_VERIFIED' },
        { status: 403 },
      );
    }

    return NextResponse.json(data, { status: 200 });
  } catch {
    return NextResponse.json({ error: 'Errore durante il login' }, { status: 500 });
  }
}

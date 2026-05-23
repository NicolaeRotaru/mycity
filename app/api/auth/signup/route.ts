import { NextResponse } from 'next/server';
import { auth } from '@/lib/supabase/client';
import { rateLimit, getClientIp } from '@/lib/rate-limit';

export const runtime = 'nodejs';

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

export async function POST(request: Request) {
  // Rate limit più stretto per signup: 5 / ora per IP (anti spam account)
  const ip = getClientIp(request);
  const rl = rateLimit({ key: `signup:${ip}`, max: 5, windowMs: 60 * 60_000 });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Troppe registrazioni da questo indirizzo. Riprova più tardi.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } },
    );
  }

  let body: { email?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body JSON non valido' }, { status: 400 });
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';

  if (!EMAIL_RE.test(email) || email.length > 254) {
    return NextResponse.json({ error: 'Email non valida' }, { status: 400 });
  }
  if (password.length < 8 || password.length > 200) {
    return NextResponse.json(
      { error: 'La password deve avere almeno 8 caratteri' },
      { status: 400 },
    );
  }

  try {
    const { data, error } = await auth.signUp(email, password);
    if (error) {
      return NextResponse.json(
        { error: 'Registrazione non riuscita. Controlla i dati e riprova.' },
        { status: 400 },
      );
    }
    return NextResponse.json(data, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Errore durante la registrazione' }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { rateLimit, getClientIp } from '@/lib/rate-limit';
import { getAdminSupabase, getCurrentUser } from '@/lib/supabase/server';
import { sendEmail } from '@/lib/email/client';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';

const Schema = z.object({
  name: z.string().trim().min(2, 'Nome troppo corto').max(120),
  email: z.string().trim().email('Email non valida'),
  subject: z.string().trim().min(1).max(200).default('Domanda generale'),
  message: z.string().trim().min(10, 'Messaggio troppo corto').max(5000),
  // Honeypot — se valorizzato è un bot
  company: z.string().optional(),
});

export async function POST(req: Request) {
  const ip = getClientIp(req);
  const rl = rateLimit({ key: `contact:${ip}`, max: 3, windowMs: 10 * 60_000 });
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Troppe richieste, riprova tra 10 min' }, { status: 429 });
  }

  let json: unknown;
  try { json = await req.json(); } catch { return NextResponse.json({ error: 'Body non valido' }, { status: 400 }); }
  const parsed = Schema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message ?? 'Input non valido' }, { status: 400 });
  }
  const { company, ...payload } = parsed.data;
  if (company) {
    // Honeypot pieno → simula successo per non insospettire il bot
    return NextResponse.json({ ok: true });
  }

  const user = await getCurrentUser();
  const supa = getAdminSupabase();

  const { error } = await supa.from('contact_messages').insert({
    ...payload,
    user_id: user?.id ?? null,
    ip,
  });
  if (error) {
    logger.error('[contact] insert failed:', error);
    return NextResponse.json({ error: 'Errore interno' }, { status: 500 });
  }

  // Best-effort email al support (skip se RESEND_API_KEY non configurato)
  sendEmail({
    to: process.env.SUPPORT_EMAIL ?? 'support@mycity.it',
    subject: `[Contact] ${payload.subject} — ${payload.name}`,
    html: `<p><strong>Da:</strong> ${payload.name} &lt;${payload.email}&gt;</p>
           <p><strong>Soggetto:</strong> ${payload.subject}</p>
           <hr>
           <p>${payload.message.replace(/\n/g, '<br>')}</p>`,
    replyTo: payload.email,
  }).catch(() => { /* noop */ });

  return NextResponse.json({ ok: true });
}

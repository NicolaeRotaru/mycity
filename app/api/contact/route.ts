import { NextResponse } from 'next/server';
import { z } from 'zod';
import { rateLimit, getClientIp } from '@/lib/rate-limit';
import { getAdminSupabase, getCurrentUser } from '@/lib/supabase/server';
import { sendEmail } from '@/lib/email/client';
import { logger } from '@/lib/logger';
import { ApiErrors } from '@/lib/api/responses';
import { zodFirstFieldMessage } from '@/lib/zod-field-errors';

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
  if (!rl.allowed) return ApiErrors.rateLimited(rl.retryAfterSec);

  let json: unknown;
  try { json = await req.json(); } catch { return ApiErrors.invalidRequest('Body non valido'); }
  const parsed = Schema.safeParse(json);
  if (!parsed.success) {
    return ApiErrors.invalidRequest(
      zodFirstFieldMessage(parsed.error, { name: 'Nome', email: 'Email', subject: 'Oggetto', message: 'Messaggio' }),
    );
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
    return ApiErrors.internal('Errore interno');
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

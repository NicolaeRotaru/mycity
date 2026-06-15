import { NextResponse } from 'next/server';
import { z } from 'zod';
import { rateLimitAsync, getClientIp } from '@/lib/rate-limit';
import { getAdminSupabase, getCurrentUser } from '@/lib/supabase/server';
import { sendEmail } from '@/lib/email/client';
import { logger } from '@/lib/logger';
import { ApiErrors } from '@/lib/api/responses';

export const runtime = 'nodejs';

/** Escape dei caratteri HTML per impedire XSS stored nell'email admin. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

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
  const rl = await rateLimitAsync({ key: `contact:${ip}`, max: 3, windowMs: 10 * 60_000 });
  if (!rl.allowed) return ApiErrors.rateLimited(rl.retryAfterSec);

  let json: unknown;
  try { json = await req.json(); } catch { return ApiErrors.invalidRequest('Body non valido'); }
  const parsed = Schema.safeParse(json);
  if (!parsed.success) {
    return ApiErrors.invalidRequest(parsed.error.errors[0]?.message ?? 'Input non valido');
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
    html: `<p><strong>Da:</strong> ${escapeHtml(payload.name)} &lt;${escapeHtml(payload.email)}&gt;</p>
           <p><strong>Soggetto:</strong> ${escapeHtml(payload.subject)}</p>
           <hr>
           <p>${escapeHtml(payload.message).replace(/\n/g, '<br>')}</p>`,
    replyTo: payload.email,
  }).catch(() => { /* noop */ });

  return NextResponse.json({ ok: true });
}

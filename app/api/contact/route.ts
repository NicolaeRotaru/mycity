import { NextResponse } from 'next/server';
import { z } from 'zod';
import { rateLimitAsync, getClientIp } from '@/lib/rate-limit';
import { getAdminSupabase, getCurrentUser } from '@/lib/supabase/server';
import { sendEmail } from '@/lib/email/client';
import { verifyTurnstileToken } from '@/lib/captcha';
import { logger } from '@/lib/logger';
import { ApiErrors } from '@/lib/api/responses';
import { jsonRichiesta, TETTO_JSON } from '@/lib/api/corpo';
// 27/8/2026 (R011) — Qui dentro c'era una copia identica del filtro dell'HTML,
// e `lib/html-escape.ts` diceva nel proprio commento di essere quella
// condivisa. Non lo era: la importava un file solo. Tre copie della stessa
// regola sono tre regole, e il giorno in cui va aggiunto un carattere da
// filtrare due restano indietro senza dirlo a nessuno.
import { escapeHtml } from '@/lib/html-escape';

export const runtime = 'nodejs';

const Schema = z.object({
  name: z.string().trim().min(2, 'Nome troppo corto').max(120),
  email: z.string().trim().email('Email non valida'),
  subject: z.string().trim().min(1).max(200).default('Domanda generale'),
  message: z.string().trim().min(10, 'Messaggio troppo corto').max(5000),
  // Honeypot — se valorizzato è un bot
  company: z.string().optional(),
  // 🟡-2: token CAPTCHA (come signup/signin). Opzionale: verificato sotto.
  captchaToken: z.string().optional(),
});

export async function POST(req: Request) {
  const ip = getClientIp(req);
  const rl = await rateLimitAsync({ key: `contact:${ip}`, max: 3, windowMs: 10 * 60_000 });
  if (!rl.allowed) return ApiErrors.rateLimited(rl.retryAfterSec);

  let json: unknown;
  try { json = await jsonRichiesta(req, TETTO_JSON); } catch { return ApiErrors.invalidRequest('Body non valido'); }
  const parsed = Schema.safeParse(json);
  if (!parsed.success) {
    return ApiErrors.invalidRequest(parsed.error.errors[0]?.message ?? 'Input non valido');
  }
  const { company, captchaToken, ...payload } = parsed.data;
  if (company) {
    // Honeypot pieno → simula successo per non insospettire il bot
    return NextResponse.json({ ok: true });
  }

  // 🟡-2: verifica CAPTCHA (come signup/signin). Se TURNSTILE_SECRET_KEY non è
  // configurata, verifyTurnstileToken ritorna { ok:true, skipped:true }.
  const cap = await verifyTurnstileToken(captchaToken, ip);
  if (!cap.ok) return ApiErrors.invalidRequest('Verifica anti-bot fallita. Riprova.');

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

  // Avviso al supporto, se sappiamo dove mandarlo. Nessun indirizzo di ripiego
  // inventato (vedi operational-alerts): il messaggio resta comunque in
  // contact_messages, quindi non si perde — si perde solo l'avviso immediato.
  const supporto = process.env.SUPPORT_EMAIL?.trim();
  if (!supporto) {
    logger.warn('[contact] SUPPORT_EMAIL non configurata: nessun avviso inviato');
  }
  if (supporto) sendEmail({
    to: supporto,
    // 27/8/2026 (R067) — Questo e' un avviso interno alla nostra assistenza,
    // non una comunicazione commerciale: non deve portare il piede «annulla
    // l'iscrizione». Quel link spegne le promozioni dell'indirizzo che lo
    // preme, e qui l'indirizzo e' la nostra casella del supporto.
    tipo: 'transazionale',
    subject: `[Contact] ${payload.subject} — ${payload.name}`,
    html: `<p><strong>Da:</strong> ${escapeHtml(payload.name)} &lt;${escapeHtml(payload.email)}&gt;</p>
           <p><strong>Soggetto:</strong> ${escapeHtml(payload.subject)}</p>
           <hr>
           <p>${escapeHtml(payload.message).replace(/\n/g, '<br>')}</p>`,
    replyTo: payload.email,
  }).catch(() => { /* noop */ });

  return NextResponse.json({ ok: true });
}

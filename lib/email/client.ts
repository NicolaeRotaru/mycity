import { Resend } from 'resend';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';

let _resend: Resend | null = null;

function getResend(): Resend | null {
  if (_resend) return _resend;
  const key = env.resendKey();
  if (!key) return null;
  _resend = new Resend(key);
  return _resend;
}

export type SendEmailInput = {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  tags?: { name: string; value: string }[];
};

export type SendEmailResult =
  | { ok: true; id: string }
  | { ok: false; skipped: true; reason: string }
  | { ok: false; error: string };

/**
 * Wrapper Resend tollerante: se RESEND_API_KEY non e' configurata, NON
 * lancia errore ma logga in console e ritorna `skipped`. Cosi' l'app
 * resta funzionante in dev anche senza chiavi reali.
 *
 * In produzione la chiave DEVE essere impostata: monitorare i log e
 * settare alert su `[email] skipped` per accorgersene.
 */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const resend = getResend();
  if (!resend) {
    // 🟡-12: niente PII (indirizzo destinatario) nei log; via logger, non console.
    logger.warn('[email] skipped: RESEND_API_KEY non configurata', { subject: input.subject });
    return { ok: false, skipped: true, reason: 'RESEND_API_KEY non configurata' };
  }

  // 🟠-9: un retry su errore transitorio (rete/5xx/429) riduce la perdita di
  // email critiche su blip momentanei di Resend. Gli errori non vengono più
  // silenziati (vanno a Sentry via logger) e operational-alerts vigila il
  // backlog della coda lifecycle. (Outbox durevole per le email transazionali =
  // enhancement futuro: la coda attuale è template-based per user_id.)
  const payload = {
    from: env.resendFrom(),
    to: input.to,
    subject: input.subject,
    html: input.html,
    text: input.text,
    reply_to: input.replyTo ?? env.resendReplyTo(),
    tags: input.tags,
  };
  let lastErr = 'unknown';
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { data, error } = await resend.emails.send(payload);
      if (!error) return { ok: true, id: data?.id ?? '' };
      lastErr = error.message ?? 'resend error';
    } catch (err) {
      lastErr = err instanceof Error ? err.message : 'unknown';
    }
    if (attempt === 0) await new Promise((r) => setTimeout(r, 300)); // breve backoff
  }
  logger.error('[email] invio fallito dopo retry', { message: lastErr });
  return { ok: false, error: lastErr };
}

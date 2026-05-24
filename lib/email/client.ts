import { Resend } from 'resend';
import { env } from '@/lib/env';

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
    console.warn('[email] skipped (RESEND_API_KEY non configurata):', {
      to: input.to,
      subject: input.subject,
    });
    return { ok: false, skipped: true, reason: 'RESEND_API_KEY non configurata' };
  }

  try {
    const { data, error } = await resend.emails.send({
      from: env.resendFrom(),
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
      reply_to: input.replyTo ?? env.resendReplyTo(),
      tags: input.tags,
    });
    if (error) {
      console.error('[email] resend error:', error);
      return { ok: false, error: error.message ?? 'resend error' };
    }
    return { ok: true, id: data?.id ?? '' };
  } catch (err: any) {
    console.error('[email] exception:', err);
    return { ok: false, error: err?.message ?? 'unknown' };
  }
}

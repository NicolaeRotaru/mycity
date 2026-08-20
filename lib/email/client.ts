import { Resend } from 'resend';
import { env } from '@/lib/env';
import { linkDisiscrizione } from '@/lib/email/unsubscribe';
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
  // Link di disiscrizione su OGNI email, aggiunto qui e non nei singoli
  // template: il footer di templates.ts non conosce il destinatario, e i
  // messaggi costruiti altrove (carrelli abbandonati, ciclo di vita) non
  // passavano dal footer comune. Prima l'unico link era «Gestisci preferenze»,
  // che porta a una pagina con il login: inutile per chi vuole solo smettere.
  const destinatario = Array.isArray(input.to) ? input.to[0] : input.to;
  const linkStop = destinatario ? linkDisiscrizione(destinatario, 'marketing') : null;

  const payload = {
    from: env.resendFrom(),
    to: input.to,
    subject: input.subject,
    html: linkStop ? conPiedeDisiscrizione(input.html, linkStop) : input.html,
    text: input.text,
    reply_to: input.replyTo ?? env.resendReplyTo(),
    tags: input.tags,
    // Il pulsante «Annulla iscrizione» dei client di posta usa queste due.
    headers: linkStop
      ? {
          'List-Unsubscribe': `<${linkStop}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        }
      : undefined,
  };
  let lastErr = 'unknown';
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      // #176 — Un tetto di dieci secondi per tentativo. Senza, una chiamata
      // appesa teneva ferma la risposta di chi la stava aspettando — nel caso
      // peggiore il webhook di Stripe, che se non riceve risposta ritenta e poi
      // disattiva l'endpoint.
      const { data, error } = await Promise.race([
        resend.emails.send(payload),
        new Promise<never>((_, rifiuta) =>
          setTimeout(() => rifiuta(new Error('invio email oltre i 10 secondi')), 10_000)),
      ]);
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

/**
 * Aggiunge la riga di disiscrizione in fondo al corpo HTML, una volta sola.
 * Se il messaggio ha un </body> la mette prima, altrimenti in coda.
 */
function conPiedeDisiscrizione(html: string, link: string): string {
  if (html.includes(link)) return html;
  const riga =
    `<div style="margin-top:24px;padding-top:16px;border-top:1px solid #e2e8f0;` +
    `font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:12px;color:#64748b">` +
    `Non vuoi più ricevere queste email? ` +
    `<a href="${link}" style="color:#64748b">Annulla l'iscrizione con un clic</a>.` +
    `</div>`;
  return html.includes('</body>')
    ? html.replace('</body>', `${riga}</body>`)
    : `${html}${riga}`;
}

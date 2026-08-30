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

/**
 * 27/8/2026 (R067) — A cosa serve il messaggio, in una parola.
 *
 * `transazionale` = qualcosa che la persona ha chiesto e sta aspettando:
 * conferma d'ordine, rimborso, gift card comprata, avviso al negozio, avviso
 * interno all'assistenza. Non porta il piede «annulla l'iscrizione».
 * `marketing` = comunicazione commerciale: porta sempre il modo di smettere.
 */
export type TipoEmail = 'transazionale' | 'marketing';

export type SendEmailInput = {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  tags?: { name: string; value: string }[];
  /**
   * Ripiego prudente: `marketing`. Chi chiama e non dichiara niente continua ad
   * avere il piede di disiscrizione, come e' sempre stato. Togliere il link a
   * una email commerciale per una dimenticanza e' molto peggio che lasciarne
   * uno di troppo in fondo a una ricevuta.
   */
  tipo?: TipoEmail;
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
  // Link di disiscrizione sulle email commerciali, aggiunto qui e non nei
  // singoli template: il footer di templates.ts non conosce il destinatario, e i
  // messaggi costruiti altrove (carrelli abbandonati, ciclo di vita) non
  // passavano dal footer comune. Prima l'unico link era «Gestisci preferenze»,
  // che porta a una pagina con il login: inutile per chi vuole solo smettere.
  //
  // 27/8/2026 (R067) — ma NON su tutte. Il link disiscrive dall'ambito
  // «marketing», e la funzione del database spegne promozioni e notifiche
  // commerciali (migrazione 118). In fondo alla conferma di un ordine e' una
  // trappola: chi lo preme crede di spegnere gli avvisi dell'ordine, e invece
  // spegne le promozioni — poi gli avvisi arrivano lo stesso e ci segnala come
  // spam. Sulle transazionali resta il «Gestisci preferenze» del piede comune.
  const tipo: TipoEmail = input.tipo ?? 'marketing';
  const destinatario = Array.isArray(input.to) ? input.to[0] : input.to;

  // 27/8/2026 (R054) — Questa riga stava FUORI dal try, e la firma del link
  // lancia in produzione quando UNSUBSCRIBE_SECRET non e' configurata: una
  // variabile dimenticata su Vercel e non usciva piu' NIENTE, nemmeno le
  // conferme d'ordine, mentre il sito continuava a incassare. Adesso il caso
  // limite degrada invece di essere fatale, e in modo diverso nei due casi:
  // l'ordine che una persona ha pagato le arriva comunque; una email
  // commerciale senza il modo di smettere di riceverla non parte.
  let linkStop: string | null = null;
  if (destinatario) {
    try {
      linkStop = linkDisiscrizione(destinatario, 'marketing');
    } catch (err) {
      logger.error('[email] link di disiscrizione non firmabile: controllare UNSUBSCRIBE_SECRET', {
        subject: input.subject,
        tipo,
        message: err instanceof Error ? err.message : 'unknown',
      });
      if (tipo === 'marketing') {
        return { ok: false, skipped: true, reason: 'link di disiscrizione non firmabile: email di marketing non inviata' };
      }
    }
  }

  const piede = tipo === 'marketing' ? linkStop : null;

  const payload = {
    from: env.resendFrom(),
    to: input.to,
    subject: input.subject,
    html: piede ? conPiedeDisiscrizione(input.html, piede) : input.html,
    text: input.text,
    reply_to: input.replyTo ?? env.resendReplyTo(),
    tags: input.tags,
    // Il pulsante «Annulla iscrizione» dei client di posta usa queste due.
    headers: piede
      ? {
          'List-Unsubscribe': `<${piede}>`,
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

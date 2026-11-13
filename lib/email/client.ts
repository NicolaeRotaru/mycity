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
 * `marketing` = comunicazione commerciale: porta sempre il modo di smettere, e
 * va DICHIARATA da chi la spedisce (vedi il ripiego qui sotto).
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
   * Ripiego: `transazionale`. Una email commerciale si dichiara con
   * `tipo: 'marketing'`; chi non dichiara niente spedisce un messaggio di
   * servizio, senza il piede «annulla l'iscrizione» e senza le intestazioni
   * che accendono il pulsante di Gmail.
   *
   * 15/10/2026 (R24) — Fino a ieri il ripiego era `marketing`, «per prudenza».
   * In pratica nessuna delle email d'ordine lo dichiarava: conferma al cliente
   * (carta e contanti), «nuovo ordine» al negozio, i due rimborsi, il buono
   * regalo a chi lo riceve e a chi lo compra. Uscivano tutte col tasto per
   * disiscriversi, e chi lo premeva sulla ricevuta spegneva le promozioni
   * (`email_marketing` e `notif_promos`, migrazione 118) credendo di spegnere
   * gli avvisi dell'ordine — poi gli avvisi arrivavano lo stesso, e ci segnava
   * come spam. Le email commerciali invece si contano sulle dita, e sono tutte
   * scritte apposta: chi ne scrive una sa di scriverla.
   */
  tipo?: TipoEmail;
  /**
   * 13/11/2026 (R22-001, R22-011) — LO STESSO MESSAGGIO PORTA SEMPRE LA STESSA CHIAVE.
   *
   * Dopo il tetto dei dieci secondi l'esito è ignoto: Resend può averla già spedita. Qui dentro
   * non si ritenta, ma la coda (app/api/cron/send-emails) riprendeva la riga cinque minuti dopo
   * e la mandava di nuovo. Con la chiave Resend riconosce il secondo invio dello stesso messaggio
   * (entro 24 ore) e non lo rispedisce. Chi la passa deve darla stabile: una per riga di coda.
   */
  idempotencyKey?: string;
};

export type SendEmailResult =
  | { ok: true; id: string }
  | { ok: false; skipped: true; reason: string }
  | { ok: false; error: string };

/**
 * Wrapper Resend tollerante: se RESEND_API_KEY non e' configurata, NON
 * lancia errore ma logga tramite logger e ritorna `skipped`. Cosi' l'app
 * resta funzionante in dev anche senza chiavi reali.
 *
 * In produzione servono DUE cose, non una: la chiave (RESEND_API_KEY) e il
 * mittente (RESEND_FROM). Se manca una delle due si esce subito con
 * `skipped` e una riga di errore nei log, senza chiamare Resend. Monitorare
 * `[email] skipped` per accorgersene; il semaforo /api/health guarda tutte e
 * due le variabili e passa a «degradato» se ne manca una.
 */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const resend = getResend();
  if (!resend) {
    // 🟡-12: niente PII (indirizzo destinatario) nei log; via logger, non console.
    logger.warn('[email] skipped: RESEND_API_KEY non configurata', { subject: input.subject });
    return { ok: false, skipped: true, reason: 'RESEND_API_KEY non configurata' };
  }

  // 6/9/2026 — SENZA MITTENTE NON SI SPEDISCE, E LO SI SA SUBITO.
  //
  // In produzione `env.resendFrom()` non ripiega piu' su un indirizzo che
  // nessuno ha configurato: se RESEND_FROM manca, torna vuoto. Prima quel
  // ripiego finiva dritto in `from:` e Resend rifiutava una busta alla volta —
  // conferma d'ordine al cliente, avviso di nuovo ordine al negozio, rimborso —
  // mentre il sito continuava a incassare. Un guasto di configurazione si deve
  // scoprire una volta sola: qui non si chiama nemmeno Resend, si scrive
  // l'errore, e /api/health dice quale variabile manca.
  //
  // Perche' `skipped` e non un'eccezione: e' la stessa regola gia' scelta due
  // volte in questo file (chiave mancante, link di disiscrizione non
  // firmabile). Chi chiama e' il webhook di Stripe o la creazione di un ordine:
  // far cadere l'ordine perche' non parte l'email sarebbe un danno piu' grande
  // del guasto.
  const mittente = env.resendFrom();
  if (!mittente) {
    logger.error('[email] mittente non configurato: nessuna email parte. Impostare RESEND_FROM', {
      subject: input.subject,
    });
    return { ok: false, skipped: true, reason: 'RESEND_FROM non configurata' };
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
  //
  // 15/10/2026 (R24) — e il ripiego e' di servizio: il link compare solo dove
  // chi spedisce ha scritto `tipo: 'marketing'`.
  const tipo: TipoEmail = input.tipo ?? 'transazionale';
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
    from: mittente,
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
  const opzioni = input.idempotencyKey ? conChiaveDiIdempotenza(resend, input.idempotencyKey) : undefined;
  let lastErr = 'unknown';
  for (let attempt = 0; attempt < 2; attempt++) {
    /**
     * 5/11/2026 — SI RITENTA SOLO QUANDO RESEND HA DETTO «NON L'HO PRESA».
     *
     * Dopo il tetto dei dieci secondi la chiamata a Resend non si annulla e può ancora riuscire:
     * il secondo tentativo, con lo stesso messaggio e senza chiave di idempotenza (resend 3.5 non
     * la ha), faceva arrivare la stessa email due volte. Ora dopo un timeout non si ritenta, e su
     * una risposta d'errore si ritenta solo se è passeggera (429 o 5xx): un 422 non cambia al
     * secondo giro.
     */
    let ritentabile = false;
    try {
      // #176 — Un tetto di dieci secondi per tentativo. Senza, una chiamata
      // appesa teneva ferma la risposta di chi la stava aspettando — nel caso
      // peggiore il webhook di Stripe, che se non riceve risposta ritenta e poi
      // disattiva l'endpoint.
      const { data, error } = await Promise.race([
        resend.emails.send(payload, opzioni),
        new Promise<never>((_, rifiuta) =>
          setTimeout(() => rifiuta(new Error(TIMEOUT_INVIO)), 10_000)),
      ]);
      if (!error) return { ok: true, id: data?.id ?? '' };
      lastErr = error.message ?? 'resend error';
      ritentabile = ['rate_limit_exceeded', 'internal_server_error', 'application_error'].includes(String(error.name));
    } catch (err) {
      lastErr = err instanceof Error ? err.message : 'unknown';
      // Il nostro tetto dei dieci secondi: la richiesta può essere arrivata, non si rimanda.
      ritentabile = !(err instanceof Error && err.message === TIMEOUT_INVIO);
    }
    if (!ritentabile) break;
    if (attempt === 0) await new Promise((r) => setTimeout(r, 300)); // breve backoff
  }
  logger.error('[email] invio fallito dopo retry', { message: lastErr });
  return { ok: false, error: lastErr };
}

const TIMEOUT_INVIO = 'invio email oltre i 10 secondi';

type OpzioniInvio = Parameters<Resend['emails']['send']>[1];

/**
 * L'intestazione `Idempotency-Key` di Resend. resend 3.5 non ha l'opzione, ma sparge le opzioni
 * sopra la richiesta (`{ method, headers, body, ...opzioni }`): si passano le sue intestazioni,
 * chiave d'accesso compresa, più la nostra. Le versioni nuove leggono `idempotencyKey` da sole.
 * Se le intestazioni dell'SDK non si trovano non si rischia di togliere la chiave d'accesso.
 */
function conChiaveDiIdempotenza(resend: Resend, chiave: string): OpzioniInvio {
  const base = (resend as unknown as { headers?: unknown }).headers;
  if (!(base instanceof Headers) || !base.has('Authorization')) {
    return { idempotencyKey: chiave } as unknown as OpzioniInvio;
  }
  const headers = new Headers(base);
  headers.set('Idempotency-Key', chiave);
  return { idempotencyKey: chiave, headers } as unknown as OpzioniInvio;
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

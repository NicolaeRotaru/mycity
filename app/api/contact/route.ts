import { NextResponse } from 'next/server';
import { z } from 'zod';
import { rateLimitAsync, getClientIp } from '@/lib/rate-limit';
import { getAdminSupabase, getCurrentUser } from '@/lib/supabase/server';
import { sendEmail } from '@/lib/email/client';
import { verifyTurnstileToken } from '@/lib/captcha';
import { logger } from '@/lib/logger';
import { ApiErrors, apiError } from '@/lib/api/responses';
import { jsonRichiesta, TETTO_JSON } from '@/lib/api/corpo';
// 27/8/2026 (R011) — Qui dentro c'era una copia identica del filtro dell'HTML,
// e `lib/html-escape.ts` diceva nel proprio commento di essere quella
// condivisa. Non lo era: la importava un file solo. Tre copie della stessa
// regola sono tre regole, e il giorno in cui va aggiunto un carattere da
// filtrare due restano indietro senza dirlo a nessuno.
import { escapeHtml } from '@/lib/html-escape';
import { recapitoPrivacy } from '@/lib/legal/titolare';
import { dopoLaRisposta } from '@/lib/api/dopo-la-risposta';

export const runtime = 'nodejs';

// 5/11/2026 — Ogni limite ha il suo messaggio in italiano: senza, il server
// rispondeva col testo inglese di Zod («String must contain at most 120
// character(s)») e la pagina lo mostrava così.
const Schema = z.object({
  name: z.string().trim().min(2, 'Nome troppo corto').max(120, 'Nome troppo lungo: massimo 120 caratteri'),
  email: z.string().trim().email('Email non valida'),
  subject: z.string().trim().min(1, 'Scrivi l\'oggetto').max(200, 'Oggetto troppo lungo: massimo 200 caratteri').default('Domanda generale'),
  message: z.string().trim().min(10, 'Messaggio troppo corto').max(5000, 'Messaggio troppo lungo: massimo 5000 caratteri'),
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

  // 5/11/2026 — Se il servizio di accesso non risponde, getCurrentUser lancia:
  // prima il modulo cadeva con un 500 muto. Il messaggio si accetta lo stesso,
  // senza il legame all'account.
  let user: Awaited<ReturnType<typeof getCurrentUser>> = null;
  try {
    user = await getCurrentUser();
  } catch (e) {
    logger.warn('[contact] accesso non verificabile: il messaggio si accetta senza account', {
      errore: e instanceof Error ? e.message : 'errore',
    });
  }
  let supa: ReturnType<typeof getAdminSupabase>;
  try {
    supa = getAdminSupabase();
  } catch (e) {
    // 27/10/2026 — IL MODULO NON LANCIA PIÙ.
    //
    // Senza la chiave di servizio `getAdminSupabase()` lancia, e qui non c'era
    // un try: il modulo rispondeva 500 muto. È la porta a cui l'informativa
    // manda chi vuole esercitare i diritti privacy (cancellarsi, scaricare i
    // dati). Adesso: se la posta del supporto è configurata il messaggio arriva
    // comunque a una persona; se no, una risposta 503 che dice cosa è successo.
    logger.error('[contact] database non raggiungibile: manca la chiave di servizio', {
      errore: e instanceof Error ? e.message : 'errore',
    });
    if (await inoltraSenzaDatabase(payload, user?.id ?? null)) return NextResponse.json({ ok: true });
    return moduloNonArrivato();
  }

  const { error } = await supa.from('contact_messages').insert({
    ...payload,
    user_id: user?.id ?? null,
    ip,
  });
  if (error) {
    logger.error('[contact] insert failed:', error);
    // 5/11/2026 — Database che risponde con errore: si prova l'inoltro per
    // email come quando manca la chiave, invece di un 500 «Errore interno».
    if (await inoltraSenzaDatabase(payload, user?.id ?? null)) return NextResponse.json({ ok: true });
    return moduloNonArrivato();
  }

  // Avviso al supporto, se sappiamo dove mandarlo. Nessun indirizzo di ripiego
  // inventato (vedi operational-alerts): il messaggio resta comunque in
  // contact_messages, quindi non si perde — si perde solo l'avviso immediato.
  const supporto = process.env.SUPPORT_EMAIL?.trim();
  if (!supporto) {
    logger.warn('[contact] SUPPORT_EMAIL non configurata: nessun avviso inviato');
  }
  // 5/11/2026 — L'invio partiva senza essere aspettato: su Vercel, dopo la
  // risposta, la funzione può essere congelata e l'avviso perdersi. Ora passa
  // da dopoLaRisposta (after()), come il resto del progetto.
  if (supporto) {
    dopoLaRisposta(async () => {
      const esito = await sendEmail({
        to: supporto,
        // 27/8/2026 (R067) — Questo e' un avviso interno alla nostra assistenza,
        // non una comunicazione commerciale: non deve portare il piede «annulla
        // l'iscrizione». Quel link spegne le promozioni dell'indirizzo che lo
        // preme, e qui l'indirizzo e' la nostra casella del supporto.
        tipo: 'transazionale',
        subject: `[Contact] ${payload.subject} — ${payload.name}`,
        html: htmlDelMessaggio(payload, user?.id ?? null),
        replyTo: payload.email,
      });
      if (!esito.ok) logger.warn('[contact] avviso al supporto non spedito', { subject: payload.subject });
    }, 'avviso contatti');
  }

  return NextResponse.json({ ok: true });
}

type Messaggio = { name: string; email: string; subject: string; message: string };

/**
 * 27/10/2026 (secondo giro) — Qui senza casella si diceva «Riprova tra
 * qualche ora»: falso, perché senza chiave e senza posta fra qualche ora è
 * uguale. Ed era l'ultima tappa del giro in tondo che partiva da Cancella
 * account. Adesso: la casella vera come collegamento, oppure la verità.
 */
function moduloNonArrivato(): NextResponse {
  const recapito = recapitoPrivacy();
  return apiError(
    503,
    'Il modulo dei contatti non funziona in questo momento e il tuo messaggio non è arrivato. ' +
      (recapito.eUnaCasella
        ? `Scrivici a ${recapito.testo}.`
        : 'Non abbiamo ancora una casella email attiva a cui scrivere: è un guasto nostro, non tuo.'),
    'SERVICE_UNAVAILABLE',
    { recapito: recapito.eUnaCasella ? { href: recapito.href, testo: recapito.testo } : null },
  );
}

function htmlDelMessaggio(p: Messaggio, utenteId: string | null = null): string {
  // 5/11/2026 — Con l'account di chi ha scritto, se aveva fatto l'accesso: una
  // richiesta privacy inoltrata senza database arrivava senza legame all'account.
  const account = utenteId ? `<p><strong>Account:</strong> ${escapeHtml(utenteId)}</p>` : '';
  return `<p><strong>Da:</strong> ${escapeHtml(p.name)} &lt;${escapeHtml(p.email)}&gt;</p>${account}
           <p><strong>Soggetto:</strong> ${escapeHtml(p.subject)}</p>
           <hr>
           <p>${escapeHtml(p.message).replace(/\n/g, '<br>')}</p>`;
}

/**
 * 27/10/2026 — Senza database il messaggio non si salva, ma può ancora arrivare
 * a una persona: si inoltra alla posta del supporto e si ASPETTA l'esito. Vero
 * solo se l'email è partita davvero: un «ok» detto a chi ha scritto, con un
 * messaggio che non è arrivato a nessuno, è peggio di un errore.
 */
async function inoltraSenzaDatabase(p: Messaggio, utenteId: string | null): Promise<boolean> {
  const supporto = process.env.SUPPORT_EMAIL?.trim();
  // 5/11/2026 — Una traccia di chi ha scritto, anche quando il database non c'è.
  logger.warn('[contact] messaggio da inoltrare senza database', { utente: utenteId, oggetto: p.subject });
  if (!supporto) return false;
  try {
    const esito = await sendEmail({
      to: supporto,
      tipo: 'transazionale',
      subject: `[Contact — NON salvato nel database] ${p.subject} — ${p.name}`,
      html: htmlDelMessaggio(p, utenteId),
      replyTo: p.email,
    });
    return esito.ok === true;
  } catch (e) {
    logger.error('[contact] inoltro senza database non riuscito', {
      errore: e instanceof Error ? e.message : 'errore',
    });
    return false;
  }
}

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
import { recapitoPrivacy } from '@/lib/legal/titolare';

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
    if (await inoltraSenzaDatabase(payload)) return NextResponse.json({ ok: true });
    const recapito = recapitoPrivacy();
    return ApiErrors.unavailable(
      'Il modulo dei contatti non funziona in questo momento e il tuo messaggio non è arrivato. ' +
        (recapito.eUnaCasella ? `Scrivici a ${recapito.testo}.` : 'Riprova tra qualche ora.'),
    );
  }

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
    html: htmlDelMessaggio(payload),
    replyTo: payload.email,
  }).catch(() => { /* noop */ });

  return NextResponse.json({ ok: true });
}

type Messaggio = { name: string; email: string; subject: string; message: string };

function htmlDelMessaggio(p: Messaggio): string {
  return `<p><strong>Da:</strong> ${escapeHtml(p.name)} &lt;${escapeHtml(p.email)}&gt;</p>
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
async function inoltraSenzaDatabase(p: Messaggio): Promise<boolean> {
  const supporto = process.env.SUPPORT_EMAIL?.trim();
  if (!supporto) return false;
  try {
    const esito = await sendEmail({
      to: supporto,
      tipo: 'transazionale',
      subject: `[Contact — NON salvato nel database] ${p.subject} — ${p.name}`,
      html: htmlDelMessaggio(p),
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

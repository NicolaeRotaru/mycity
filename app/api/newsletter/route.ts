import { NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { z } from 'zod';
import crypto from 'node:crypto';
import { getAdminSupabase } from '@/lib/supabase/server';
import { rateLimitAsync, getClientIp } from '@/lib/rate-limit';
import { ApiErrors } from '@/lib/api/responses';
import { sendEmail } from '@/lib/email/client';
import { verifyTurnstileToken } from '@/lib/captcha';
import { jsonRichiesta, TETTO_JSON } from '@/lib/api/corpo';

export const runtime = 'nodejs';

/**
 * Iscrizione alla newsletter con conferma via email (doppio consenso).
 *
 * Perché passa da qui e non più dal browser: la tabella accettava INSERT da
 * chiunque, anche senza account. Chiunque poteva iscrivere l'indirizzo di un
 * altro, e della volontà di iscriversi non restava alcuna prova — né quando, né
 * da quale indirizzo di rete, né su quale versione dell'informativa. Ora
 * l'iscrizione nasce inattiva e diventa attiva solo quando chi possiede la
 * casella clicca il link di conferma: è la prova che l'indirizzo è suo.
 */

const Body = z.object({
  email: z.string().email().max(254),
  city: z.string().max(80).optional(),
  /** Versione del testo informativo mostrato accanto al campo. */
  consentTextVersion: z.string().max(40).optional(),
  /** Gettone Cloudflare Turnstile, come sulla pagina contatti e sull'accesso. */
  captchaToken: z.string().optional(),
});

/** Testo del consenso attualmente mostrato nel modulo. */
const VERSIONE_TESTO_CONSENSO = 'newsletter-v1';

/**
 * 27/8/2026 (R025) — QUANTO SPESSO SI PUÒ RISPEDIRE UNA CONFERMA ALLO STESSO INDIRIZZO.
 *
 * Prima: sempre. Ogni richiesta ripetuta su un indirizzo non confermato riscriveva la riga con un
 * gettone nuovo e faceva partire un'altra email. Bastava un ciclo per riempire la casella di un
 * estraneo col nostro dominio in mittente — e chi la segnala come indesiderata affonda la consegna
 * di TUTTE le nostre email, conferme d'ordine e codici di ritiro compresi.
 */
const RIPETIZIONE_CONFERMA_MS = 10 * 60_000;

export async function POST(request: Request) {
  const ip = getClientIp(request);
  const rl = await rateLimitAsync({ key: `newsletter:${ip}`, max: 5, windowMs: 10 * 60_000 });
  if (!rl.allowed) {
    return ApiErrors.rateLimited(rl.retryAfterSec, 'Troppe iscrizioni da questa rete. Riprova più tardi.');
  }

  let raw: unknown;
  try {
    raw = await jsonRichiesta(request, TETTO_JSON);
  } catch {
    return ApiErrors.invalidRequest('Body JSON non valido');
  }

  const parsed = Body.safeParse(raw);
  if (!parsed.success) return ApiErrors.invalidRequest('Email non valida');

  // Se TURNSTILE_SECRET_KEY non è configurata, `verifyTurnstileToken` risponde ok: lo sviluppo
  // locale non ha bisogno dell'integrazione. In produzione la chiave c'è, e il modulo pubblico più
  // esposto del sito smette di essere l'unico senza controllo anti-bot.
  const antiBot = await verifyTurnstileToken(parsed.data.captchaToken, ip);
  if (!antiBot.ok) return ApiErrors.invalidRequest('Verifica anti-bot fallita. Riprova.');

  const email = parsed.data.email.trim().toLowerCase();
  const admin = getAdminSupabase();
  const token = crypto.randomBytes(24).toString('base64url');

  // Se l'indirizzo c'è già ed è confermato non si fa nulla e non si dice nulla:
  // rispondere «esiste» direbbe a un estraneo chi è iscritto.
  const { data: esistente } = await admin
    .from('newsletter_subscribers')
    .select('id, confirmed_at, created_at')
    .eq('email', email)
    .maybeSingle();

  if (esistente?.confirmed_at) {
    return NextResponse.json({ ok: true });
  }

  // Una conferma in attesa scritta pochi minuti fa: il gettone di prima è ancora valido e una
  // seconda email non serve a nessuno. La risposta resta identica a quella del caso normale —
  // dire «ne è già partita una» racconterebbe a un estraneo chi si sta iscrivendo.
  const ultimoTentativo = esistente?.created_at ? Date.parse(String(esistente.created_at)) : NaN;
  if (Number.isFinite(ultimoTentativo) && Date.now() - ultimoTentativo < RIPETIZIONE_CONFERMA_MS) {
    return NextResponse.json({ ok: true });
  }

  const riga = {
    email,
    city: parsed.data.city ?? null,
    active: false,
    confirm_token: token,
    consent_ip: ip,
    consent_source: 'form-web',
    consent_text_version: parsed.data.consentTextVersion ?? VERSIONE_TESTO_CONSENSO,
    // La data dice quando è partita l'ULTIMA conferma: è il metro della pausa qui sopra, ed è
    // anche quello con cui si potano le iscrizioni mai confermate.
    created_at: new Date().toISOString(),
  };

  const { error } = esistente
    ? await admin.from('newsletter_subscribers').update(riga).eq('id', esistente.id)
    : await admin.from('newsletter_subscribers').insert(riga);

  if (error) {
    return ApiErrors.internal('Iscrizione non riuscita');
  }

  const base = env.appUrl();
  const link = `${base}/api/newsletter/confirm?token=${encodeURIComponent(token)}`;

  await sendEmail({
    to: email,
    subject: 'Confermi l’iscrizione alle novità di MyCity?',
    html: `
      <p>Ciao,</p>
      <p>hai chiesto di ricevere le novità dei negozi di Piacenza. Per confermare, clicca qui:</p>
      <p><a href="${link}">Sì, confermo</a></p>
      <p>Se non sei stato tu, ignora questa email: senza conferma non ti scriveremo.</p>
    `,
  }).catch(() => { /* l'email è best-effort: l'iscrizione resta in attesa */ });

  return NextResponse.json({ ok: true });
}

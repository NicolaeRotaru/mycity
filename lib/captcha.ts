import { env } from '@/lib/env';
import { logger } from '@/lib/logger';

/**
 * Verifica server-side di un token Cloudflare Turnstile.
 *
 * Se la chiave segreta non è configurata (TURNSTILE_SECRET_KEY assente),
 * la verifica è disabilitata: ritorna { ok: true, skipped: true } in modo
 * che lo sviluppo locale non richieda l'integrazione.
 *
 * In produzione la chiave DEVE essere impostata, altrimenti il signup
 * resta vulnerabile a bot.
 */
export async function verifyTurnstileToken(token: string | null | undefined, remoteIp?: string): Promise<
  { ok: true; skipped?: true } | { ok: false; reason: string }
> {
  const secret = env.turnstileSecretKey();
  if (!secret) {
    // In produzione la chiave DEVE esserci: logghiamo un errore (visibile in Sentry)
    // così la misconfigurazione emerge subito, senza però bloccare i login legittimi.
    if (process.env.NODE_ENV === 'production') {
      logger.error(new Error('TURNSTILE_SECRET_KEY mancante in produzione: CAPTCHA disabilitato (rischio bot)'), {
        context: 'captcha',
      });
    }
    return { ok: true, skipped: true };
  }
  if (!token) return { ok: false, reason: 'CAPTCHA mancante' };

  const body = new URLSearchParams();
  body.append('secret', secret);
  body.append('response', token);
  if (remoteIp) body.append('remoteip', remoteIp);

  try {
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      cache: 'no-store',
      signal: AbortSignal.timeout(5_000), // 🟡-19: niente hang sulla verifica CAPTCHA
    });
    const data = await r.json();
    if (data?.success === true) return { ok: true };
    return { ok: false, reason: 'CAPTCHA non valido' };
  } catch {
    return { ok: false, reason: 'Verifica CAPTCHA fallita' };
  }
}

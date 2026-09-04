import { env } from '@/lib/env';
import { logger } from '@/lib/logger';

/**
 * Verifica server-side di un token Cloudflare Turnstile.
 *
 * Fuori dalla produzione, se la chiave segreta non è configurata
 * (TURNSTILE_SECRET_KEY assente) la verifica è disabilitata: ritorna
 * { ok: true, skipped: true }, così lo sviluppo locale non richiede
 * l'integrazione.
 *
 * 3/9/2026 — IN PRODUZIONE LA DIFESA NON SI SPEGNE DA SOLA.
 *
 * Qui, quando la chiave mancava, questa funzione scriveva una riga di errore
 * nei registri e poi rispondeva «va bene» a QUALSIASI token, anche vuoto. Cioè
 * il controllo anti-robot si spegneva da solo invece di fermarsi. Le quattro
 * porte che ci si appoggiano — accesso, registrazione, modulo contatti e
 * iscrizione alla newsletter — restavano difese dal solo contatore per
 * indirizzo di rete: dieci tentativi ogni cinque minuti sull'accesso. Un
 * ambiente di anteprima costruito con NODE_ENV=production ma senza quella
 * variabile diventava una porta di accesso senza controllo anti-robot contro
 * gli account veri, e a dirlo c'era solo una riga in un registro che nessuno
 * guarda.
 *
 * Una difesa che non è configurata deve RIFIUTARE la richiesta e dichiarare il
 * guasto, non lasciar passare tutti in silenzio. Chi arriva legge un messaggio
 * chiaro e riprova; l'errore nei registri resta e dice cosa manca.
 */
export async function verifyTurnstileToken(token: string | null | undefined, remoteIp?: string): Promise<
  { ok: true; skipped?: true } | { ok: false; reason: string }
> {
  const secret = env.turnstileSecretKey();
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      logger.error(new Error('TURNSTILE_SECRET_KEY mancante in produzione: verifica anti-bot NON eseguibile'), {
        context: 'captcha',
      });
      return { ok: false, reason: 'Controllo anti-robot non disponibile: riprova tra poco.' };
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

import { NextResponse } from 'next/server';
import { authServer } from '@/lib/supabase/auth-server';
import { rateLimitAsync, getClientIp } from '@/lib/rate-limit';
import { verifyTurnstileToken } from '@/lib/captcha';
import { ApiErrors } from '@/lib/api/responses';
import { jsonRichiesta, TETTO_JSON } from '@/lib/api/corpo';
import { CODICE_EMAIL_DA_CONFERMARE, eEmailNonConfermata } from '@/lib/auth/conferma-email';
import { verbalizzaSenzaTrattenere, versioneAccettata } from '@/lib/auth/accettazione-testi';
import { getAdminSupabase } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

/** La stessa risposta per i due modi in cui Supabase dice «email non confermata». */
function rispostaEmailDaConfermare() {
  return NextResponse.json(
    {
      ok: false,
      error: {
        code: CODICE_EMAIL_DA_CONFERMARE,
        message: 'Devi confermare la tua email prima di accedere. Controlla la posta.',
      },
    },
    { status: 403 },
  );
}

export async function POST(request: Request) {
  // Rate limit per IP: 10 tentativi / 5 min (anti brute-force)
  const ip = getClientIp(request);
  const rl = await rateLimitAsync({ key: `signin:${ip}`, max: 10, windowMs: 5 * 60_000 });
  if (!rl.allowed) {
    return ApiErrors.rateLimited(rl.retryAfterSec, 'Troppi tentativi di accesso. Riprova tra qualche minuto.');
  }

  let body: { email?: unknown; password?: unknown; captchaToken?: unknown };
  try {
    body = await jsonRichiesta(request, TETTO_JSON);
  } catch {
    return ApiErrors.invalidRequest('Body JSON non valido');
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const captchaToken = typeof body.captchaToken === 'string' ? body.captchaToken : '';

  if (!EMAIL_RE.test(email) || email.length > 254) {
    return ApiErrors.invalidRequest('Email non valida');
  }
  if (password.length < 6 || password.length > 200) {
    return ApiErrors.invalidRequest('Password non valida');
  }

  // Secondo limite, sull'indirizzo email invece che sull'indirizzo di rete: chi
  // prova mille password su un account solo cambiando rete a ogni tentativo
  // aggirava il limite per IP. Le due misure insieme chiudono i due casi —
  // molti account da una rete, e un account da molte reti.
  const rlEmail = await rateLimitAsync({ key: `signin-email:${email}`, max: 10, windowMs: 5 * 60_000 });
  if (!rlEmail.allowed) {
    return ApiErrors.rateLimited(rlEmail.retryAfterSec, 'Troppi tentativi su questo account. Riprova tra qualche minuto.');
  }

  const cap = await verifyTurnstileToken(captchaToken, ip);
  if (!cap.ok) {
    return ApiErrors.invalidRequest(cap.reason);
  }

  try {
    const { data, error, client } = await authServer.signIn(email, password, { captchaToken });
    if (error) {
      /**
       * 15/10/2026 (R43) — «PASSWORD SBAGLIATA» A CHI AVEVA SOLO L'EMAIL DA CONFERMARE.
       *
       * Qui QUALSIASI errore diventava «Email o password non corretti». Con la
       * conferma dell'email accesa, Supabase risponde «Email not confirmed» a
       * chi ha la password giusta ma non ha ancora aperto il link: quella
       * persona leggeva la colpa sbagliata, provava a cambiare password e
       * restava fuori. Supabase lo dice solo dopo aver controllato la
       * password, quindi chi tira a indovinare non scopre niente di nuovo.
       */
      if (eEmailNonConfermata(error)) return rispostaEmailDaConfermare();
      return ApiErrors.unauthorized('Email o password non corretti');
    }

    // Gate verifica email: blocca login se non confermata
    if (data?.user && !data.user.email_confirmed_at) {
      // Logout pulito per non lasciare cookie semi-validi
      try { await client.auth.signOut(); } catch { /* noop */ }
      return rispostaEmailDaConfermare();
    }

    /**
     * 15/10/2026 (R13) — IL VERBALE ANCHE PER CHI ENTRA CON LA PASSWORD.
     *
     * Chi apriva il link di conferma su un altro dispositivo vedeva fallire il
     * ritorno, l'unico punto che metteva a verbale Termini e Informativa: poi
     * entrava da qui, e la riga non si scriveva mai. Adesso il primo accesso
     * la scrive anche da qui, con la versione che la persona aveva davanti
     * quando si e' registrata. Non blocca mai l'accesso: se il database non
     * risponde entro `TETTO_VERBALE_MS`, si entra lo stesso.
     */
    const versione = versioneAccettata(data?.user, null);
    if (data?.user?.id && versione) {
      const verbale = await verbalizzaSenzaTrattenere(getAdminSupabase, {
        utenteId: data.user.id,
        versione,
        ip,
        userAgent: request.headers.get('user-agent'),
      });
      if (verbale === 'scaduto' || verbale === 'rotto' || verbale === 'non-scritta') {
        logger.warn('[signin] accettazione dei testi non registrata', { esito: verbale });
      }
    }

    return NextResponse.json(data, { status: 200 });
  } catch {
    return ApiErrors.internal('Errore durante il login');
  }
}

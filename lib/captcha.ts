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
  if (!token) {
    /**
     * 8/9/2026 — «CAPTCHA MANCANTE» AVEVA DUE CAUSE OPPOSTE E UN MESSAGGIO SOLO.
     *
     * Quasi sempre e' quello che sembra: un robot che manda il modulo senza
     * passare dalla pagina, o una rete che blocca challenges.cloudflare.com.
     * Roba di tutti i giorni, che non deve svegliare nessuno.
     *
     * Ma c'e' un secondo caso, che sembra identico da qui e non lo e' per
     * niente: la meta' PUBBLICA della coppia non e' finita nel pacchetto del
     * browser. Allora la pagina non disegna proprio il riquadro, il gettone non
     * puo' esistere, e questa riga scatta per OGNI persona che prova ad
     * accedere, registrarsi, scrivere dai contatti o iscriversi alla
     * newsletter. Non e' un bot: e' la porta d'ingresso del marketplace chiusa.
     * Succede da solo il giorno che si ruotano le chiavi su Cloudflare e su
     * Vercel si aggiorna solo la segreta.
     *
     * `/api/health` adesso lo vede prima, ed e' li' che va visto. Questa riga
     * copre il pezzo che il semaforo NON puo' misurare — una chiave pubblica
     * presente ma sbagliata o vecchia — e serve a chi apre i registri con il
     * sito gia' in fiamme: gli dice dove guardare invece di lasciarlo cercare
     * un bot che non c'e'.
     *
     * Si registra SOLO in questo secondo caso. Un avviso a ogni gettone
     * mancante sarebbe rumore su un fatto normale, e un registro che urla
     * sempre e' un registro che non legge piu' nessuno.
     *
     * Il nome va scritto per esteso: e' l'unica forma che Next sostituisce col
     * valore finito nel pacchetto del browser. `process.env[nome]`, col nome
     * dentro una variabile, risponderebbe a un'altra domanda.
     */
    if (!process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY) {
      logger.error(
        new Error(
          'NEXT_PUBLIC_TURNSTILE_SITE_KEY assente nel pacchetto del browser: la pagina non disegna ' +
            'il riquadro anti-robot, quindi nessun gettone puo arrivare. Accesso, registrazione, ' +
            'contatti e newsletter sono chiusi per TUTTI, non per un bot.',
        ),
        { context: 'captcha' },
      );
    }
    return { ok: false, reason: 'CAPTCHA mancante' };
  }

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

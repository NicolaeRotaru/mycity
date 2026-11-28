/**
 * R07-015 — Senza il gettone anti-robot la pagina non dice che il gettone «è stato rigenerato».
 *
 * Col CAPTCHA acceso su Supabase, una richiesta partita senza gettone (riquadro Turnstile non
 * caricato, o una pagina che il riquadro non ce l'ha) torna con un errore che parla di captcha.
 * La traduzione condivisa lo leggeva sempre come «Il controllo anti-bot è scaduto: è stato
 * rigenerato, premi di nuovo»: un gettone rigenerato che non c'è, su un riquadro che non c'è.
 *
 * Supabase finto: i testi che Supabase Auth manda quando il gettone manca o non si può
 * verificare. Il gettone rifiutato (già speso, scaduto) resta come prima: lì la pagina ne
 * chiede uno nuovo davvero.
 */
import { describe, it, expect } from 'vitest';
import { traduciErroreAuth } from '@/lib/errors';
import { rimandaLinkDiConferma, type ClientPerReinvio } from '@/lib/auth/conferma-email';

const SENZA_GETTONE = [
  'captcha verification process failed',
  'no captcha response (captcha_token) found in request',
  'captcha protection: request disallowed (no captcha response)',
  'captcha protection: request disallowed (missing-input-response)',
  // Il testo di GoTrue di oggi (2.190+), con codice captcha_failed: è il caso più frequente.
  'captcha protection: request disallowed (no captcha_token found)',
  'CAPTCHA mancante',
];

describe('R07-015 — senza gettone non si parla di un gettone rigenerato', () => {
  it.each(SENZA_GETTONE)('«%s» non promette un gettone rigenerato e dice di ricaricare', (testo) => {
    const frase = traduciErroreAuth(testo);
    expect(frase).toBeTruthy();
    expect(frase!, 'parla di un gettone rigenerato che non c’è').not.toMatch(/rigenerat/i);
    expect(frase!).toMatch(/ricarica la pagina/i);
  });

  it('il reinvio della conferma partito senza gettone non dice «rigenerato» (la pagina non ha riquadro)', async () => {
    const client: ClientPerReinvio = {
      auth: {
        resend: async () => ({
          error: { message: 'captcha verification process failed', code: 'unexpected_failure', status: 500 },
        }),
      },
    };
    const esito = await rimandaLinkDiConferma(client, { email: 'persona@esempio.it', base: 'https://mycity.test' });
    expect(esito.esito).toBe('errore');
    expect(esito.messaggio).not.toMatch(/rigenerat/i);
    expect(esito.messaggio).toMatch(/anti-robot/i);
  });

  it('il gettone rifiutato (già speso) resta «rigenerato, premi di nuovo», come prima', () => {
    expect(traduciErroreAuth('captcha protection: request disallowed (timeout-or-duplicate)')).toBe(
      'Il controllo anti-bot è scaduto: è stato rigenerato, premi di nuovo.',
    );
  });
});

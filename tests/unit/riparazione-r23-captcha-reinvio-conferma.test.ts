/**
 * R23-014 — Il reinvio della mail di conferma porta il gettone anti-robot a Supabase.
 *
 * Col CAPTCHA acceso su Supabase, `resend` senza `captchaToken` viene rifiutato e nessuno riceve il
 * nuovo link. `rimandaLinkDiConferma` non aveva dove riceverlo: adesso chi lo chiama lo passa, e
 * arriva nella chiamata a Supabase. Senza gettone la chiamata resta quella di prima.
 */
import { describe, it, expect } from 'vitest';
import { rimandaLinkDiConferma, type ClientPerReinvio } from '@/lib/auth/conferma-email';

type Chiamata = Parameters<ClientPerReinvio['auth']['resend']>[0];

function clientFinto() {
  const chiamate: Chiamata[] = [];
  const client: ClientPerReinvio = {
    auth: {
      resend: async (credenziali) => {
        chiamate.push(credenziali);
        return { error: null };
      },
    },
  };
  return { client, chiamate };
}

describe('R23-014 — il reinvio della conferma porta il gettone anti-robot', () => {
  it('IL CASO DELLA VOCE — il gettone passato arriva a Supabase', async () => {
    const { client, chiamate } = clientFinto();
    const esito = await rimandaLinkDiConferma(client, {
      email: 'persona@esempio.it',
      base: 'https://mycity.test',
      returnTo: '/checkout',
      captchaToken: 'gettone-1',
    });
    expect(esito.esito).toBe('inviato');
    expect(chiamate).toHaveLength(1);
    expect(chiamate[0].options?.captchaToken, 'il reinvio parte senza gettone').toBe('gettone-1');
    expect(chiamate[0].options?.emailRedirectTo).toContain('/auth/callback');
  });

  it('senza gettone la chiamata resta quella di prima', async () => {
    const { client, chiamate } = clientFinto();
    await rimandaLinkDiConferma(client, { email: 'persona@esempio.it', base: 'https://mycity.test' });
    expect(chiamate[0].options && 'captchaToken' in chiamate[0].options).toBe(false);
  });
});

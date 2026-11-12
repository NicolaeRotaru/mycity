/**
 * @vitest-environment jsdom
 */
/**
 * R12-017 — Il reinvio dell'email di conferma dava messaggi che si
 * contraddicevano e non diceva quanto aspettare: il freno dei 60 secondi di
 * Supabase diventava «Non siamo riusciti a mandare l'email», e «Reinvia»
 * restava sempre acceso.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const stato = vi.hoisted(() => ({
  risposte: [] as Array<{ error: { message?: string; code?: string; status?: number } | null }>,
}));

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('') }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: {
      getUser: async () => ({ data: { user: null } }),
      resend: async () => stato.risposte.shift() ?? { error: null },
    },
  },
  auth: { signOut: async () => {} },
}));

import { rimandaLinkDiConferma, ricordaEmailDaConfermare, memoriaDellaScheda } from '@/lib/auth/conferma-email';
import VerifyEmailPage from '@/app/auth/verify-email/page';

const clientCon = (error: { message?: string; code?: string; status?: number } | null) => ({
  auth: { resend: async () => ({ error }) },
});
const dati = { email: 'maria@example.com', base: 'https://mycity.test' };

describe('R12-017 il reinvio della conferma dice quanto aspettare', () => {
  it('il freno dei 60 secondi: dice fra quanti secondi, non «non siamo riusciti»', async () => {
    const esito = await rimandaLinkDiConferma(
      clientCon({ status: 429, code: 'over_email_send_rate_limit', message: 'For security purposes, you can only request this after 55 seconds.' }),
      dati,
    );
    expect(esito.messaggio).toContain('55');
    expect(esito.messaggio).not.toMatch(/Non siamo riusciti/);
    expect(esito.attesaSecondi).toBe(55);
  });

  it('il tetto orario del progetto non parla di «questo indirizzo»', async () => {
    const esito = await rimandaLinkDiConferma(
      clientCon({ status: 429, code: 'over_email_send_rate_limit', message: 'email rate limit exceeded' }),
      dati,
    );
    expect(esito.messaggio).not.toMatch(/questo indirizzo/);
    expect(esito.messaggio).toMatch(/riprova/i);
  });

  it('dopo un invio riuscito si aspetta un minuto prima del prossimo', async () => {
    const esito = await rimandaLinkDiConferma(clientCon(null), dati);
    expect(esito.esito).toBe('inviato');
    expect(esito.attesaSecondi).toBe(60);
  });
});

describe('R12-017 nella pagina «Reinvia» si spegne col conto alla rovescia', () => {
  let radice: Root;
  let c: HTMLDivElement;
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    sessionStorage.clear();
    ricordaEmailDaConfermare(memoriaDellaScheda(), 'maria@example.com');
    c = document.createElement('div');
    document.body.appendChild(c);
    radice = createRoot(c);
  });
  afterEach(() => {
    act(() => radice.unmount());
    c.remove();
    vi.useRealTimers();
  });

  it('dopo un invio il pulsante resta spento e conta i secondi, poi si riaccende', async () => {
    stato.risposte = [{ error: null }];
    await act(async () => { radice.render(createElement(VerifyEmailPage)); });
    const pulsante = () => c.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(pulsante().disabled).toBe(false);
    await act(async () => { pulsante().click(); });
    expect(pulsante().disabled, 'ripremuto subito prende il freno di Supabase').toBe(true);
    expect(pulsante().textContent).toMatch(/60/);
    const unSecondo = async () => { await act(async () => { vi.advanceTimersByTime(1000); }); };
    for (let i = 0; i < 30; i++) await unSecondo();
    expect(pulsante().textContent).toMatch(/30/);
    for (let i = 0; i < 31; i++) await unSecondo();
    expect(pulsante().disabled).toBe(false);
  });
});

describe('R12-017 il singolare', () => {
  it('«after 1 second» dice «fra 1 secondo»', async () => {
    const esito = await rimandaLinkDiConferma(
      clientCon({ status: 429, code: 'over_email_send_rate_limit', message: 'For security purposes, you can only request this after 1 second.' }),
      dati,
    );
    expect(esito.messaggio).toContain('fra 1 secondo.');
  });
});

describe('R12-017 collaudo K03: la frase conta col bottone', () => {
  let radice: Root;
  let c: HTMLDivElement;
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    sessionStorage.clear();
    ricordaEmailDaConfermare(memoriaDellaScheda(), 'maria@example.com');
    c = document.createElement('div');
    document.body.appendChild(c);
    radice = createRoot(c);
  });
  afterEach(() => {
    act(() => radice.unmount());
    c.remove();
    vi.useRealTimers();
  });

  it('il freno di 55 secondi: la frase scende con il bottone e a zero sparisce', async () => {
    stato.risposte = [{ error: { status: 429, code: 'over_email_send_rate_limit', message: 'For security purposes, you can only request this after 55 seconds.' } }];
    await act(async () => { radice.render(createElement(VerifyEmailPage)); });
    await act(async () => { (c.querySelector('button[type="submit"]') as HTMLButtonElement).click(); });
    const stato_ = () => c.querySelector('[role="status"]')?.textContent ?? '';
    expect(stato_()).toContain('fra 55 secondi');
    for (let i = 0; i < 43; i++) await act(async () => { vi.advanceTimersByTime(1000); });
    expect(stato_()).toContain('fra 12 secondi');
    for (let i = 0; i < 12; i++) await act(async () => { vi.advanceTimersByTime(1000); });
    expect(stato_(), 'il bottone è acceso e la frase dice ancora di aspettare').toBe('');
  });

  it('il tetto del progetto dice «qualche minuto» e il bottone resta spento più di un minuto', async () => {
    const esito = await rimandaLinkDiConferma(
      clientCon({ status: 429, code: 'over_email_send_rate_limit', message: 'email rate limit exceeded' }),
      dati,
    );
    expect(esito.attesaSecondi ?? 0).toBeGreaterThan(60);
  });
});

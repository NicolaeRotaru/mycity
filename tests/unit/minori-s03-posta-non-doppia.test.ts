import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/** S03 — la stessa email non parte due volte quando Resend è lento (scheda 39). Nessun invio vero: resend è finto. */
const stato = vi.hoisted(() => ({ chiamate: 0, risposta: 'lenta' as 'lenta' | '422' | '500' }));
vi.mock('resend', () => ({
  Resend: class {
    emails = {
      send: async () => {
        stato.chiamate++;
        if (stato.risposta === 'lenta') return new Promise(() => {});
        if (stato.risposta === '422') return { data: null, error: { name: 'validation_error', message: 'bad' } };
        return { data: null, error: { name: 'internal_server_error', message: 'boom' } };
      },
    };
  },
}));
vi.mock('@/lib/logger', () => ({ logger: { info: () => {}, warn: () => {}, error: () => {} } }));

async function posta() {
  vi.resetModules();
  return (await import('@/lib/email/client')).sendEmail;
}
const MESSAGGIO = { to: 'maria@example.it', subject: 'Prova', html: '<p>x</p>', tipo: 'transazionale' as const };

beforeEach(() => {
  stato.chiamate = 0;
  vi.stubEnv('RESEND_API_KEY', 're_prova');
  vi.stubEnv('RESEND_FROM', 'MyCity <ordini@mycity.example>');
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://mycity.example');
  vi.useFakeTimers();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe('invio email', () => {
  it('dopo il tetto dei dieci secondi non si ritenta: la prima può ancora arrivare', async () => {
    stato.risposta = 'lenta';
    const send = await posta();
    const p = send(MESSAGGIO);
    await vi.advanceTimersByTimeAsync(25_000);
    const esito = await p;
    expect(esito.ok).toBe(false);
    expect(stato.chiamate).toBe(1);
  });

  it('un 422 non si ritenta', async () => {
    stato.risposta = '422';
    const send = await posta();
    const p = send(MESSAGGIO);
    await vi.advanceTimersByTimeAsync(1_000);
    await p;
    expect(stato.chiamate).toBe(1);
  });

  it('controprova: un 500 di Resend si ritenta una volta', async () => {
    stato.risposta = '500';
    const send = await posta();
    const p = send(MESSAGGIO);
    await vi.advanceTimersByTimeAsync(1_000);
    await p;
    expect(stato.chiamate).toBe(2);
  });
});

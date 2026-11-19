import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * R04-019 — Una risposta del servizio di posta senza id di invio (per esempio una risposta
 * d'errore conservata e riproposta con stato 200) non conta come spedita.
 */

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

const risposte: Array<{ status: number; corpo: unknown }> = [];
const chiamate: unknown[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  risposte.length = 0;
  chiamate.length = 0;
  vi.stubGlobal('fetch', async (...args: unknown[]) => {
    chiamate.push(args);
    const r = risposte.shift() ?? { status: 200, corpo: { id: 'msg-1' } };
    return new Response(JSON.stringify(r.corpo), { status: r.status, headers: { 'content-type': 'application/json' } });
  });
  vi.stubEnv('RESEND_API_KEY', 're_prova');
  vi.stubEnv('RESEND_FROM', 'MyCity <ordini@mycity.example>');
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function invia() {
  vi.resetModules();
  const { sendEmail } = await import('@/lib/email/client');
  const p = sendEmail({ to: 'a@example.com', subject: 's', html: '<p>x</p>', text: 'x' });
  await vi.advanceTimersByTimeAsync(12_000);
  return p;
}

describe('R04-019 — spedita solo se il servizio ha dato un id', () => {
  it('risposta con id: spedita', async () => {
    risposte.push({ status: 200, corpo: { id: 'msg-42' } });
    expect(await invia()).toEqual({ ok: true, id: 'msg-42' });
  });

  it('risposta 200 senza id: non spedita', async () => {
    risposte.push({ status: 200, corpo: {} });
    const r = await invia();
    expect(r.ok).toBe(false);
  });

  it('risposta d errore conservata con stato 200: non spedita', async () => {
    risposte.push({ status: 200, corpo: { name: 'validation_error', message: 'indirizzo non valido' } });
    const r = await invia();
    expect(r.ok).toBe(false);
  });
});

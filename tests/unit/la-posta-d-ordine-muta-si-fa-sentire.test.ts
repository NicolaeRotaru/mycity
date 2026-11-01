import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * 1/11/2026 — In produzione manca il trigger della migrazione 150: «ordine pronto» e «ordine
 * consegnato» non entrano mai in coda, e il giro di app/api/cron/send-emails rispondeva «sent: 0»
 * come in un giorno senza ordini. Adesso, se ci sono ordini consegnati e nessuna riga
 * `order_delivered`, il giro lo scrive come errore e lo riporta nella risposta.
 */

const errori: string[] = [];
vi.mock('@/lib/api/middleware', () => ({ withCronAuth: (h: (req: unknown) => unknown) => (req: unknown) => h(req) }));
vi.mock('@/lib/email/client', () => ({ sendEmail: async () => ({ ok: true, id: 'x' }) }));
vi.mock('@/lib/logger', () => ({
  logger: { info: () => {}, warn: () => {}, error: (m: string) => { errori.push(m); }, spesa: () => {} },
}));

let consegnati = 0;
let righeConsegnato = 0;

function finto() {
  return {
    rpc: async () => ({ data: [], error: null }),
    auth: { admin: { getUserById: async () => ({ data: null, error: null }) } },
    from: (tabella: string) => {
      const q = {
        select: () => q, not: () => q, gte: () => q, lte: () => q, eq: () => q,
        in: async () => ({ data: [], error: null }),
        then: (ok: (r: unknown) => unknown) =>
          ok({ count: tabella === 'orders' ? consegnati : righeConsegnato, error: null }),
      };
      return q;
    },
  };
}
vi.mock('@supabase/supabase-js', () => ({ createClient: () => finto() }));

async function giro() {
  vi.resetModules();
  const { POST } = await import('@/app/api/cron/send-emails/route');
  const r = await (POST as unknown as (req: Request) => Promise<Response>)(
    new Request('http://localhost/api/cron/send-emails', { method: 'POST' }),
  );
  return (await r.json()) as Record<string, unknown>;
}

beforeEach(() => {
  errori.length = 0; consegnati = 0; righeConsegnato = 0;
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://x.supabase.co');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role');
});
afterEach(() => { vi.unstubAllEnvs(); });

describe('il giro della coda si accorge che la posta d’ordine non nasce', () => {
  it('3 ordini consegnati e nessuna email «consegnato» in coda: errore ad alta voce', async () => {
    consegnati = 3;
    const corpo = await giro();
    expect(corpo.postaOrdini).toBe('muta');
    expect(errori.some((m) => /POSTA D'ORDINE MUTA/.test(m))).toBe(true);
  });

  it('ordini consegnati e righe in coda: tutto a posto, nessun errore', async () => {
    consegnati = 3;
    righeConsegnato = 3;
    const corpo = await giro();
    expect(corpo.postaOrdini).toBe('ok');
    expect(errori).toHaveLength(0);
  });

  it('nessun ordine consegnato: niente allarme', async () => {
    const corpo = await giro();
    expect(corpo.postaOrdini).toBe('nessun-ordine');
    expect(errori).toHaveLength(0);
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * 1/11/2026 — Il controllo della posta d'ordine (lib/email/sentinella-posta-ordini.ts) non deve
 * mai fermare il giro della coda: se il database lancia mentre conta ordini e righe, la risposta
 * resta 200 e il benvenuto in coda parte lo stesso. E 5 consegne con 1 sola riga si segnalano.
 */

const spedite: string[] = [];
const errori: string[] = [];
vi.mock('@/lib/api/middleware', () => ({ withCronAuth: (h: (req: unknown) => unknown) => (req: unknown) => h(req) }));
vi.mock('@/lib/email/client', () => ({
  sendEmail: async (m: { to: string }) => { spedite.push(m.to); return { ok: true, id: 'x' }; },
}));
vi.mock('@/lib/logger', () => ({
  logger: { info: () => {}, warn: () => {}, error: (m: string) => { errori.push(m); }, spesa: () => {} },
}));

let contiLanciano = false;
let consegnati = 0;
let righe = 0;

function finto() {
  return {
    rpc: async () => ({ data: [{ id: 'r1', user_id: 'u1', template: 'welcome', attempts: 0 }], error: null }),
    auth: { admin: { getUserById: async () => ({ data: { user: { email: 'giulia@example.it' } }, error: null }) } },
    from: (tabella: string) => ({
      select: (_c?: string, opts?: { head?: boolean }) => {
        if (opts?.head && contiLanciano) throw new Error('database caduto a meta');
        const q = {
          not: () => q, gte: () => q, lte: () => q, eq: () => q,
          in: async () => ({ data: [{ id: 'u1', full_name: 'Giulia Rossi', email_marketing: false }], error: null }),
          then: (ok: (r: unknown) => unknown) => ok({ count: tabella === 'orders' ? consegnati : righe, error: null }),
        };
        return q;
      },
      update: () => ({ eq: async () => ({ error: null }) }),
    }),
  };
}
vi.mock('@supabase/supabase-js', () => ({ createClient: () => finto() }));

async function giro() {
  vi.resetModules();
  const { POST } = await import('@/app/api/cron/send-emails/route');
  return (POST as unknown as (req: Request) => Promise<Response>)(
    new Request('http://localhost/api/cron/send-emails', { method: 'POST' }),
  );
}

beforeEach(() => {
  spedite.length = 0; errori.length = 0; contiLanciano = false; consegnati = 0; righe = 0;
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://x.supabase.co');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role');
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://mycity.example');
});
afterEach(() => { vi.unstubAllEnvs(); });

describe('la sentinella della posta non ferma il giro', () => {
  it('il database lancia dentro il controllo: risposta 200 e il benvenuto parte', async () => {
    contiLanciano = true;
    const r = await giro();
    expect(r.status).toBe(200);
    const corpo = (await r.json()) as Record<string, unknown>;
    expect(corpo.sent).toBe(1);
    expect(corpo.postaOrdini).toBe('non-letta');
    expect(spedite).toEqual(['giulia@example.it']);
  });

  it('5 ordini consegnati e 1 sola riga in coda: si segnala', async () => {
    consegnati = 5;
    righe = 1;
    const corpo = (await (await giro()).json()) as Record<string, unknown>;
    expect(corpo.postaOrdini).toBe('parziale');
    expect(errori.some((m) => /A META'/.test(m))).toBe(true);
  });
});

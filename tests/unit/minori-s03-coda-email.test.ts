import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * S03 — la coda delle email (schede 20, 1877, 2411). Impianto copiato da
 * la-coda-email-non-spedisce-quello-che-e-scaduto.test.ts, con la coda vera (email_queue) leggibile.
 */

let esitoInvio: Record<string, unknown> = { ok: true, id: 'msg-1' };
const spedite: Array<{ to: string; subject: string }> = [];

vi.mock('@/lib/api/middleware', () => ({
  withCronAuth: (h: (req: unknown) => unknown) => (req: unknown) => h(req),
}));
vi.mock('@/lib/email/client', () => ({
  sendEmail: async (m: { to: string; subject: string }) => {
    spedite.push(m);
    return esitoInvio;
  },
}));
vi.mock('@/lib/logger', () => ({ logger: { info: () => {}, warn: () => {}, error: () => {}, spesa: () => {} } }));

type RigaCoda = { id: string; user_id: string; template: string; attempts?: number; scade_at?: string | null };
let coda: RigaCoda[] = [];
let profili: Array<{ id: string; full_name?: string | null; email_marketing: boolean | null }> = [];
let erroreProfili: { message: string } | null = null;
let lettura: (id: string) => Promise<{ data: unknown; error: unknown }> = async () => ({
  data: { user: { email: 'giulia@example.it' } },
  error: null,
});
/** Le righe vere della coda, come le legge il giro quando la RPC non porta la scadenza. */
let righeCoda: Array<{ id: string; created_at: string; send_at: string; last_error: string | null }> = [];
let erroreScrittura: { message: string } | null = null;
const scritture: Array<{ tabella: string; valori: Record<string, unknown>; chiave: unknown }> = [];

function finto() {
  return {
    rpc: async (nome: string) => (nome === 'claim_pending_emails' ? { data: coda, error: null } : { data: null, error: null }),
    auth: { admin: { getUserById: (id: string) => lettura(id) } },
    from: (tabella: string) => ({
      select: () => ({
        in: async () =>
          tabella === 'profiles' && erroreProfili
            ? { data: null, error: erroreProfili }
            : { data: tabella === 'profiles' ? profili : tabella === 'email_queue' ? righeCoda : [], error: null },
      }),
      update: (valori: Record<string, unknown>) => ({
        eq: async (_colonna: string, chiave: unknown) => {
          scritture.push({ tabella, valori, chiave });
          return { error: erroreScrittura };
        },
      }),
    }),
  };
}
vi.mock('@supabase/supabase-js', () => ({ createClient: () => finto() }));

async function giroDellaPosta() {
  vi.resetModules();
  const { POST } = await import('@/app/api/cron/send-emails/route');
  return (POST as unknown as (req: Request) => Promise<Response>)(
    new Request('http://localhost/api/cron/send-emails', { method: 'POST' }),
  );
}
const scritturaDi = (id: string) => scritture.filter((s) => s.tabella === 'email_queue' && s.chiave === id);
const annullata = (id: string) => scritturaDi(id).some((s) => typeof s.valori.cancelled_at === 'string');
const rilasciata = (id: string) => scritturaDi(id).some((s) => s.valori.claimed_at === null && !('cancelled_at' in s.valori));
const GIORNO = 86_400_000;
const fa = (ms: number) => new Date(Date.now() - ms).toISOString();
const fra = (ms: number) => new Date(Date.now() + ms).toISOString();

beforeEach(() => {
  esitoInvio = { ok: true, id: 'msg-1' };
  spedite.length = 0;
  scritture.length = 0;
  coda = [];
  righeCoda = [];
  erroreScrittura = null;
  profili = [];
  erroreProfili = null;
  lettura = async () => ({ data: { user: { email: 'giulia@example.it' } }, error: null });
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://x.supabase.co');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role');
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://mycity.example');
});
afterEach(() => { vi.unstubAllEnvs(); });


describe('la coda delle email', () => {
  it('20 — senza la 165 (nessuna scade_at) una riga ferma da mesi non parte', async () => {
    profili = [{ id: 'u1', full_name: 'Giulia', email_marketing: true }];
    coda = [{ id: 'q1', user_id: 'u1', template: 'welcome' }];
    righeCoda = [{ id: 'q1', created_at: fa(120 * GIORNO), send_at: fra(10 * 60_000), last_error: 'posta non pronta' }];
    await giroDellaPosta();
    expect(spedite).toHaveLength(0);
    expect(annullata('q1')).toBe(true);
  });

  it('20 — controprova: senza scade_at ma nata ieri, parte', async () => {
    profili = [{ id: 'u1', full_name: 'Giulia', email_marketing: true }];
    coda = [{ id: 'q1', user_id: 'u1', template: 'welcome' }];
    righeCoda = [{ id: 'q1', created_at: fa(GIORNO), send_at: fa(GIORNO), last_error: null }];
    await giroDellaPosta();
    expect(spedite).toHaveLength(1);
  });

  it('20 (revisore) — il «ci manchi» dei 14 giorni rinviato una volta non si chiude: conta il suo ritardo previsto', async () => {
    profili = [{ id: 'u1', full_name: 'Giulia', email_marketing: true }];
    coda = [{ id: 'q1', user_id: 'u1', template: 'reengagement_14d' }];
    righeCoda = [{ id: 'q1', created_at: fa(15 * GIORNO), send_at: fa(10 * 60_000), last_error: 'Resend 429' }];
    await giroDellaPosta();
    expect(annullata('q1')).toBe(false);
  });

  it('1877 — se la lettura dell indirizzo LANCIA, la riga si rilascia e non si butta', async () => {
    profili = [{ id: 'u1', full_name: 'Giulia', email_marketing: true }];
    coda = [{ id: 'q1', user_id: 'u1', template: 'welcome', scade_at: fra(GIORNO) }];
    lettura = async () => { throw new Error('fetch failed'); };
    await giroDellaPosta();
    expect(spedite).toHaveLength(0);
    expect(annullata('q1')).toBe(false);
    expect(rilasciata('q1')).toBe(true);
  });

  it('2411 — il tentativo fallito che non si scrive si dice nella risposta', async () => {
    profili = [{ id: 'u1', full_name: 'Giulia', email_marketing: true }];
    coda = [{ id: 'q1', user_id: 'u1', template: 'welcome', attempts: 1, scade_at: fra(GIORNO) }];
    esitoInvio = { ok: false, error: 'Resend 500' };
    erroreScrittura = { message: 'permission denied' };
    const r = await giroDellaPosta();
    expect((await r.json()).tentativiNonScritti).toBe(1);
  });
});

/**
 * 27/10/2026 — SE SALTA SOLO IL MARKETING, LA POSTA DI SERVIZIO NON DEVE
 * RESTARE FERMA DIETRO DI LUI.
 *
 * La coda vera prende quindici righe per giro in ordine di `send_at`
 * (`claim_pending_emails`, migrazione 150). Una riga rilasciata senza toccare
 * `send_at` torna in testa al giro dopo. Se a saltare sono solo le email di
 * marketing (manca UNSUBSCRIBE_SECRET: `sendEmail` le salta, le transazionali
 * partono), quindici promo scadute occupano per sempre tutti i posti del giro e
 * il benvenuto non parte mai. Nata dal collaudo dell'ondata 3: rossa sul commit
 * 02484477 (0 email in 6 giri), verde dopo il rinvio in fondo alla coda.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EMAIL_PER_GIRO } from '@/lib/email/ritmo-della-coda';

const spedite: Array<{ tipo?: string; subject: string }> = [];
vi.mock('@/lib/api/middleware', () => ({
  withCronAuth: (h: (req: unknown) => unknown) => (req: unknown) => h(req),
}));
vi.mock('@/lib/email/client', () => ({
  sendEmail: async (m: { tipo?: string; subject: string }) => {
    if (m.tipo === 'marketing') {
      return { ok: false, skipped: true, reason: 'link di disiscrizione non firmabile: email di marketing non inviata' };
    }
    spedite.push(m);
    return { ok: true, id: 'msg' };
  },
}));
vi.mock('@/lib/logger', () => ({ logger: { info: () => {}, warn: () => {}, error: () => {}, spesa: () => {} } }));

type Riga = { id: string; user_id: string; template: string; send_at: number; claimed_at: number | null; sent_at: number | null; cancelled_at: number | null; attempts: number };
let righe: Riga[] = [];
let adesso = Date.now();

function finto() {
  return {
    rpc: async (nome: string, args: { p_max: number }) => {
      if (nome !== 'claim_pending_emails') return { data: null, error: null };
      const prese = righe
        .filter((r) => r.send_at <= adesso && r.sent_at === null && r.cancelled_at === null
          && (r.claimed_at === null || r.claimed_at < adesso - 15 * 60_000))
        .sort((a, b) => a.send_at - b.send_at)
        .slice(0, args.p_max);
      for (const r of prese) r.claimed_at = adesso;
      return { data: prese.map((r) => ({ ...r })), error: null };
    },
    auth: { admin: { getUserById: async () => ({ data: { user: { email: 'x@example.it' } }, error: null }) } },
    from: () => ({
      select: () => ({ in: async () => ({ data: [{ id: 'u1', full_name: 'Maria', email_marketing: true }], error: null }) }),
      update: (v: Record<string, unknown>) => ({
        eq: async (_c: string, id: unknown) => {
          const r = righe.find((x) => x.id === id)!;
          for (const [k, val] of Object.entries(v)) {
            (r as Record<string, unknown>)[k] = typeof val === 'string' && /^\d{4}-/.test(val) ? Date.parse(val) : val;
          }
          return { error: null };
        },
      }),
    }),
  };
}
vi.mock('@supabase/supabase-js', () => ({ createClient: () => finto() }));

beforeEach(() => {
  spedite.length = 0;
  adesso = Date.now();
  righe = [];
  for (let i = 0; i < EMAIL_PER_GIRO; i++) {
    righe.push({ id: `m${i}`, user_id: 'u1', template: 'first_order_promo', send_at: adesso - 2 * 3600_000 + i, claimed_at: null, sent_at: null, cancelled_at: null, attempts: 0 });
  }
  righe.push({ id: 'w1', user_id: 'u1', template: 'welcome', send_at: adesso - 3600_000, claimed_at: null, sent_at: null, cancelled_at: null, attempts: 0 });
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://x.supabase.co');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role');
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://mycity.example');
});
afterEach(() => { vi.unstubAllEnvs(); });

describe('collaudo: il marketing che salta non tiene ferma la posta di servizio', () => {
  it('dopo sei giri (un ora) il benvenuto transazionale e partito', async () => {
    for (let giro = 0; giro < 6; giro++) {
      vi.resetModules();
      const { POST } = await import('@/app/api/cron/send-emails/route');
      await (POST as unknown as (req: Request) => Promise<Response>)(new Request('http://x', { method: 'POST' }));
      adesso += 10 * 60_000;
    }
    expect(spedite.length, 'la posta di servizio e ferma dietro righe di marketing rilasciate in testa alla coda').toBeGreaterThan(0);
    expect(spedite.map((m) => m.tipo)).toEqual(['transazionale']);
    // Il rinvio non deve diventare una distruzione: le promo saltate restano
    // vive, senza tentativi consumati, pronte a partire quando la chiave c'e'.
    const promo = righe.filter((r) => r.template === 'first_order_promo');
    expect(promo.every((r) => r.cancelled_at === null && r.sent_at === null && r.attempts === 0),
      'una promo saltata per configurazione e stata buttata o ha consumato un tentativo').toBe(true);
    expect(promo.every((r) => r.claimed_at === null), 'una promo saltata resta prenotata').toBe(true);
  });
});

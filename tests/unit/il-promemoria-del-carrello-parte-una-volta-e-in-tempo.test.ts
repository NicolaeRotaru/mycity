import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * 31/10/2026 — IL GIRO DEI CARRELLI ABBANDONATI (app/api/cron/abandoned-carts).
 *
 * ① Nessun limite d'eta': a posta accesa partiva «hai dimenticato qualcosa»
 *    per carrelli lasciati settimane prima.
 * ② Due giri insieme spedivano due volte: la «rivendicazione» scriveva il
 *    segno anche se c'era gia' e non diceva niente (migrazione 166).
 * ③ Se la lettura dei consensi falliva, ogni carrello veniva segnato gestito
 *    per sempre senza un messaggio, e il giro rispondeva 200.
 */

const spedite: Array<{ to: string }> = [];
vi.mock('@/lib/api/middleware', () => ({
  withCronAuth: (h: (req: unknown) => unknown) => (req: unknown) => h(req),
}));
vi.mock('@/lib/email/client', () => ({
  sendEmail: async (m: { to: string }) => {
    spedite.push(m);
    return { ok: true, id: 'msg-1' };
  },
}));
vi.mock('@/lib/logger', () => ({ logger: { info: () => {}, warn: () => {}, error: () => {}, spesa: () => {} } }));
vi.mock('@/lib/carrelli-abbandonati', () => ({ potaCarrelliRecuperati: async () => 0 }));

let carrelli: Array<Record<string, unknown>> = [];
let profili: Array<{ id: string; email_marketing: boolean | null }> = [];
let erroreProfili: { message: string } | null = null;
/** Il segno nel «database»: chi l'ha gia' messo. */
const segnati = new Set<string>();
const marcature: string[] = [];

function finto() {
  return {
    rpc: async (nome: string, args: { p_user?: string }) => {
      if (nome === 'list_abandoned_carts_to_recover') return { data: carrelli, error: null };
      if (nome === 'mark_abandoned_cart_email_sent') {
        const u = String(args.p_user);
        marcature.push(u);
        // Come la 166: vero solo per chi mette il segno per primo.
        const primo = !segnati.has(u);
        segnati.add(u);
        return { data: primo, error: null };
      }
      return { data: null, error: null };
    },
    from: (tabella: string) => ({
      select: () => ({
        in: async () =>
          tabella === 'profiles' && erroreProfili ? { data: null, error: erroreProfili } : { data: profili, error: null },
      }),
      update: () => ({ eq: async () => ({ error: null }) }),
    }),
  };
}
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => finto() }));

async function giroDeiCarrelli() {
  const { POST } = await import('@/app/api/cron/abandoned-carts/route');
  return (POST as unknown as (req: Request) => Promise<Response>)(
    new Request('http://localhost/api/cron/abandoned-carts', { method: 'POST' }),
  );
}
const ORA = 3_600_000;
const carrello = (user: string, oreFa: number) => ({
  user_id: user, email: `${user}@example.it`, full_name: 'Maria', cart_data: [], cart_total: 12,
  last_activity: new Date(Date.now() - oreFa * ORA).toISOString(),
});

beforeEach(() => {
  vi.resetModules();
  spedite.length = 0;
  marcature.length = 0;
  segnati.clear();
  carrelli = [];
  profili = [];
  erroreProfili = null;
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://mycity.example');
});
afterEach(() => { vi.unstubAllEnvs(); });

describe('① un carrello di settimane fa non riceve il promemoria «4 ore»', () => {
  it('Maria ha lasciato il carrello tre settimane fa: niente email, e il carrello esce dalla lista', async () => {
    profili = [{ id: 'u1', email_marketing: true }];
    carrelli = [carrello('u1', 21 * 24)];
    await giroDeiCarrelli();
    expect(spedite, 'e partito un promemoria per un carrello di tre settimane fa').toHaveLength(0);
    expect(marcature).toContain('u1');
  });

  it('controprova: un carrello di cinque ore fa riceve il promemoria', async () => {
    profili = [{ id: 'u1', email_marketing: true }];
    carrelli = [carrello('u1', 5)];
    await giroDeiCarrelli();
    expect(spedite).toHaveLength(1);
  });
});

describe('② due giri alla stessa ora mandano un promemoria solo', () => {
  it('Vercel e cron-job.org leggono lo stesso carrello: Maria riceve una email, non due', async () => {
    profili = [{ id: 'u1', email_marketing: true }];
    carrelli = [carrello('u1', 5)];
    await Promise.all([giroDeiCarrelli(), giroDeiCarrelli()]);
    expect(spedite, 'la stessa persona ha ricevuto due volte lo stesso promemoria').toHaveLength(1);
  });
});

describe('③ un consenso non letto non chiude i carrelli', () => {
  it('lettura dei profili fallita: nessun carrello segnato, e il giro non dice «ok»', async () => {
    erroreProfili = { message: 'canceling statement due to statement timeout' };
    carrelli = [carrello('u1', 5), carrello('u2', 6)];
    const r = await giroDeiCarrelli();
    expect(marcature, 'i carrelli sono stati chiusi senza aver letto il consenso').toHaveLength(0);
    expect(r.status).not.toBe(200);
  });
});

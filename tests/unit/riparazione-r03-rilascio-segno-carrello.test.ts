import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * R03-002 — Promemoria saltato (posta non configurata): il segno si toglie solo se il carrello è
 * ancora quello letto, cioè con il filtro sull'ultima attività.
 */

vi.mock('@/lib/tempo-piacenza', async (orig) => ({ ...(await orig<object>()), oraPiacenza: () => 12 }));
vi.mock('@/lib/api/middleware', () => ({ withCronAuth: (h: (r: unknown) => unknown) => (r: unknown) => h(r) }));
const invio = vi.hoisted(() => ({ esito: { skipped: true, reason: 'posta non configurata' } as Record<string, unknown> }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => invio.esito) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), spesa: vi.fn() } }));


const stato = vi.hoisted(() => ({
  carrelli: [] as Array<Record<string, unknown>>,
  profili: [] as Array<{ id: string; email_marketing: boolean | null }>,
  scritture: [] as Array<{ valori: Record<string, unknown>; filtri: string[] }>,
}));

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    rpc: async (nome: string) => {
      if (nome === 'list_abandoned_carts_to_recover') return { data: stato.carrelli, error: null };
      return { data: true, error: null };
    },
    from: (tabella: string) => {
      const filtri: string[] = [];
      let valori: Record<string, unknown> | null = null;
      const q: Record<string, unknown> = {};
      Object.assign(q, {
        select: () => q,
        delete: () => q,
        update: (v: Record<string, unknown>) => { valori = v; return q; },
        in: async () => (tabella === 'profiles' ? { data: stato.profili, error: null } : { data: [], error: null }),
        eq: (c: string, v: unknown) => (filtri.push(`eq:${c}=${String(v)}`), q),
        is: (c: string, v: unknown) => (filtri.push(`is:${c}=${String(v)}`), q),
        lt: (c: string, v: unknown) => (filtri.push(`lt:${c}=${String(v)}`), q),
        // R18-001 — La rivendicazione del carrello (segno solo se vuoto) rende la riga presa.
        maybeSingle: async () => {
          if (tabella === 'abandoned_carts' && valori) stato.scritture.push({ valori, filtri: [...filtri] });
          return { data: { user_id: 'u1' }, error: null };
        },
        then: (ok: (x: unknown) => unknown) => {
          if (tabella === 'abandoned_carts' && valori) stato.scritture.push({ valori, filtri: [...filtri] });
          return Promise.resolve({ data: [], error: null }).then(ok);
        },
      });
      return q;
    },
  }),
}));


const ULTIMA = '2026-11-17T05:12:34.567891+00:00';

async function giro() {
  const { POST } = await import('@/app/api/cron/abandoned-carts/route');
  return (POST as unknown as (r: Request) => Promise<Response>)(new Request('http://localhost/api/cron/abandoned-carts', { method: 'POST' }));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-17T12:00:00+01:00'));
  stato.scritture = [];
  stato.carrelli = [{ user_id: 'u1', email: 'u1@example.it', full_name: 'Anna', cart_data: [], cart_total: 12, last_activity: ULTIMA }];
  stato.profili = [{ id: 'u1', email_marketing: true }];
  invio.esito = { skipped: true, reason: 'posta non configurata' };
  return () => vi.useRealTimers();
});

describe('R03-002 — il rilascio del segno non cancella il segno di un carrello cambiato', () => {
  it('invio saltato: il segno si toglie solo per il carrello con quell ultima attività', async () => {
    const res = await (await giro()).json();
    expect(res.errors).toBe(1);
    const rilascio = stato.scritture.find((s) => s.valori.recovery_email_sent_at === null);
    expect(rilascio, 'il segno non è stato tolto').toBeDefined();
    expect(rilascio?.filtri).toEqual(expect.arrayContaining(['eq:user_id=u1', `eq:last_activity=${ULTIMA}`]));
  });

  it('controprova: invio riuscito, nessun rilascio', async () => {
    invio.esito = { ok: true, id: 'm1' };
    await giro();
    expect(stato.scritture.find((s) => s.valori.recovery_email_sent_at === null)).toBeUndefined();
  });
});

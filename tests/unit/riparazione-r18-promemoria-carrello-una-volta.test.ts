import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * R18-001 — Due giri dei carrelli abbandonati partiti insieme mandano il promemoria una volta sola,
 * anche se nel database c'è ancora la funzione vecchia della rivendicazione.
 *
 * In produzione `mark_abandoned_cart_email_sent` è ancora quella della 029: scrive il segno anche
 * se c'era già e non risponde niente. Il giro prendeva la risposta vuota per «preso», quindi due
 * giri sovrapposti (Vercel e cron-job.org alla stessa ora) spedivano tutti e due. Qui il database
 * finto ha la funzione vecchia, e una tabella che rispetta la condizione della scrittura
 * (`recovery_email_sent_at is null`): chi arriva secondo non prende la riga.
 */

vi.mock('@/lib/tempo-piacenza', async (orig) => ({ ...(await orig<object>()), oraPiacenza: () => 12 }));
vi.mock('@/lib/api/middleware', () => ({ withCronAuth: (h: (r: unknown) => unknown) => (r: unknown) => h(r) }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true, id: 'm1' })) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/carrelli-abbandonati', () => ({ potaCarrelliRecuperati: async () => 0 }));

type Riga = {
  user_id: string; email: string; full_name: string; cart_data: unknown[]; cart_total: number;
  last_activity: string; recovery_email_sent_at: string | null; recovered: boolean;
};

const db = vi.hoisted(() => ({
  righe: new Map<string, Riga>(),
  profili: [] as Array<{ id: string; email_marketing: boolean }>,
}));

/** Lascia passare un giro di eventi: così i due giri si alternano come due richieste vere. */
const unAttimo = () => new Promise<void>((ok) => setImmediate(ok));

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    rpc: async (nome: string, args: { p_user?: string }) => {
      await unAttimo();
      if (nome === 'list_abandoned_carts_to_recover') {
        // La lista è una fotografia: ognuno dei due giri legge il carrello ancora senza segno.
        const lista = [...db.righe.values()]
          .filter((r) => r.recovery_email_sent_at === null && !r.recovered)
          .map(({ user_id, email, full_name, cart_data, cart_total, last_activity }) => ({ user_id, email, full_name, cart_data, cart_total, last_activity }));
        return { data: lista, error: null };
      }
      if (nome === 'mark_abandoned_cart_email_sent') {
        // La funzione della 029, quella ancora in produzione: scrive il segno sempre, risponde niente.
        const r = db.righe.get(String(args.p_user));
        if (r) r.recovery_email_sent_at = new Date().toISOString();
        return { data: null, error: null };
      }
      return { data: null, error: null };
    },
    from: (tabella: string) => {
      const filtri: Array<{ col: string; val: unknown }> = [];
      let valori: Partial<Riga> | null = null;
      /** Una UPDATE vera: tocca solo le righe che soddisfano TUTTI i filtri, e rende quelle toccate. */
      const esegui = async () => {
        await unAttimo();
        if (tabella === 'profiles') return { data: db.profili, error: null };
        if (tabella !== 'abandoned_carts' || !valori) return { data: [], error: null };
        const toccate: Riga[] = [];
        for (const r of db.righe.values()) {
          const passa = filtri.every((f) => (r as Record<string, unknown>)[f.col] === f.val);
          if (passa) { Object.assign(r, valori); toccate.push({ ...r }); }
        }
        return { data: toccate, error: null };
      };
      const q: Record<string, unknown> = {};
      Object.assign(q, {
        select: () => q,
        update: (v: Partial<Riga>) => { valori = v; return q; },
        delete: () => q,
        in: async () => esegui(),
        eq: (col: string, val: unknown) => (filtri.push({ col, val }), q),
        is: (col: string, val: unknown) => (filtri.push({ col, val }), q),
        lt: () => q,
        maybeSingle: async () => {
          const r = await esegui();
          return { data: r.data[0] ?? null, error: null };
        },
        single: async () => {
          const r = await esegui();
          return r.data.length === 1 ? { data: r.data[0], error: null } : { data: null, error: { message: '0 righe' } };
        },
        then: (ok: (x: unknown) => unknown, ko?: (e: unknown) => unknown) => esegui().then(ok, ko),
      });
      return q;
    },
  }),
}));

import { sendEmail } from '@/lib/email/client';

async function giro() {
  const { POST } = await import('@/app/api/cron/abandoned-carts/route');
  return (POST as unknown as (r: Request) => Promise<Response>)(new Request('http://localhost/api/cron/abandoned-carts', { method: 'POST' }));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-22T12:00:00+01:00'));
  vi.mocked(sendEmail).mockClear();
  db.righe.clear();
  db.righe.set('u1', {
    user_id: 'u1', email: 'maria@example.it', full_name: 'Maria', cart_data: [{ name: 'Pane', quantity: 1 }], cart_total: 12,
    last_activity: '2026-11-22T05:30:00.000000+00:00', recovery_email_sent_at: null, recovered: false,
  });
  db.profili = [{ id: 'u1', email_marketing: true }];
});
afterEach(() => { vi.useRealTimers(); });

describe('R18-001 — due giri insieme, un promemoria solo', () => {
  it('Vercel e cron-job.org partono alla stessa ora con la funzione vecchia nel database: Maria riceve una email, non due', async () => {
    const [a, b] = await Promise.all([giro(), giro()]);
    const corpi = [await a.json(), await b.json()];
    expect(vi.mocked(sendEmail), 'la stessa persona ha ricevuto due volte lo stesso promemoria').toHaveBeenCalledTimes(1);
    expect(corpi.map((c) => c.sent).sort()).toEqual([0, 1]);
    expect(db.righe.get('u1')?.recovery_email_sent_at, 'il carrello non risulta avvisato').not.toBeNull();
  });

  it('controprova: un giro da solo il promemoria lo manda, e il carrello resta segnato', async () => {
    const r = await (await giro()).json();
    expect(r.sent).toBe(1);
    expect(vi.mocked(sendEmail)).toHaveBeenCalledTimes(1);
    expect(db.righe.get('u1')?.recovery_email_sent_at).not.toBeNull();
  });
});

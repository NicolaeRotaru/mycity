import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * R14-022 — due invii uguali all'assistenza nello stesso istante creano un messaggio e un avviso.
 *
 * Il contatore finto fa quello che fa il vero (Upstash INCR): un incremento atomico per chiave.
 * Il finto database conta i messaggi e gli avvisi davvero scritti.
 */
const incrementi = new Map<string, number>();
const messaggi: Array<Record<string, unknown>> = [];
const avvisi: Array<Record<string, unknown>> = [];

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/api/middleware', () => ({
  withAuth: (h: (c: { user: { id: string }; req: Request }) => unknown) => (req: Request) => h({ user: { id: 'cliente-1' }, req }),
}));
vi.mock('@/lib/rate-limit', () => ({
  rateLimitAsync: async ({ key, max }: { key: string; max: number }) => {
    const n = (incrementi.get(key) ?? 0) + 1;
    incrementi.set(key, n);
    return { allowed: n <= max, remaining: 0, retryAfterSec: 5, limit: max };
  },
  getClientIp: () => '10.0.0.1',
}));
vi.mock('@/lib/admin/account-assistenza', () => ({ accountAssistenza: async () => ({ id: 'assistenza-1' }) }));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (t: string) => {
      if (t === 'conversations') {
        return {
          select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'conv-1' }, error: null }) }) }) }),
        };
      }
      if (t === 'messages') return { insert: async (r: Record<string, unknown>) => { messaggi.push(r); return { error: null }; } };
      if (t === 'notifications') return { insert: async (r: Record<string, unknown>) => { avvisi.push(r); return { error: null }; } };
      throw new Error(`tabella inattesa ${t}`);
    },
  }),
}));

import { POST } from '@/app/api/support/conversation/route';

function invia(testo: string, chiave?: string) {
  return POST(new Request('http://localhost/api/support/conversation', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ firstMessage: testo, ...(chiave ? { chiave } : {}) }),
  }) as never);
}

beforeEach(() => {
  incrementi.clear();
  messaggi.length = 0;
  avvisi.length = 0;
});

describe('R14-022 due invii uguali all assistenza', () => {
  it('nello stesso istante: un messaggio, un avviso, stessa risposta a tutti e due', async () => {
    const [a, b] = await Promise.all([invia('Il mio ordine non è arrivato.'), invia('Il mio ordine non è arrivato.')]);
    expect(messaggi).toHaveLength(1);
    expect(avvisi).toHaveLength(1);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(await a.json()).toEqual(await b.json());
  });

  it('con la chiave del modulo: stesso invio ripetuto = uno, due invii diversi = due', async () => {
    await Promise.all([invia('Aiuto', 'invio-aaaaaaaa'), invia('Aiuto', 'invio-aaaaaaaa')]);
    expect(messaggi).toHaveLength(1);
    await invia('Aiuto', 'invio-bbbbbbbb');
    expect(messaggi).toHaveLength(2);
    expect(avvisi).toHaveLength(2);
  });

  it('due messaggi diversi nello stesso istante passano tutti e due', async () => {
    await Promise.all([invia('Primo problema'), invia('Secondo problema')]);
    expect(messaggi).toHaveLength(2);
    expect(avvisi).toHaveLength(2);
  });
});

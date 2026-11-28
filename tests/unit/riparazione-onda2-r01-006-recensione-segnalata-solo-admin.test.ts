import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * R01-006 (onda 2) — Il collaudo dei permessi della lettura nuova GET /api/segnalazioni?recensione=<id>.
 *
 * L'onda 1 ha dato allo staff il testo, il voto e il link della recensione segnalata, letti col client
 * di servizio (che salta le regole per riga: serve, perché una recensione di un prodotto tolto dalla
 * vetrina la regola pubblica non la mostra). Qui il portiere VERO (lib/api/middleware.ts, withAdminAuth):
 * chi non è entrato riceve 401, un cliente 403, e in nessuno dei due casi si legge la recensione;
 * l'amministratore la riceve, senza chi l'ha scritta.
 */

const stato = vi.hoisted(() => ({ letture: [] as string[] }));

const PERSONE: Record<string, { id: string; role: string }> = {
  'gettone-admin': { id: 'admin-1', role: 'admin' },
  'gettone-cliente': { id: 'cliente-1', role: 'buyer' },
};
const RECENSIONE = '00000000-0000-4000-8000-0000000000a1';

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (tabella: string) => {
      const filtri: Record<string, unknown> = {};
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = (c: string, v: unknown) => { filtri[c] = v; return q; };
      q.single = async () => {
        const p = Object.values(PERSONE).find((x) => x.id === filtri.id);
        return p ? { data: { id: p.id, role: p.role, is_approved: true }, error: null } : { data: null, error: { code: 'PGRST116', message: 'no rows' } };
      };
      q.maybeSingle = async () => {
        stato.letture.push(tabella);
        if (tabella === 'reviews' && filtri.id === RECENSIONE) {
          return { data: { product_id: 'prod-1', rating: 1, comment: 'Truffa, non comprate', created_at: '2026-11-20T10:00:00Z', user_id: 'autore-1' }, error: null };
        }
        return { data: null, error: null };
      };
      return q;
    },
  }),
  getCurrentUser: async () => null,
  getServerSupabase: async () => ({}),
}));
vi.mock('@/lib/supabase/anonimo', () => ({
  creaClientAnonimo: () => ({
    auth: {
      getUser: async (g: string) => {
        const p = PERSONE[g];
        return p ? { data: { user: { id: p.id, email: `${p.id}@x.it` } }, error: null } : { data: { user: null }, error: { message: 'gettone non valido' } };
      },
    },
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), spesa: vi.fn() } }));

const { GET } = (await import('@/app/api/segnalazioni/route')) as unknown as { GET: (r: Request, c: unknown) => Promise<Response> };
const { __resetRateLimitBuckets } = await import('@/lib/rate-limit');

const chiedi = (gettone?: string) =>
  GET(
    new Request(`http://localhost/api/segnalazioni?recensione=${RECENSIONE}`, {
      headers: gettone ? { authorization: `Bearer ${gettone}` } : {},
    }),
    { params: Promise.resolve({}) },
  );

beforeEach(() => {
  stato.letture = [];
  __resetRateLimitBuckets();
});

describe('R01-006 · la recensione segnalata la legge solo lo staff', () => {
  it('chi non è entrato: 401, e la recensione non si legge', async () => {
    const r = await chiedi();
    expect(r.status).toBe(401);
    expect(stato.letture).toEqual([]);
  });

  it('un cliente: 403, e la recensione non si legge', async () => {
    const r = await chiedi('gettone-cliente');
    expect(r.status).toBe(403);
    expect(stato.letture).toEqual([]);
  });

  it('l\'amministratore: testo, voto e link, ma non chi l\'ha scritta', async () => {
    const r = await chiedi('gettone-admin');
    expect(r.status).toBe(200);
    const corpo = await r.json();
    expect(corpo.recensione).toMatchObject({ di: 'prodotto', link: '/product/prod-1', voto: 1, testo: 'Truffa, non comprate' });
    expect(JSON.stringify(corpo)).not.toContain('autore-1');
  });
});

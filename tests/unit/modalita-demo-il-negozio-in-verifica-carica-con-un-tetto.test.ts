import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 24/11/2026 (modalità demo, dal collaudo) — IL NEGOZIO IN VERIFICA CARICA DA FILE, MA CON UN TETTO.
 *
 * Chi è in attesa di approvazione prepara i prodotti e può caricarli da file, ma nessuno lo ha ancora
 * verificato: al massimo 200 prodotti finché non è approvato. Il negozio approvato non ha questo
 * limite. E la pagina degli strumenti in blocco (ai-batch), che funziona solo da approvato, resta chiusa.
 */
const stato = vi.hoisted(() => ({ approvato: false, giaCaricati: 0, scritte: 0 }));

vi.mock('@/lib/funzioni-al-lancio', async (orig) => ({ ...(await orig<Record<string, unknown>>()), CARICAMENTO_DA_FILE_ACCESO: true }));
vi.mock('@/lib/audit', () => ({ writeAudit: async () => {} }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/rate-limit', () => ({ rateLimitAsync: vi.fn(async () => ({ allowed: true, remaining: 1, retryAfterSec: 0, limit: 1 })) }));
const supaUtente = {
  from: (t: string) => {
    if (t === 'categories') return { select: async () => ({ data: [{ id: 'cat-abb', slug: 'abbigliamento', parent_id: null }], error: null }) };
    return {
      select: () => ({ eq: async () => ({ count: stato.giaCaricati, error: null }) }),
      insert: async (righe: unknown[]) => { stato.scritte += righe.length; return { error: null }; },
    };
  },
};
vi.mock('@/lib/api/middleware', () => ({
  withSellerAnchePendingRateLimit: (_o: unknown, h: (a: unknown) => unknown) => (req: unknown) =>
    h({ req, user: { id: 'negozio-1' }, profile: { role: 'seller', is_approved: stato.approvato }, supaUtente, params: {} }),
}));

const RIGA = { name: 'T-shirt cotone', description: '100% cotone biologico, taglie S-XL, lavabile a 30 gradi', price: 19.9, stock: 15, category_id: 'cat-abb', attributes: {}, status: 'draft' };

async function manda() {
  const { POST } = await import('@/app/api/seller/products/import/route');
  const res = await (POST as unknown as (r: Request) => Promise<Response>)(new Request('http://x/api/seller/products/import', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ righe: [RIGA] }),
  }));
  return res.status;
}

beforeEach(() => {
  vi.resetModules();
  stato.approvato = false;
  stato.giaCaricati = 0;
  stato.scritte = 0;
});

describe('il caricamento da file del negozio in verifica', () => {
  it('sotto il tetto carica', async () => {
    stato.giaCaricati = 10;
    expect(await manda()).toBe(200);
    expect(stato.scritte).toBe(1);
  });

  it('al tetto dei 200 prodotti si ferma, col motivo', async () => {
    stato.giaCaricati = 200;
    expect(await manda()).toBe(409);
    expect(stato.scritte).toBe(0);
  });

  it('il negozio approvato non ha il tetto', async () => {
    stato.approvato = true;
    stato.giaCaricati = 5000;
    expect(await manda()).toBe(200);
  });
});

describe('la pagina degli strumenti in blocco', () => {
  it('resta chiusa al negozio in verifica', async () => {
    const { decidiAccessoArea } = await import('@/lib/auth/decisione-portiere');
    const entra = (p: string) => decidiAccessoArea({ role: 'seller', approved: false, allowed: ['seller', 'admin'], pathname: p }).azione === 'entra';
    expect(entra('/seller/products/ai-batch')).toBe(false);
    expect(entra('/seller/products/new')).toBe(true);
  });
});

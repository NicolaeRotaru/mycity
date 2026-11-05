import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * S01 — il giro dei bonifici e i lavori a orario.
 *  · 72: una ricerca caduta (fattorini carta, fattorini contanti, contanti ai
 *    negozi) non e' «niente da pagare»: il giro risponde 500, non 200 ok:true.
 *  · 9: senza la chiave di servizio i lavori rispondono 503 «non configurato»,
 *    non un'eccezione non gestita.
 */

const stato: { cadute: Set<string>; senzaChiave: boolean } = { cadute: new Set(), senzaChiave: false };

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/stripe/client', () => ({ isStripeConfigured: () => true, getStripe: () => ({}) }));
vi.mock('@/lib/stripe/payout', async (originale) => {
  const vero = await originale<typeof import('@/lib/stripe/payout')>();
  return { ...vero, releaseOrderPayout: vi.fn(), releaseRiderPayout: vi.fn() };
});

/** Riconosce la ricerca dai filtri che riceve. */
function builder() {
  const f: string[] = [];
  const b: Record<string, unknown> = {};
  for (const m of ['select', 'update', 'eq', 'in', 'is', 'not', 'or', 'lte', 'lt', 'gte', 'limit']) {
    b[m] = (...a: unknown[]) => (f.push(`${m}:${a.map(String).join(',')}`), b);
  }
  b.then = (resolve: (x: unknown) => unknown) => {
    const testo = f.join('|');
    let nome = '';
    if (testo.includes('not:rider_id') && testo.includes('eq:payment_method,card')) nome = 'rider_carta';
    else if (testo.includes('in:rider_payout_status')) nome = 'rider_contanti';
    else if (testo.includes('eq:payment_method,cod') && testo.includes('eq:payout_status,HELD')) nome = 'contanti';
    if (nome && stato.cadute.has(nome)) return resolve({ data: null, error: { message: 'giu' } });
    return resolve({ data: [], error: null });
  };
  return b;
}

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => {
    if (stato.senzaChiave) throw new Error('Service role Supabase non configurato (SUPABASE_SERVICE_ROLE_KEY).');
    return { from: () => builder() };
  },
}));

function richiesta() {
  return new Request('http://x/api/cron/release-payouts', {
    method: 'POST',
    headers: { authorization: 'Bearer segreto-di-prova' },
  });
}

async function giro() {
  const { POST } = await import('@/app/api/cron/release-payouts/route');
  return (POST as unknown as (r: Request) => Promise<Response>)(richiesta());
}

beforeEach(() => {
  stato.cadute = new Set();
  stato.senzaChiave = false;
  vi.stubEnv('CRON_SECRET', 'segreto-di-prova');
  vi.stubEnv('LAVORI_A_ORARIO', 'accesi');
  vi.stubEnv('PAGAMENTI_CONTANTI_DA_STRIPE_DAL', '2026-01-01');
});
afterEach(() => vi.unstubAllEnvs());

describe('il giro dei bonifici non dice «tutto a posto» se una ricerca cade', () => {
  it('senza errori risponde 200 ok:true', async () => {
    const r = await giro();
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true });
  });
  for (const nome of ['rider_carta', 'rider_contanti', 'contanti']) {
    it(`ricerca «${nome}» caduta → 500 ok:false`, async () => {
      stato.cadute.add(nome);
      const r = await giro();
      expect(r.status).toBe(500);
      expect(await r.json()).toMatchObject({ ok: false });
    });
  }
});

describe('i lavori a orario senza chiave di servizio dicono cosa manca', () => {
  it('release-payouts risponde 503 con il messaggio della chiave', async () => {
    stato.senzaChiave = true;
    const r = await giro();
    expect(r.status).toBe(503);
    expect(JSON.stringify(await r.json())).toContain('SUPABASE_SERVICE_ROLE_KEY');
  });
  it('riquadra-casse risponde 503', async () => {
    stato.senzaChiave = true;
    const { POST } = await import('@/app/api/cron/riquadra-casse/route');
    const r = await (POST as unknown as (r: Request) => Promise<Response>)(richiesta());
    expect(r.status).toBe(503);
  });
});

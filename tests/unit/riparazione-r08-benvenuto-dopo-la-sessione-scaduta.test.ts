import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * R08-002 — il webhook della sessione scaduta (`checkout.session.expired`)
 * restituiva il codice di benvenuto (`release_coupon`) ma lasciava aperta la
 * rivendicazione del cliente (`coupon_redemptions`). Quando il webhook arriva
 * prima della pulizia della cassa che ha appena chiuso la pagina su Stripe, la
 * cassa non trova più il carrello fra quelli da liberare e il benvenuto resta
 * bloccato fino a due minuti. Qui il finto database applica davvero i filtri.
 * Niente Stripe vero: l'evento è un oggetto scritto a mano.
 */
type Riga = Record<string, unknown>;
const tab: Record<string, Riga[]> = {};
const rpc: Array<{ nome: string; args: Riga }> = [];
let erroreRpc: Record<string, string> = {};

function from(t: string) {
  const righe = (tab[t] ??= []);
  const filtri: Array<(r: Riga) => boolean> = [];
  let valori: Riga | null = null;
  const q: Record<string, unknown> = {};
  Object.assign(q, {
    select: () => q, limit: () => q,
    eq: (c: string, v: unknown) => (filtri.push((r) => r[c] === v), q),
    is: (c: string, v: unknown) => (filtri.push((r) => (r[c] ?? null) === v), q),
    update: (v: Riga) => ((valori = v), q),
    then: (ok: (x: unknown) => unknown) => {
      const prese = righe.filter((r) => filtri.every((f) => f(r)));
      if (valori) for (const r of prese) Object.assign(r, valori);
      return Promise.resolve({ data: prese.map((r) => ({ ...r })), error: null }).then(ok);
    },
  });
  return q;
}
const client = {
  from,
  rpc: async (nome: string, args: Riga) => {
    rpc.push({ nome, args });
    return erroreRpc[nome] ? { data: null, error: { message: erroreRpc[nome] } } : { data: true, error: null };
  },
};
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => client }));
vi.mock('@/lib/stripe/webhook/comune', () => ({ notifyAdmins: vi.fn(async () => {}) }));

const carrello = (o: Riga = {}): Riga => ({
  id: 'pc_1', status: 'PENDING', coupon_code: 'BENVENUTO5',
  groups: [{ items: [{ productId: 'p1', quantity: 1, variantId: null }] }],
  delivery: { full_name: 'Maria', rivendicazione: 'riv_mia' }, ...o,
});
const rivendicazione = (id: string, o: Riga = {}): Riga => ({ id, coupon_id: 'c1', user_id: 'u1', released_at: null, ...o });

async function sessioneScaduta() {
  const { handleCheckoutExpired } = await import('@/lib/stripe/webhook/carrello-scaduto');
  await handleCheckoutExpired({ id: 'cs_1', client_reference_id: 'pc_1', metadata: {} } as never);
}
const aperta = (id: string) => tab.coupon_redemptions.find((r) => r.id === id)!.released_at === null;

beforeEach(() => {
  for (const k of Object.keys(tab)) delete tab[k];
  rpc.length = 0; erroreRpc = {};
  tab.orders = [];
});

describe('R08-002 — la sessione scaduta chiude anche la rivendicazione del benvenuto', () => {
  it('restituito il codice, la rivendicazione di questo tentativo è chiusa: il benvenuto si riusa subito', async () => {
    tab.pending_checkouts = [carrello()];
    tab.coupon_redemptions = [rivendicazione('riv_mia'), rivendicazione('riv_altra_scheda')];
    await sessioneScaduta();
    expect(rpc.map((c) => c.nome)).toContain('release_coupon');
    expect(aperta('riv_mia'), 'il codice è tornato ma la rivendicazione resta aperta: «Coupon non disponibile» per due minuti').toBe(false);
    expect(aperta('riv_altra_scheda'), 'si chiude solo la rivendicazione di questo carrello').toBe(true);
  });

  it('una rivendicazione già chiusa non si riscrive', async () => {
    tab.pending_checkouts = [carrello()];
    tab.coupon_redemptions = [rivendicazione('riv_mia', { released_at: '2026-11-26T10:00:00.000Z' })];
    await sessioneScaduta();
    expect(tab.coupon_redemptions[0].released_at).toBe('2026-11-26T10:00:00.000Z');
  });

  it('se il codice non è tornato, la rivendicazione resta aperta (come nella cassa)', async () => {
    tab.pending_checkouts = [carrello()];
    tab.coupon_redemptions = [rivendicazione('riv_mia')];
    erroreRpc = { release_coupon: 'timeout' };
    await sessioneScaduta();
    expect(aperta('riv_mia')).toBe(true);
  });

  it('se il carrello l’aveva già preso la pulizia, il webhook non tocca niente', async () => {
    tab.pending_checkouts = [carrello({ status: 'EXPIRED' })];
    tab.coupon_redemptions = [rivendicazione('riv_mia')];
    await sessioneScaduta();
    expect(rpc).toEqual([]);
    expect(aperta('riv_mia')).toBe(true);
  });
});

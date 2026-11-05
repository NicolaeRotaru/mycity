import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * S03 — il giro dei carrelli scaduti e il suo gemello nel webhook (schede 1522, 10, 45, 484).
 * Il finto database applica davvero i filtri: togliere `.lt('expires_at')` o `.eq('status','PENDING')`
 * fa cambiare quello che il giro tocca.
 */
type Riga = Record<string, unknown>;
const tab: Record<string, Riga[]> = {};
const rpc: Array<{ nome: string; args: Riga }> = [];
let erroreRpc: Record<string, string> = {};
const avvisiAdmin: string[] = [];

function from(t: string) {
  const righe = (tab[t] ??= []);
  const filtri: Array<(r: Riga) => boolean> = [];
  let valori: Riga | null = null;
  let upsert: Riga[] | null = null;
  const q: Record<string, unknown> = {};
  Object.assign(q, {
    select: () => q, limit: () => q, order: () => q, maybeSingle: () => q,
    eq: (c: string, v: unknown) => (filtri.push((r) => r[c] === v), q),
    in: (c: string, vs: unknown[]) => (filtri.push((r) => vs.includes(r[c])), q),
    lt: (c: string, v: unknown) => (filtri.push((r) => String(r[c]) < String(v)), q),
    gte: (c: string, v: unknown) => (filtri.push((r) => String(r[c]) >= String(v)), q),
    update: (v: Riga) => ((valori = v), q),
    insert: (v: Riga | Riga[]) => (righe.push(...(Array.isArray(v) ? v : [v])), Promise.resolve({ error: null })),
    upsert: (v: Riga | Riga[]) => ((upsert = Array.isArray(v) ? v : [v]), q),
    then: (ok: (x: unknown) => unknown) => {
      if (upsert) {
        for (const u of upsert) {
          const i = righe.findIndex((r) => r.alert_key === u.alert_key);
          if (i >= 0) righe[i] = u; else righe.push(u);
        }
        return Promise.resolve({ data: null, error: null }).then(ok);
      }
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
    return erroreRpc[nome] ? { data: null, error: { message: erroreRpc[nome] } } : { data: null, error: null };
  },
};
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => client }));
vi.mock('@/lib/api/middleware', () => ({ withCronAuth: (h: (r: unknown) => unknown) => (r: unknown) => h(r) }));
vi.mock('@/lib/stripe/webhook/comune', () => ({
  notifyAdmins: vi.fn(async (titolo: string, testo: string) => { avvisiAdmin.push(`${titolo} ${testo}`); }),
}));

const passato = '2020-01-01T00:00:00Z';
const futuro = '2999-01-01T00:00:00Z';
const carrello = (id: string, o: Riga = {}) => ({
  id, status: 'PENDING', expires_at: passato, coupon_code: null, stripe_session_id: null,
  groups: [{ items: [{ productId: `p-${id}`, quantity: 1, variantId: null }] }], ...o,
});
async function giro() {
  const { POST } = await import('@/app/api/cron/expire-checkouts/route');
  return (POST as unknown as (r: Request) => Promise<Response>)(new Request('http://x', { method: 'POST' }));
}

beforeEach(() => {
  for (const k of Object.keys(tab)) delete tab[k];
  rpc.length = 0; avvisiAdmin.length = 0; erroreRpc = {};
});

describe('giro dei carrelli scaduti', () => {
  it('484a — rimette in vendita solo i carrelli davvero scaduti', async () => {
    tab.pending_checkouts = [carrello('vecchio'), carrello('vivo', { expires_at: futuro })];
    await giro();
    expect(tab.pending_checkouts.find((r) => r.id === 'vivo')!.status).toBe('PENDING');
    expect(rpc.filter((c) => c.nome === 'restore_stock').map((c) => (c.args.p_items as Riga[])[0].product_id)).toEqual(['p-vecchio']);
  });

  it('484b — un carrello passato COMPLETED fra la lettura e la scrittura non torna a scaffale', async () => {
    tab.pending_checkouts = [carrello('pagato')];
    // Il pagamento arriva fra la lettura e la scrittura: la rivendicazione deve chiedere PENDING.
    const originale = client.from;
    client.from = ((t: string) => {
      const q = originale(t) as Record<string, (...a: unknown[]) => unknown>;
      if (t === 'pending_checkouts') {
        const update = q.update;
        q.update = (v: unknown) => {
          tab.pending_checkouts[0].status = 'COMPLETED';
          return update(v);
        };
      }
      return q;
    }) as typeof from;
    await giro();
    client.from = originale;
    expect(tab.pending_checkouts[0].status).toBe('COMPLETED');
    expect(rpc).toEqual([]);
  });

  it('484c — il webhook su un carrello già EXPIRED non rimette niente a scaffale', async () => {
    tab.pending_checkouts = [carrello('pc_1', { status: 'EXPIRED' })];
    const { handleCheckoutExpired } = await import('@/lib/stripe/webhook/carrello-scaduto');
    await handleCheckoutExpired({ id: 'cs_1', client_reference_id: 'pc_1', metadata: {} } as never);
    expect(rpc).toEqual([]);
  });

  it('45 — la merce che non torna in vendita arriva agli amministratori', async () => {
    tab.pending_checkouts = [carrello('pc_1')];
    erroreRpc = { restore_stock: 'timeout' };
    await giro();
    expect(avvisiAdmin.some((a) => /Merce non rimessa in vendita.*pc_1/.test(a))).toBe(true);
  });

  it('1522 — senza amministratori il giro non resta rosso per sempre', async () => {
    tab.pending_checkouts = [carrello('pc_1', { stripe_session_id: 'cs_1' })];
    tab.orders = [{ id: 'o1', stripe_session_id: 'cs_1' }];
    tab.profiles = [];
    const r = await giro();
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ avvisoSenzaDestinatario: true });
  });

  it('10 — lo stesso carrello pagato a metà avvisa una volta, non ogni mezz ora', async () => {
    tab.pending_checkouts = [carrello('pc_1', { stripe_session_id: 'cs_1' })];
    tab.orders = [{ id: 'o1', stripe_session_id: 'cs_1' }];
    tab.profiles = [{ id: 'a1', role: 'admin' }];
    await giro();
    await giro();
    await giro();
    expect((tab.notifications ?? []).filter((n) => n.user_id === 'a1')).toHaveLength(1);
  });
});

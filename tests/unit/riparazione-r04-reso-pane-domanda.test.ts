/**
 * R04-001 (27/11/2026) — LA DOMANDA DELLA PAGINA DEL RESO: «HO CAMBIATO IDEA» SI PUÒ OFFRIRE?
 *
 * La pagina la faceva a /api/returns/ripensamento, che guardava solo la spunta del negozio: su un
 * pane del Panificio mai spuntato rispondeva «nessun rifiuto», la pagina offriva il motivo e
 * l'invio lo rifiutava. Ora la domanda va a /api/returns/create, alla stessa funzione che decide
 * l'invio, anche per la sola riga scelta.
 *
 * La rotta e' quella vera; la banca dati e' finta e risponde secondo i filtri.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

type Riga = Record<string, unknown>;

const db = vi.hoisted(() => ({
  tabelle: {} as Record<string, Array<Record<string, unknown>>>,
  errori: {} as Record<string, unknown>,
}));

vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit: (_o: unknown, handler: (ctx: { user: { id: string }; req: Request }) => unknown) =>
    (req: Request) => handler({ user: { id: 'cliente-1' }, req }),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: () => undefined, warn: () => undefined, info: () => undefined } }));

function tavola(nome: string) {
  const filtri: Array<(r: Riga) => boolean> = [];
  const righe = () => (db.tabelle[nome] ?? []).filter((r) => filtri.every((f) => f(r)));
  const c: Record<string, unknown> = {
    select: () => c,
    eq: (k: string, v: unknown) => (filtri.push((r) => r[k] === v), c),
    in: (k: string, vs: unknown[]) => (filtri.push((r) => vs.includes(r[k])), c),
    maybeSingle: async () => ({ data: righe()[0] ?? null, error: null }),
    then: (ok: (r: unknown) => unknown, ko?: (e: unknown) => unknown) =>
      Promise.resolve(db.errori[nome] ? { data: null, error: db.errori[nome] } : { data: righe(), error: null }).then(ok, ko),
  };
  return c;
}

vi.mock('@/lib/supabase/server', () => ({
  getServerSupabase: async () => ({ from: (t: string) => tavola(t) }),
  getAdminSupabase: () => ({ from: (t: string) => tavola(t) }),
}));

import * as rotta from '@/app/api/returns/create/route';

const ORDINE = '11111111-1111-4111-8111-111111111111';
const RIGA_PANE = '22222222-2222-4222-8222-222222222222';
const RIGA_MIELE = '33333333-3333-4333-8333-333333333333';

async function chiedi(q: Record<string, string>): Promise<{ status: number; corpo: { rifiuto?: string | null } }> {
  const res = await (rotta.GET as unknown as (r: Request) => Promise<Response>)(
    new Request(`http://localhost/api/returns/create?${new URLSearchParams(q).toString()}`),
  );
  return { status: res.status, corpo: (await res.json()) as { rifiuto?: string | null } };
}

beforeEach(() => {
  db.errori = {};
  db.tabelle = {
    orders: [{ id: ORDINE, user_id: 'cliente-1' }],
    order_items: [
      { id: RIGA_PANE, order_id: ORDINE, product_id: 'pane', product_name: 'Pane casereccio' },
      { id: RIGA_MIELE, order_id: ORDINE, product_id: 'miele', product_name: 'Miele di acacia' },
    ],
    products: [
      { id: 'pane', name: 'Pane casereccio', non_recedibile: false, category_id: 'cat-panificio' },
      { id: 'miele', name: 'Miele di acacia', non_recedibile: false, category_id: 'cat-dispensa' },
    ],
    categories: [
      { id: 'cat-alimentari', slug: 'alimentari', parent_id: null },
      { id: 'cat-panificio', slug: 'panificio', parent_id: 'cat-alimentari' },
      { id: 'cat-dispensa', slug: 'alimentari-dispensa', parent_id: 'cat-alimentari' },
    ],
  };
});

describe('R04-001 · la pagina chiede alla rotta che decide se offrire «Ho cambiato idea»', () => {
  it('la riga del pane non spuntato: rifiuto, con il perche\'', async () => {
    const r = await chiedi({ orderId: ORDINE, orderItemId: RIGA_PANE });
    expect(r.status).toBe(200);
    expect(r.corpo.rifiuto).toMatch(/Pane casereccio.*escluso dal recesso/);
  });

  it('un ordine di solo pane, chiesto per tutto l\'ordine: rifiuto', async () => {
    db.tabelle.order_items = db.tabelle.order_items.slice(0, 1);
    expect((await chiedi({ orderId: ORDINE })).corpo.rifiuto).toMatch(/escluso dal recesso/);
  });

  it('la riga del miele, e tutto l\'ordine misto: nessun rifiuto', async () => {
    expect((await chiedi({ orderId: ORDINE, orderItemId: RIGA_MIELE })).corpo.rifiuto).toBeNull();
    expect((await chiedi({ orderId: ORDINE })).corpo.rifiuto).toBeNull();
  });

  it('l\'ordine di un altro: 403, nessun nome di prodotto', async () => {
    db.tabelle.orders = [{ id: ORDINE, user_id: 'altro-cliente' }];
    const r = await chiedi({ orderId: ORDINE, orderItemId: RIGA_PANE });
    expect(r.status).toBe(403);
    expect(JSON.stringify(r.corpo)).not.toMatch(/Pane/);
  });

  it('ordine o riga non validi: 400', async () => {
    expect((await chiedi({ orderId: 'abc' })).status).toBe(400);
    expect((await chiedi({ orderId: ORDINE, orderItemId: 'xyz' })).status).toBe(400);
  });

  it('se le categorie non si leggono non risponde «nessun rifiuto» al buio', async () => {
    db.errori.categories = { code: '08006', message: 'connessione caduta' };
    expect((await chiedi({ orderId: ORDINE, orderItemId: RIGA_PANE })).status).toBe(500);
  });
});

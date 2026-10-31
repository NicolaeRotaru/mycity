/**
 * 31/10/2026 (sesta ondata del sito) — SUI FRESCHI «CAMBIO IDEA» NON DIVENTA UN RESO.
 *
 * L'art. 59 lett. c-d del Codice del Consumo esclude dal recesso i beni che si
 * deteriorano in fretta e quelli fatti su ordinazione. La rotta dei resi
 * accettava «Cambio idea» su qualunque riga: una cliente comprava una torta da
 * Pane Quotidiano, il giorno dopo chiedeva il reso per ripensamento, e la
 * richiesta nasceva. Ora il prodotto segnato dal negozio (`non_recedibile`,
 * migrazione 180) si rifiuta con un messaggio chiaro; difetto e articolo
 * sbagliato restano sempre ammessi.
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
    limit: () => c,
    order: () => c,
    single: async () => ({ data: righe()[0] ?? null, error: righe()[0] ? null : { message: 'nessuna riga' } }),
    maybeSingle: async () => ({ data: righe()[0] ?? null, error: null }),
    insert: (v: Riga) => {
      const riga = { id: `ret-${(db.tabelle[nome] ?? []).length + 1}`, ...v };
      (db.tabelle[nome] ??= []).push(riga);
      const fatto = { data: { id: riga.id }, error: null };
      return { select: () => ({ single: async () => fatto }), then: (ok: (r: unknown) => unknown) => Promise.resolve(fatto).then(ok) };
    },
    then: (ok: (r: unknown) => unknown, ko?: (e: unknown) => unknown) =>
      Promise.resolve(db.errori[nome] ? { data: null, error: db.errori[nome] } : { data: righe(), error: null }).then(ok, ko),
  };
  return c;
}

vi.mock('@/lib/supabase/server', () => ({
  getServerSupabase: async () => ({ from: (t: string) => tavola(t) }),
  getAdminSupabase: () => ({ from: (t: string) => tavola(t) }),
}));

import { POST } from '@/app/api/returns/create/route';

const ORDINE = '11111111-1111-4111-8111-111111111111';
const RIGA_TORTA = '22222222-2222-4222-8222-222222222222';
const RIGA_MIELE = '33333333-3333-4333-8333-333333333333';

function richiesta(corpo: Riga): never {
  return new Request('http://localhost/api/returns/create', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(corpo),
  }) as never;
}

beforeEach(() => {
  db.errori = {};
  db.tabelle = {
    orders: [{
      id: ORDINE, user_id: 'cliente-1', seller_id: 'pane-quotidiano', delivery_status: 'DELIVERED',
      delivered_at: new Date(Date.now() - 24 * 3600_000).toISOString(), total_price: 31, created_at: new Date().toISOString(),
    }],
    order_items: [
      { id: RIGA_TORTA, order_id: ORDINE, product_id: 'torta' },
      { id: RIGA_MIELE, order_id: ORDINE, product_id: 'miele' },
    ],
    products: [
      { id: 'torta', name: 'Torta di compleanno', non_recedibile: true },
      { id: 'miele', name: 'Miele di acacia', non_recedibile: false },
    ],
    returns: [],
    notifications: [],
  };
});

async function errore(res: Response): Promise<string> {
  const j = (await res.json()) as { error?: { message?: string } | string; message?: string };
  return typeof j.error === 'string' ? j.error : (j.error?.message ?? j.message ?? '');
}

describe('reso per «Cambio idea» su un prodotto escluso dal recesso', () => {
  it('IL CASO CHE ROMPEVA — la torta del forno per ripensamento: rifiutata, e nessun reso nasce', async () => {
    const res = await POST(richiesta({ orderId: ORDINE, orderItemId: RIGA_TORTA, reason: 'CHANGED_MIND' }));
    expect(res.status).toBe(400);
    expect(await errore(res)).toMatch(/Torta di compleanno.*escluso dal recesso/);
    expect(db.tabelle.returns, 'il reso per ripensamento sulla torta e\' nato').toHaveLength(0);
  });

  it('IL CASO CHE ROMPEVA — tutto l\'ordine per ripensamento, con dentro la torta: rifiutato', async () => {
    const res = await POST(richiesta({ orderId: ORDINE, reason: 'CHANGED_MIND' }));
    expect(res.status).toBe(400);
    expect(db.tabelle.returns).toHaveLength(0);
  });

  it('se i prodotti non si leggono non si decide al buio: errore, nessun reso', async () => {
    db.errori.products = { code: '08006', message: 'connessione caduta' };
    const res = await POST(richiesta({ orderId: ORDINE, orderItemId: RIGA_TORTA, reason: 'CHANGED_MIND' }));
    expect(res.status).toBe(500);
    expect(db.tabelle.returns).toHaveLength(0);
  });

  it('controprova: la torta arrivata rovinata si rende sempre (garanzia)', async () => {
    const res = await POST(richiesta({ orderId: ORDINE, orderItemId: RIGA_TORTA, reason: 'DAMAGED' }));
    expect(res.status).toBe(201);
    expect(db.tabelle.returns).toHaveLength(1);
  });

  it('controprova: il miele per ripensamento si rende', async () => {
    const res = await POST(richiesta({ orderId: ORDINE, orderItemId: RIGA_MIELE, reason: 'CHANGED_MIND' }));
    expect(res.status).toBe(201);
    expect(db.tabelle.returns).toHaveLength(1);
  });

  it('controprova: prima della migrazione 180 (riga senza la colonna) il ripensamento resta possibile', async () => {
    db.tabelle.products = [{ id: 'torta', name: 'Torta di compleanno' }, { id: 'miele', name: 'Miele di acacia' }];
    const res = await POST(richiesta({ orderId: ORDINE, orderItemId: RIGA_TORTA, reason: 'CHANGED_MIND' }));
    expect(res.status).toBe(201);
  });
});

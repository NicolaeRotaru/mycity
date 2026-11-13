/**
 * R13-004 — Il negozio poteva togliere il diritto di ripensamento a qualunque prodotto, anche a
 * un maglione, e il sito rifiutava il reso dicendo al cliente che era la legge.
 *
 * Si guarda il comportamento dalle porte che c'erano già:
 *  ① la rotta dei resi (POST /api/returns/create, quella vera, banca dati finta): un maglione
 *    segnato «escluso» non ferma il ripensamento; la torta sotto gli alimentari sì, e la frase dice
 *    che lo indica il negozio, non che «è fresco»;
 *  ② la porta unica del salvataggio (`salvaProdottoTracciato`): la spunta accesa su un prodotto non
 *    alimentare non si scrive;
 *  ③ le frasi pubbliche (scheda prodotto, Termini).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

type Riga = Record<string, unknown>;

const db = vi.hoisted(() => ({ tabelle: {} as Record<string, Array<Record<string, unknown>>> }));

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
      Promise.resolve({ data: righe(), error: null }).then(ok, ko),
  };
  return c;
}

vi.mock('@/lib/supabase/server', () => ({
  getServerSupabase: async () => ({ from: (t: string) => tavola(t) }),
  getAdminSupabase: () => ({ from: (t: string) => tavola(t) }),
}));

import { POST } from '@/app/api/returns/create/route';
import { salvaProdottoTracciato, DaCompletare, type ClientDelCatalogo } from '@/lib/products/salvataggio-tracciato';
import { fraseResoDelProdotto } from '@/lib/promesse-pubbliche';

const ORDINE = '11111111-1111-4111-8111-111111111111';
const RIGA = '22222222-2222-4222-8222-222222222222';

const CATEGORIE = [
  { id: 'alimentari', slug: 'alimentari', name: 'Alimentari', parent_id: null },
  { id: 'dolci', slug: 'dolci', name: 'Dolci', parent_id: 'alimentari' },
  { id: 'abbigliamento', slug: 'abbigliamento', name: 'Abbigliamento', parent_id: null },
];

function richiesta(corpo: Riga): never {
  return new Request('http://localhost/api/returns/create', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(corpo),
  }) as never;
}

async function errore(res: Response): Promise<string> {
  const j = (await res.json()) as { error?: { message?: string } | string; message?: string };
  return typeof j.error === 'string' ? j.error : (j.error?.message ?? j.message ?? '');
}

function ordineCon(prodotto: Riga) {
  db.tabelle = {
    orders: [{
      id: ORDINE, user_id: 'cliente-1', seller_id: 'merceria', delivery_status: 'DELIVERED',
      delivered_at: '2026-11-10T10:00:00+01:00', total_price: 60, created_at: '2026-11-09T10:00:00+01:00',
    }],
    order_items: [{ id: RIGA, order_id: ORDINE, product_id: prodotto.id }],
    products: [prodotto],
    categories: CATEGORIE,
    returns: [],
    notifications: [],
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-12T18:00:00+01:00')); // giovedì: due giorni dopo la consegna
});
afterEach(() => {
  vi.useRealTimers();
});

describe('R13-004 ① la rotta dei resi', () => {
  it('IL CASO CHE ROMPEVA — il maglione segnato «escluso» non toglie il ripensamento', async () => {
    ordineCon({ id: 'maglione', name: 'Maglione di lana', non_recedibile: true, category_id: 'abbigliamento' });
    const res = await POST(richiesta({ orderId: ORDINE, orderItemId: RIGA, reason: 'CHANGED_MIND' }));
    expect(res.status, await res.clone().text()).toBe(201);
    expect(db.tabelle.returns).toHaveLength(1);
  });

  it('la torta sotto gli alimentari resta esclusa, e la frase dice che lo indica il negozio', async () => {
    ordineCon({ id: 'torta', name: 'Torta di compleanno', non_recedibile: true, category_id: 'dolci' });
    const res = await POST(richiesta({ orderId: ORDINE, orderItemId: RIGA, reason: 'CHANGED_MIND' }));
    expect(res.status).toBe(400);
    const testo = await errore(res);
    expect(testo).toMatch(/Torta di compleanno.*escluso dal recesso/);
    expect(testo).toMatch(/il negozio lo indica/);
    expect(testo).not.toMatch(/è fresco/);
    expect(db.tabelle.returns).toHaveLength(0);
  });

  it('un prodotto senza categoria non resta escluso', async () => {
    ordineCon({ id: 'cosa', name: 'Oggetto', non_recedibile: true, category_id: null });
    const res = await POST(richiesta({ orderId: ORDINE, orderItemId: RIGA, reason: 'CHANGED_MIND' }));
    expect(res.status).toBe(201);
  });
});

function catalogo(prodotto: Riga) {
  const scritture: Riga[] = [];
  const client = {
    from: (tabella: string) => {
      const c: Record<string, unknown> = {};
      const fatto = (data: unknown) => ({ data, error: null });
      c.select = () => c;
      c.eq = () => c;
      c.in = () => c;
      c.maybeSingle = async () => fatto(prodotto);
      c.update = (v: Riga) => {
        scritture.push(v);
        const w: Record<string, unknown> = {};
        w.eq = () => w;
        w.then = (ok: (r: unknown) => unknown) => Promise.resolve(fatto(null)).then(ok);
        return w;
      };
      c.then = (ok: (r: unknown) => unknown) =>
        Promise.resolve(fatto(tabella === 'categories' ? CATEGORIE : [])).then(ok);
      return c;
    },
  } as unknown as ClientDelCatalogo;
  return { client, scritture };
}

describe('R13-004 ② la porta unica del salvataggio', () => {
  const salva = (prodotto: Riga, payload: Riga) => {
    const cat = catalogo({ id: 'p-1', seller_id: 'negozio-1', status: 'draft', ...prodotto });
    const esito = salvaProdottoTracciato({
      db: cat.client, prodottoId: 'p-1', attoreId: 'negozio-1', payload, origine: 'modulo', scriviTraccia: () => undefined,
    });
    return { esito, scritture: cat.scritture };
  };

  it('IL CASO CHE ROMPEVA — la spunta accesa su un maglione non si scrive', async () => {
    const { esito, scritture } = salva({ name: 'Maglione', category_id: 'abbigliamento' }, { non_recedibile: true });
    await expect(esito).rejects.toBeInstanceOf(DaCompletare);
    await expect(esito).rejects.toThrow(/solo per gli alimenti/);
    expect(scritture).toEqual([]);
  });

  it('nemmeno spostando il prodotto fra i vestiti nello stesso salvataggio', async () => {
    const { esito, scritture } = salva({ name: 'Torta', category_id: 'dolci' }, { non_recedibile: true, category_id: 'abbigliamento' });
    await expect(esito).rejects.toBeInstanceOf(DaCompletare);
    expect(scritture).toEqual([]);
  });

  it('sulla torta sotto gli alimentari si scrive come prima, e togliere la spunta passa sempre', async () => {
    const torta = salva({ name: 'Torta', category_id: 'dolci' }, { non_recedibile: true });
    await expect(torta.esito).resolves.toBeTruthy();
    expect(torta.scritture).toEqual([{ non_recedibile: true }]);
    const maglione = salva({ name: 'Maglione', category_id: 'abbigliamento' }, { non_recedibile: false });
    await expect(maglione.esito).resolves.toBeTruthy();
    expect(maglione.scritture).toEqual([{ non_recedibile: false }]);
  });
});

describe('R13-004 ③ le frasi pubbliche', () => {
  it('la scheda del prodotto escluso dice che lo indica il negozio', () => {
    const frase = fraseResoDelProdotto({ non_recedibile: true });
    expect(frase).toMatch(/escluso dal recesso/i);
    expect(frase).toMatch(/il negozio lo indica/);
  });

  it('i Termini dicono che l\'esclusione vale solo se la scheda la dice', () => {
    const termini = readFileSync('app/terms/page.tsx', 'utf8').replace(/\s+/g, ' ');
    expect(termini).toContain('prodotti che si deteriorano rapidamente');
    expect(termini).toContain('è escluso solo se la sua scheda lo dice prima dell&apos;acquisto');
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * R03-001 — Taglie alla stessa posizione: la traccia non segna un riordino che non c'è.
 * Le righe riscritte prendono id nuovi; a parità di posizione l'ordine non deve dipendere dall'id.
 */

type Riga = Record<string, unknown>;
const db = vi.hoisted(() => ({
  prodotti: [] as Riga[],
  taglie: [] as Riga[],
  audit: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/lib/api/middleware', () => ({
  withAdminAuth:
    (fn: (a: { user: { id: string }; req: Request }) => unknown) =>
    (req: Request) =>
      fn({ user: { id: 'admin-1' }, req }),
}));
vi.mock('@/lib/audit', () => ({
  writeAudit: async (voce: Record<string, unknown>) => {
    db.audit.push(voce);
  },
}));
// Il salvataggio delle taglie ha le sue prove: qui scrive le righe come le scriverebbe, per posizione.
vi.mock('@/lib/products/persistVariantsServer', () => ({
  controllaScorteVarianti: async () => undefined,
  saveProductVariantsServer: async (_a: unknown, productId: string, variants: Array<Riga>) => {
    db.taglie = variants.map((v, i) => ({
      id: `riga-${i + 1}`,
      product_id: productId,
      options: v.options,
      label: v.label,
      stock: v.stock,
      position: 0,
    }));
  },
}));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from(tavola: string) {
      const righe = () => (tavola === 'products' ? db.prodotti : tavola === 'product_variants' ? db.taglie : []);
      return {
        select() {
          const filtri: Array<[string, unknown]> = [];
          const scelte = () => righe().filter((x) => filtri.every(([c, v]) => x[c] === v)).map((x) => ({ ...x }));
          const catena = {
            eq(c: string, v: unknown) {
              filtri.push([c, v]);
              return catena;
            },
            async maybeSingle() {
              return { data: scelte()[0] ?? null, error: null };
            },
            then(ok: (r: unknown) => unknown, ko?: (e: unknown) => unknown) {
              return Promise.resolve({ data: scelte(), error: null }).then(ok, ko);
            },
          };
          return catena;
        },
        update(valori: Riga) {
          const filtri: Array<[string, unknown]> = [];
          const applica = () => {
            const colpite = righe().filter((x) => filtri.every(([c, v]) => x[c] === v));
            colpite.forEach((x) => Object.assign(x, valori));
            return colpite;
          };
          const catena = {
            eq(c: string, v: unknown) {
              filtri.push([c, v]);
              return catena;
            },
            async select() {
              return { data: applica().map((x) => ({ id: x.id })), error: null };
            },
            then(ok: (r: unknown) => unknown, ko?: (e: unknown) => unknown) {
              applica();
              return Promise.resolve({ error: null }).then(ok, ko);
            },
          };
          return catena;
        },
      };
    },
  }),
}));

import { PATCH } from '@/app/api/admin/products/route';

const ID = '11111111-1111-4111-8111-111111111111';
const salva = (corpo: Record<string, unknown>) =>
  PATCH(
    new Request('http://localhost/api/admin/products', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: ID, ...corpo }),
    }) as never,
  );
const modulo = (pezziM: number) => [
  { options: { taglia: 'M' }, label: 'M', stock: pezziM },
  { options: { taglia: 'L' }, label: 'L', stock: 2 },
];

beforeEach(() => {
  db.audit.length = 0;
  db.prodotti = [{ id: ID, name: 'Maglietta', price: '10.00' }];
  db.taglie = [
    { id: 'riga-2', product_id: ID, options: { taglia: 'M' }, label: 'M', stock: 3, position: 0 },
    { id: 'riga-1', product_id: ID, options: { taglia: 'L' }, label: 'L', stock: 2, position: 0 },
  ];
});

describe('R03-001 · taglie alla stessa posizione', () => {
  it('stesse taglie rimandate, id riscritti in altro ordine: nessuna voce di riordino', async () => {
    const res = await salva({ variants: modulo(3) });
    expect(res.status).toBe(200);
    expect(db.audit, 'un riordino che non c\'è è finito nella traccia').toHaveLength(0);
  });

  it('controprova: una scorta cambiata davvero entra ancora nella traccia', async () => {
    const res = await salva({ variants: modulo(5) });
    expect(res.status).toBe(200);
    expect(db.audit).toHaveLength(1);
  });
});

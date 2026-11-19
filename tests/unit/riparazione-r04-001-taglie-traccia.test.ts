import { describe, it, expect, vi, beforeEach } from 'vitest';

/** R04-001 — Se l'amministrazione cambia solo le taglie, il registro delle azioni scrive la voce. */

const db = vi.hoisted(() => ({
  prodotti: [] as Record<string, unknown>[],
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
vi.mock('@/lib/products/persistVariantsServer', () => ({
  controllaScorteVarianti: async () => undefined,
  saveProductVariantsServer: async () => undefined,
}));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from(tavola: string) {
      const righe = () => (tavola === 'products' ? db.prodotti : []);
      return {
        select() {
          const filtri: Array<[string, unknown]> = [];
          const catena = {
            eq(c: string, v: unknown) {
              filtri.push([c, v]);
              return catena;
            },
            async maybeSingle() {
              const r = righe().find((x) => filtri.every(([c, v]) => x[c] === v));
              return { data: r ? { ...r } : null, error: null };
            },
          };
          return catena;
        },
        update(valori: Record<string, unknown>) {
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

const taglie = [
  { options: { taglia: 'M' }, label: 'M', stock: 3 },
  { options: { taglia: 'L' }, label: 'L', stock: 2 },
];

describe('R04-001 — le taglie cambiate entrano nel registro', () => {
  beforeEach(() => {
    db.prodotti.length = 0;
    db.audit.length = 0;
    db.prodotti.push({ id: ID, name: 'Maglia', price: '10.00' });
  });

  it('cambiano solo le taglie: una voce con le taglie', async () => {
    const res = await salva({ variants: taglie });
    expect(res.status).toBe(200);
    expect(db.audit).toHaveLength(1);
    const m = db.audit[0].metadata as { campi: string[]; dopo: Record<string, unknown> };
    expect(db.audit[0].targetId).toBe(ID);
    expect(m.campi).toEqual(['variants']);
    expect(m.dopo.variants).toEqual(taglie);
  });

  it('prezzo e taglie insieme: stessa voce', async () => {
    const res = await salva({ price: 12, variants: taglie });
    expect(res.status).toBe(200);
    expect(db.audit).toHaveLength(1);
    expect((db.audit[0].metadata as { campi: string[] }).campi).toEqual(['price', 'variants']);
  });
});

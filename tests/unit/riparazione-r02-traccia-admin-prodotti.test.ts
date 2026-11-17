import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * R02-003 — La traccia «chi ha cambiato il prezzo» esce nella stessa forma da ogni porta.
 *
 * Il modulo del prodotto e le porte dell'AI scrivono la voce con `tracciaDellaModifica`:
 * `{ origine, campi, prima, dopo, daAi }`, solo i campi cambiati. La porta dell'amministrazione
 * (PATCH /api/admin/products) scriveva `{ fields: [...] }`: i nomi di tutte le chiavi mandate,
 * anche quelle rimaste uguali, e nessun valore di prima. Chi cercava «chi ha portato il pane da
 * 10 a 12 euro» non lo trovava se l'aveva fatto l'amministrazione.
 */

const db = vi.hoisted(() => ({
  prodotti: [] as Record<string, unknown>[],
  profili: [] as Record<string, unknown>[],
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
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from(tavola: string) {
      const righe = () => (tavola === 'products' ? db.prodotti : tavola === 'profiles' ? db.profili : []);
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
const NEGOZIO_A = '22222222-2222-4222-8222-222222222222';
const NEGOZIO_B = '33333333-3333-4333-8333-333333333333';

const salva = (corpo: Record<string, unknown>) =>
  PATCH(
    new Request('http://localhost/api/admin/products', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: ID, ...corpo }),
    }) as never,
  );

describe('R02-003 — la porta dell amministrazione scrive la traccia come le altre', () => {
  beforeEach(() => {
    db.prodotti.length = 0;
    db.profili.length = 0;
    db.audit.length = 0;
    db.prodotti.push({ id: ID, seller_id: NEGOZIO_A, name: 'Pane', price: '10.00', tags: ['forno'] });
    db.profili.push({ id: NEGOZIO_A, role: 'seller' }, { id: NEGOZIO_B, role: 'seller' });
  });

  it('il prezzo da 10 a 12: una voce con solo il prezzo, il valore di prima e quello di dopo', async () => {
    const res = await salva({ name: 'Pane', price: 12, tags: ['forno'] });
    expect(res.status).toBe(200);
    expect(db.audit).toHaveLength(1);
    expect(db.audit[0]).toEqual({
      actorId: 'admin-1',
      action: 'product.update',
      targetTable: 'products',
      targetId: ID,
      metadata: { origine: 'admin', campi: ['price'], prima: { price: '10.00' }, dopo: { price: 12 }, daAi: [] },
    });
  });

  it('il prodotto spostato in un altro negozio: il negozio entra nella stessa voce', async () => {
    const res = await salva({ seller_id: NEGOZIO_B });
    expect(res.status).toBe(200);
    expect(db.audit).toHaveLength(1);
    expect(db.audit[0].metadata).toEqual({
      origine: 'admin',
      campi: ['seller_id'],
      prima: { seller_id: NEGOZIO_A },
      dopo: { seller_id: NEGOZIO_B },
      daAi: [],
    });
  });

  it('salvato senza cambiare niente: nessuna voce di modifiche mai fatte', async () => {
    const res = await salva({ name: 'Pane', price: 10 });
    expect(res.status).toBe(200);
    expect(db.audit).toHaveLength(0);
  });
});

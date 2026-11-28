import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * R03-002 — QUANDO L'AMMINISTRAZIONE CAMBIAVA SOLO LE TAGLIE, IL REGISTRO DELLE AZIONI NON SCRIVEVA NIENTE.
 *
 * La traccia della porta dell'amministrazione (PATCH /api/admin/products) dice solo i campi del
 * prodotto cambiati. Le taglie non sono colonne del prodotto: se cambiavano da sole la voce non
 * nasceva, e «chi ha portato la M da 3 a 5 pezzi» non restava scritto da nessuna parte. Adesso le
 * taglie entrano nella stessa voce come `variants`, col prima e il dopo letti dalla banca dati, e
 * solo se sono cambiate davvero (un salvataggio identico non scrive niente, come per gli altri campi).
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
      id: (v.id as string | undefined) ?? `nuova-${i}`,
      product_id: productId,
      options: v.options,
      label: v.label,
      stock: v.stock,
      position: i,
    }));
  },
}));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    // 27/11/2026 — La funzione che salva prodotto e varianti in una transazione non c'è in questo
    // finto, come in un database senza la migrazione: la rotta torna ai due passi che la prova guarda.
    rpc: async (nome: string) => ({ data: null, error: { code: 'PGRST202', message: `Could not find the function public.${nome} in the schema cache` } }),
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
const M = 'aaaaaaaa-0000-4000-8000-00000000000a';
const L = 'bbbbbbbb-0000-4000-8000-00000000000b';

const salva = (corpo: Record<string, unknown>) =>
  PATCH(
    new Request('http://localhost/api/admin/products', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: ID, ...corpo }),
    }) as never,
  );

const taglieDelModulo = (pezziM: number) => [
  { id: M, options: { taglia: 'M' }, label: 'M', stock: pezziM },
  { id: L, options: { taglia: 'L' }, label: 'L', stock: 2 },
];

beforeEach(() => {
  db.audit.length = 0;
  db.prodotti = [{ id: ID, name: 'Maglietta', price: '10.00' }];
  db.taglie = [
    { id: M, product_id: ID, options: { taglia: 'M' }, label: 'M', stock: 3, position: 0 },
    { id: L, product_id: ID, options: { taglia: 'L' }, label: 'L', stock: 2, position: 1 },
  ];
});

describe('R03-002 · le taglie cambiate dall’amministrazione entrano nel registro', () => {
  it('solo le taglie cambiate (M da 3 a 5): una voce «variants» col prima e il dopo', async () => {
    const res = await salva({ variants: taglieDelModulo(5) });
    expect(res.status).toBe(200);
    expect(db.audit, 'le taglie cambiate da sole non hanno lasciato nessuna voce nel registro').toHaveLength(1);
    const voce = db.audit[0] as { action: string; targetId: string; metadata: Record<string, unknown> };
    expect(voce.action).toBe('product.update');
    expect(voce.targetId).toBe(ID);
    expect(voce.metadata.origine).toBe('admin');
    expect(voce.metadata.campi).toEqual(['variants']);
    expect((voce.metadata.prima as { variants: Array<{ stock: number }> }).variants.map((t) => t.stock)).toEqual([3, 2]);
    expect((voce.metadata.dopo as { variants: Array<{ stock: number }> }).variants.map((t) => t.stock)).toEqual([5, 2]);
  });

  it('prezzo e taglie cambiati insieme: una voce sola con tutti e due', async () => {
    const res = await salva({ price: 12, variants: taglieDelModulo(5) });
    expect(res.status).toBe(200);
    expect(db.audit).toHaveLength(1);
    const meta = (db.audit[0] as { metadata: Record<string, unknown> }).metadata;
    expect(meta.campi).toEqual(['price', 'variants']);
    expect((meta.prima as Record<string, unknown>).price).toBe('10.00');
    expect((meta.dopo as Record<string, unknown>).price).toBe(12);
  });

  it('taglie rimandate uguali: nessuna voce di modifiche mai fatte', async () => {
    const res = await salva({ variants: taglieDelModulo(3) });
    expect(res.status).toBe(200);
    expect(db.audit).toHaveLength(0);
  });
});

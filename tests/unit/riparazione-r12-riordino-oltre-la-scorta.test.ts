import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * R12-012 — «Ripeti ordine» rimetteva nel carrello una quantita' oltre la scorta (la fermava solo
 * la cassa).
 *
 * Il riordino legge gia' i prodotti di adesso (prezzo, stato, scorta), ma della scorta guardava
 * solo «e' a zero?»: cinque focacce ordinate allora entravano tutte anche con tre sullo scaffale, e
 * il cliente lo scopriva pagando. Adesso ogni riga entra al massimo con la scorta di adesso (quella
 * della variante, se c'e'), contando quello che della stessa riga resta nel carrello con «Aggiungi».
 * Client Supabase finto: le letture rispondono per tabella e per id, come il database.
 */
const stato = vi.hoisted(() => ({
  carrello: [] as Array<Record<string, unknown>>,
  esito: 'conferma' as 'conferma' | 'alternativa' | 'chiusa',
  prodotti: [] as Array<Record<string, unknown>>,
  varianti: [] as Array<Record<string, unknown>>,
  erroreProdotti: null as null | { message: string },
  aggiunte: [] as Array<Record<string, unknown>>,
  successi: [] as string[],
  errori: [] as string[],
}));
vi.mock('@/lib/cart', () => ({
  getCart: () => stato.carrello,
  clearCart: () => { stato.carrello = []; },
  addToCart: (item: Record<string, unknown>) => { stato.aggiunte.push(item); stato.carrello.push(item); },
}));
vi.mock('@/components/ConfirmDialog', () => ({ sceltaDialog: async () => stato.esito }));
vi.mock('sonner', () => ({
  toast: { success: (m: string) => stato.successi.push(m), error: (m: string) => stato.errori.push(m) },
}));
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    from: (tabella: string) => ({
      select: () => ({
        in: async (_c: string, ids: string[]) => {
          if (tabella === 'products') {
            return stato.erroreProdotti
              ? { data: null, error: stato.erroreProdotti }
              : { data: stato.prodotti.filter((r) => ids.includes(String(r.id))), error: null };
          }
          if (tabella === 'product_variants') {
            return { data: stato.varianti.filter((r) => ids.includes(String(r.id))), error: null };
          }
          return { data: [], error: null };
        },
      }),
    }),
  },
}));
vi.mock('@/lib/promotions', async (originale) => ({
  ...(await originale<Record<string, unknown>>()),
  fetchActiveDiscounts: async () => new Map(),
}));

async function carica() {
  vi.resetModules();
  return import('@/lib/riordino');
}

const FOCACCE = { productId: 'focaccia', name: 'Focaccia', quantity: 5, prezzoStorico: 2 };
const MAGLIA_M = { productId: 'maglia', name: 'Maglia', quantity: 2, prezzoStorico: 20, variantId: 'maglia-m', variantLabel: 'M' };

beforeEach(() => {
  stato.carrello = []; stato.esito = 'conferma'; stato.erroreProdotti = null;
  stato.aggiunte = []; stato.successi = []; stato.errori = [];
  stato.prodotti = [
    { id: 'focaccia', price: 2, status: 'available', stock: 3 },
    { id: 'maglia', price: 20, status: 'available', stock: 10 },
  ];
  stato.varianti = [{ id: 'maglia-m', stock: 1 }, { id: 'maglia-l', stock: 9 }];
});

describe('R12-012 — ripeti ordine non mette nel carrello piu della scorta', () => {
  it('cinque focacce ordinate, tre sullo scaffale: ne entrano tre, e il messaggio lo dice', async () => {
    const { riordina } = await carica();
    expect(await riordina([FOCACCE])).toBe(1);
    expect(stato.aggiunte).toHaveLength(1);
    expect(stato.aggiunte[0]).toMatchObject({ id: 'focaccia', quantity: 3 });
    expect(stato.successi[0]).toMatch(/1 quantità ridotta a quella disponibile/);
  });

  it('una variante: conta la scorta della variante, non la somma del prodotto', async () => {
    const { riordina } = await carica();
    expect(await riordina([MAGLIA_M])).toBe(1);
    expect(stato.aggiunte[0]).toMatchObject({ id: 'maglia', variantId: 'maglia-m', quantity: 1 });
  });

  it('con «Aggiungi» conta anche quello che della stessa riga e gia nel carrello', async () => {
    stato.carrello = [{ id: 'focaccia', name: 'Focaccia', price: 2, quantity: 2 }];
    stato.esito = 'alternativa';
    const { riordina } = await carica();
    expect(await riordina([{ ...FOCACCE, quantity: 2 }])).toBe(1);
    expect(stato.aggiunte[0]).toMatchObject({ id: 'focaccia', quantity: 1 });
  });

  it('con «Aggiungi» e tutta la scorta gia nel carrello non entra niente, e lo si dice', async () => {
    stato.carrello = [{ id: 'focaccia', name: 'Focaccia', price: 2, quantity: 3 }];
    stato.esito = 'alternativa';
    const { riordina } = await carica();
    expect(await riordina([{ ...FOCACCE, quantity: 1 }])).toBe(0);
    expect(stato.aggiunte).toHaveLength(0);
    expect(stato.errori[0]).toMatch(/già tutta la quantità disponibile/);
  });

  it('una variante con la scorta a zero non entra e si conta fra i non disponibili', async () => {
    stato.varianti = [{ id: 'maglia-m', stock: 0 }];
    const { riordina } = await carica();
    expect(await riordina([MAGLIA_M, { ...FOCACCE, quantity: 1 }])).toBe(1);
    expect(stato.aggiunte.map((r) => r.id)).toEqual(['focaccia']);
    expect(stato.successi[0]).toMatch(/1 articolo non è più disponibile/);
  });

  it('con la scorta sufficiente la quantita resta quella dell ordine', async () => {
    stato.prodotti[0].stock = 50;
    const { riordina } = await carica();
    await riordina([FOCACCE]);
    expect(stato.aggiunte[0]).toMatchObject({ quantity: 5 });
    expect(stato.successi[0]).not.toMatch(/ridott/);
  });

  it('se la lettura dei prodotti cade si riordina come prima, senza tetto', async () => {
    stato.erroreProdotti = { message: 'rete' };
    const { riordina } = await carica();
    await riordina([FOCACCE]);
    expect(stato.aggiunte[0]).toMatchObject({ quantity: 5 });
  });
});

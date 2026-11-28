import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * «Ripeti ordine» non mette nel carrello più della scorta, nemmeno quando lo stesso prodotto
 * (stessa variante) sta su due righe dell'ordine.
 *
 * Il tetto della scorta toglieva solo quello che c'era nel carrello prima del riordino, non i
 * pezzi già messi dalle righe precedenti dello stesso riordino: 2+2 focacce con tre sullo
 * scaffale ne mettevano 4, e le fermava solo la cassa (il database non vieta righe doppie in
 * order_items). Client Supabase finto: le letture rispondono per tabella e per id.
 */
const stato = vi.hoisted(() => ({
  carrello: [] as Array<Record<string, unknown>>,
  esito: 'conferma' as 'conferma' | 'alternativa' | 'chiusa',
  prodotti: [] as Array<Record<string, unknown>>,
  varianti: [] as Array<Record<string, unknown>>,
  aggiunte: [] as Array<Record<string, unknown>>,
  successi: [] as string[],
  errori: [] as string[],
}));
// Come il vero getCart (rilegge il localStorage): una copia a ogni chiamata, non lo stesso array.
vi.mock('@/lib/cart', () => ({
  getCart: () => stato.carrello.map((r) => ({ ...r })),
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
          if (tabella === 'products') return { data: stato.prodotti.filter((r) => ids.includes(String(r.id))), error: null };
          if (tabella === 'product_variants') return { data: stato.varianti.filter((r) => ids.includes(String(r.id))), error: null };
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

const pezzi = (filtro: (r: Record<string, unknown>) => boolean = () => true) =>
  stato.aggiunte.filter(filtro).reduce((somma, r) => somma + Number(r.quantity), 0);

const FOCACCIA = { productId: 'focaccia', name: 'Focaccia', quantity: 2, prezzoStorico: 2 };
const MAGLIA_M = { productId: 'maglia', name: 'Maglia', quantity: 2, prezzoStorico: 20, variantId: 'maglia-m', variantLabel: 'M' };
const MAGLIA_L = { productId: 'maglia', name: 'Maglia', quantity: 2, prezzoStorico: 20, variantId: 'maglia-l', variantLabel: 'L' };

beforeEach(() => {
  stato.carrello = []; stato.esito = 'conferma';
  stato.aggiunte = []; stato.successi = []; stato.errori = [];
  stato.prodotti = [
    { id: 'focaccia', price: 2, status: 'available', stock: 3 },
    { id: 'maglia', price: 20, status: 'available', stock: 10 },
  ];
  stato.varianti = [{ id: 'maglia-m', stock: 3 }, { id: 'maglia-l', stock: 9 }];
});

describe('ripeti ordine: lo stesso prodotto su due righe non supera la scorta', () => {
  it('2+2 focacce con tre sullo scaffale: ne entrano tre, non quattro', async () => {
    const { riordina } = await carica();
    await riordina([FOCACCIA, { ...FOCACCIA }]);
    expect(pezzi(), 'le righe doppie sommavano oltre la scorta').toBe(3);
    expect(stato.aggiunte.map((r) => r.quantity)).toEqual([2, 1]);
    expect(stato.successi[0]).toMatch(/1 quantità ridotta a quella disponibile/);
  });

  it('la stessa variante su due righe conta la scorta della variante: 2+2 con 3 → 3', async () => {
    const { riordina } = await carica();
    await riordina([MAGLIA_M, { ...MAGLIA_M }]);
    expect(pezzi((r) => r.variantId === 'maglia-m')).toBe(3);
  });

  it('due varianti diverse dello stesso prodotto restano ognuna col suo tetto', async () => {
    stato.varianti = [{ id: 'maglia-m', stock: 1 }, { id: 'maglia-l', stock: 9 }];
    const { riordina } = await carica();
    await riordina([MAGLIA_M, MAGLIA_L]);
    expect(pezzi((r) => r.variantId === 'maglia-m')).toBe(1);
    expect(pezzi((r) => r.variantId === 'maglia-l')).toBe(2);
  });

  it('con «Aggiungi» contano insieme il carrello e le righe precedenti: 1 nel carrello, 2+2 con 3 → ne entrano 2', async () => {
    stato.carrello = [{ id: 'focaccia', name: 'Focaccia', price: 2, quantity: 1 }];
    stato.esito = 'alternativa';
    const { riordina } = await carica();
    await riordina([FOCACCIA, { ...FOCACCIA }]);
    expect(pezzi()).toBe(2);
    expect(stato.carrello.reduce((s, r) => s + Number(r.quantity), 0)).toBe(3);
  });

  it('scorta della variante che non si legge: vale quella del prodotto, per tutte le varianti insieme', async () => {
    stato.prodotti[1].stock = 3;
    stato.varianti = [];
    const { riordina } = await carica();
    await riordina([MAGLIA_M, MAGLIA_L]);
    expect(pezzi((r) => r.id === 'maglia'), 'la scorta del prodotto è di tutte le varianti').toBe(3);
  });

  it('scorta a zero: non entra niente, nemmeno con due righe', async () => {
    stato.prodotti[0].stock = 0;
    const { riordina } = await carica();
    expect(await riordina([FOCACCIA, { ...FOCACCIA }])).toBe(0);
    expect(stato.aggiunte).toHaveLength(0);
  });
});

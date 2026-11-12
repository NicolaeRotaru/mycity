import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * R08-012 — «Ripeti ordine» rimetteva nel carrello anche i prodotti finiti o tolti
 * dalla vendita, al prezzo di allora, dicendo «aggiunti al carrello!».
 *
 * La lettura dei prodotti passa dalle regole del cliente: un prodotto non
 * «available» non torna nella risposta. Il finto database qui fa lo stesso.
 */
const stato = vi.hoisted(() => ({
  carrello: [] as Array<Record<string, unknown>>,
  esito: 'conferma' as 'conferma' | 'alternativa' | 'chiusa',
  // le righe che il database restituisce (già filtrate dalle regole del cliente)
  righe: [] as Array<Record<string, unknown>>,
  errore: null as null | { message: string },
  successi: [] as string[],
  errori: [] as string[],
}));
vi.mock('@/lib/cart', () => ({
  getCart: () => stato.carrello,
  clearCart: () => { stato.carrello = []; },
  addToCart: (item: Record<string, unknown>) => { stato.carrello.push(item); },
}));
vi.mock('@/components/ConfirmDialog', () => ({ sceltaDialog: async () => stato.esito }));
vi.mock('sonner', () => ({
  toast: { success: (m: string) => stato.successi.push(m), error: (m: string) => stato.errori.push(m) },
}));
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        in: async (_c: string, ids: string[]) =>
          stato.errore
            ? { data: null, error: stato.errore }
            : { data: stato.righe.filter((r) => ids.includes(String(r.id))), error: null },
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

const PANE = { productId: 'pane', name: 'Pane', quantity: 2, prezzoStorico: 3 };
const TORTA = { productId: 'torta', name: 'Torta', quantity: 1, prezzoStorico: 12 };
const BISCOTTI = { productId: 'biscotti', name: 'Biscotti', quantity: 1, prezzoStorico: 5 };

beforeEach(() => {
  stato.carrello = []; stato.esito = 'conferma'; stato.errore = null;
  stato.successi = []; stato.errori = [];
  stato.righe = [{ id: 'pane', price: 3, status: 'available', stock: 10 }];
});

describe('R08-012 — ripeti ordine lascia fuori quello che non è più in vendita', () => {
  it('un prodotto tolto dalla vendita (la lettura non lo restituisce) non entra, e il messaggio lo dice', async () => {
    const { riordina } = await carica();
    expect(await riordina([PANE, TORTA])).toBe(1);
    expect(stato.carrello.map((r) => r.id)).toEqual(['pane']);
    expect(stato.successi[0]).toMatch(/1 articolo non è più disponibile/);
  });

  it('un prodotto con la scorta a zero o in uno stato diverso da «available» non entra', async () => {
    stato.righe.push({ id: 'torta', price: 12, status: 'available', stock: 0 });
    stato.righe.push({ id: 'biscotti', price: 5, status: 'sold', stock: 3 });
    const { riordina } = await carica();
    expect(await riordina([PANE, TORTA, BISCOTTI])).toBe(1);
    expect(stato.carrello.map((r) => r.id)).toEqual(['pane']);
    expect(stato.successi[0]).toMatch(/2 articoli non sono più disponibili/);
  });

  it('se nessun prodotto è più in vendita non si aggiunge niente e il carrello di prima resta', async () => {
    stato.righe = [];
    stato.carrello = [{ id: 'latte', name: 'Latte', quantity: 1 }];
    const { riordina } = await carica();
    expect(await riordina([TORTA])).toBe(0);
    expect(stato.carrello).toEqual([{ id: 'latte', name: 'Latte', quantity: 1 }]);
    expect(stato.errori[0]).toMatch(/più disponibile/);
  });

  it('se la lettura fallisce resta il ripiego: tutto dentro col prezzo di allora', async () => {
    stato.errore = { message: 'rete caduta' };
    const { riordina } = await carica();
    expect(await riordina([PANE, TORTA])).toBe(2);
    expect(stato.carrello.find((r) => r.id === 'torta')?.price).toBe(12);
  });
});

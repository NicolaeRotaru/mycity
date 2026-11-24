import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 24/11/2026 (collaudo di SDG) — «Ordina di nuovo» con un abbonamento di SDG dentro.
 * L'abbonamento non entra nel carrello (lib/products/sdgSeller.ts): non si conta fra gli aggiunti,
 * e se è l'unica riga il carrello che c'era non si svuota. Il finto è quello di minori-s02-riordino.
 */
const SDG = '11111111-1111-1111-1111-5d9000000001';
const stato = vi.hoisted(() => ({
  carrello: [] as Array<Record<string, unknown>>,
  esito: 'alternativa' as 'conferma' | 'alternativa' | 'chiusa',
  prezzi: [] as Array<{ id: string; price: number }>,
  sconti: new Map<string, number>(),
  successi: [] as string[],
}));
vi.mock('@/lib/cart', () => ({
  getCart: () => stato.carrello,
  clearCart: () => { stato.carrello = []; },
  addToCart: (item: Record<string, unknown>) => { if (item.sellerId !== '11111111-1111-1111-1111-5d9000000001') stato.carrello.push(item); },
}));
vi.mock('@/components/ConfirmDialog', () => ({
  confirmDialog: async () => stato.esito === 'conferma',
  sceltaDialog: async () => stato.esito,
}));
vi.mock('sonner', () => ({ toast: { success: (m: string) => stato.successi.push(m), error: vi.fn() } }));
vi.mock('@/lib/supabase/client', () => ({
  supabase: { from: () => ({ select: () => ({ in: async () => ({ data: stato.prezzi }) }) }) },
}));
vi.mock('@/lib/promotions', async (originale) => ({
  ...(await originale<Record<string, unknown>>()),
  fetchActiveDiscounts: async () => stato.sconti,
}));

async function carica() {
  vi.resetModules();
  return import('@/lib/riordino');
}
const TORTA = { productId: 'p1', name: 'Torta', quantity: 1, prezzoStorico: 8, variantId: 'v-grande', variantLabel: 'grande' };

beforeEach(() => {
  stato.carrello = [];
  stato.esito = 'alternativa';
  stato.prezzi = [{ id: 'p1', price: 10 }];
  stato.sconti = new Map([['p1', 20]]);
  stato.successi = [];
});

const ABBONAMENTO = { productId: '11111111-1111-1111-1111-5d9000000101', name: 'Abbonamento Base', quantity: 1, prezzoStorico: 300, sellerId: SDG };

describe('ordina di nuovo con un abbonamento di SDG', () => {
  it('l abbonamento non si conta fra gli aggiunti, la torta sì', async () => {
    stato.prezzi = [{ id: 'p1', price: 10 }, { id: ABBONAMENTO.productId, price: 300 }];
    const { riordina } = await carica();
    expect(await riordina([TORTA, ABBONAMENTO])).toBe(1);
    expect(stato.carrello.map((r) => r.id)).toEqual(['p1']);
  });

  it('solo l abbonamento con «Sostituisci»: il carrello che c era resta', async () => {
    stato.carrello = [{ id: 'altro', name: 'Latte', quantity: 1 }];
    stato.esito = 'conferma';
    stato.prezzi = [{ id: ABBONAMENTO.productId, price: 300 }];
    const { riordina } = await carica();
    expect(await riordina([ABBONAMENTO])).toBe(0);
    expect(stato.carrello).toEqual([{ id: 'altro', name: 'Latte', quantity: 1 }]);
  });
});

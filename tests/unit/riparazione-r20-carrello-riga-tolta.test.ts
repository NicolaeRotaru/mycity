/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import CartCrossDeviceSync from '@/components/CartCrossDeviceSync';
import { CART_UPDATED_AT_KEY, getCart } from '@/lib/cart';
import { accendi } from './aiuti/schermo';

/**
 * R20-012 — Il carrello fra due dispositivi collegati: una riga tolta sul telefono tornava dal
 * computer con la fusione «quantità più alta» (lib/cart.ts, fondiCarrelli), e il computer la
 * rimandava anche sul cloud. Se il carrello del computer non è cambiato dopo l'ultimo allineamento
 * e il cloud sì, vale il cloud com'è; si fonde solo quando il locale ha roba mai salita.
 */
const db = vi.hoisted(() => ({
  riga: null as null | { items: unknown[]; updated_at: string },
  salite: [] as unknown[][],
}));

vi.mock('@/components/hooks/useUtente', () => ({ idUtenteInMemoria: async () => 'anna' }));
vi.mock('@/lib/cart-sync', () => ({ syncAbandonedCart: () => {} }));
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }) },
    from: () => {
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = () => q;
      q.maybeSingle = async () => ({ data: db.riga, error: null });
      q.upsert = async (r: { items: unknown[] }) => { db.salite.push(r.items); return { error: null }; };
      return q;
    },
  },
}));

const PANE = { id: 'pane', name: 'Pagnotta', price: 3, quantity: 2 };
const TORTA = { id: 'torta', name: 'Torta', price: 18, quantity: 1 };
const LATTE = { id: 'latte', name: 'Latte', price: 2, quantity: 1 };
const SERA = Date.parse('2026-11-12T20:00:00Z');

async function gira() {
  for (let i = 0; i < 20; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

/** Il computer di casa: il suo carrello era salito sul cloud ieri sera, e da allora non è cambiato. */
function computerAllineatoIeriSera(carrello: unknown[]) {
  localStorage.setItem('cart', JSON.stringify(carrello));
  localStorage.setItem(CART_UPDATED_AT_KEY, String(SERA));
  localStorage.setItem('mc_cart_synced_at', String(SERA));
}

describe('R20-012 — una riga tolta su un dispositivo non torna dall’altro', () => {
  beforeEach(() => { localStorage.clear(); db.riga = null; db.salite = []; });
  afterEach(() => { document.body.innerHTML = ''; });

  it('la torta tolta stamattina dal telefono non torna dal computer (né sul cloud)', async () => {
    computerAllineatoIeriSera([PANE, TORTA]);
    db.riga = { items: [PANE], updated_at: '2026-11-13T08:00:00Z' };
    const s = accendi(CartCrossDeviceSync);
    await gira();
    expect(getCart().map((r) => r.id), 'la torta tolta sul telefono è tornata nel carrello del computer').toEqual(['pane']);
    expect(db.salite.some((items) => items.some((r) => (r as { id: string }).id === 'torta')), 'la torta tolta è stata rimandata sul cloud').toBe(false);
    s.smonta();
  });

  it('la quantità abbassata sul telefono non torna quella più alta', async () => {
    computerAllineatoIeriSera([PANE]);
    db.riga = { items: [{ ...PANE, quantity: 1 }], updated_at: '2026-11-13T08:00:00Z' };
    const s = accendi(CartCrossDeviceSync);
    await gira();
    expect(getCart().map((r) => `${r.id} ${r.quantity}`)).toEqual(['pane 1']);
    s.smonta();
  });

  it('controllo: con roba nuova mai salita sul computer, le due liste si fondono ancora (non si perde niente)', async () => {
    computerAllineatoIeriSera([PANE]);
    localStorage.setItem('cart', JSON.stringify([PANE, LATTE]));
    localStorage.setItem(CART_UPDATED_AT_KEY, String(SERA + 60_000)); // il latte, aggiunto dopo l'allineamento
    db.riga = { items: [PANE, TORTA], updated_at: '2026-11-13T08:00:00Z' };
    const s = accendi(CartCrossDeviceSync);
    await gira();
    expect(getCart().map((r) => r.id).sort()).toEqual(['latte', 'pane', 'torta']);
    s.smonta();
  });
});

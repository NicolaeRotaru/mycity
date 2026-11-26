/**
 * @vitest-environment jsdom
 */
/**
 * R16-011 — Il carrello si riempiva di nuovo con la spesa già tolta, se si usano due dispositivi.
 *
 * Telefono e computer allineati col cloud alle 20:00, con pane e latte. Alle 21:00 dal computer si
 * toglie il latte (e si abbassa il pane da 3 a 1): il cloud lo sa. Il telefono, il suo carrello non
 * l'ha più toccato, si riapre alle 22:00. Prima la fusione teneva l'unione con la quantità più alta:
 * il latte tornava sul telefono, il pane tornava a 3, e il telefono li rimandava su per tutti.
 * Adesso un locale non cambiato dopo l'ultimo allineamento è solo una copia vecchia: vince il cloud.
 * Un locale con roba nuova mai salita si fonde ancora, come prima.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import CartCrossDeviceSync from '@/components/CartCrossDeviceSync';
import { CART_UPDATED_AT_KEY, getCart } from '@/lib/cart';
import { accendi } from './aiuti/schermo';

const db = vi.hoisted(() => ({
  riga: null as null | { items: unknown[]; updated_at: string },
  scritte: [] as unknown[][],
}));

vi.mock('@/components/hooks/useUtente', () => ({ idUtenteInMemoria: async () => 'cliente-1' }));
vi.mock('@/lib/account/piu-account', () => ({ allineaUtenteDelBrowser: () => undefined }));
vi.mock('@/lib/cart-sync', () => ({ syncAbandonedCart: () => undefined }));
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }) },
    from: () => {
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = () => q;
      q.maybeSingle = async () => ({ data: db.riga, error: null });
      q.upsert = async (riga: { items: unknown[] }) => { db.scritte.push(riga.items); return { error: null }; };
      return q;
    },
  },
}));

const ALLE_20 = Date.parse('2026-11-26T19:00:00Z');
const ALLE_21 = '2026-11-26T20:00:00.000Z';
const PANE = { id: 'pane', name: 'Pane', price: 3, quantity: 3 };
const LATTE = { id: 'latte', name: 'Latte', price: 1.5, quantity: 1 };
const UOVA = { id: 'uova', name: 'Uova', price: 2.2, quantity: 1 };

async function gira() {
  for (let i = 0; i < 20; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

describe('R16-011 · una riga tolta su un dispositivo non torna dall\'altro', () => {
  beforeEach(() => {
    localStorage.clear();
    db.riga = null;
    db.scritte = [];
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-26T21:00:00Z'));
  });
  afterEach(() => {
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  it('il telefono rimasto fermo prende il carrello del cloud: niente latte, pane a 1', async () => {
    // Il telefono: allineato alle 20:00, non toccato dopo.
    localStorage.setItem('cart', JSON.stringify([PANE, LATTE]));
    localStorage.setItem(CART_UPDATED_AT_KEY, String(ALLE_20));
    localStorage.setItem('mc_cart_synced_at', String(ALLE_20));
    // Il cloud: alle 21:00 il computer ha tolto il latte e abbassato il pane.
    db.riga = { items: [{ ...PANE, quantity: 1 }], updated_at: ALLE_21 };
    const s = accendi(CartCrossDeviceSync);
    await gira();
    expect(getCart().map((r) => [r.id, r.quantity]), 'il latte tolto o il pane a 3 sono tornati sul telefono').toEqual([['pane', 1]]);
    for (const scritta of db.scritte) {
      expect((scritta as Array<{ id: string }>).map((r) => r.id), 'il telefono ha rimandato su il latte tolto').not.toContain('latte');
    }
    s.smonta();
  });

  it('il telefono con roba nuova mai salita la tiene: si fonde come prima', async () => {
    // Allineato alle 20:00, poi alle 20:30 si sono aggiunte le uova (mai salite sul cloud).
    localStorage.setItem('cart', JSON.stringify([PANE, LATTE, UOVA]));
    localStorage.setItem(CART_UPDATED_AT_KEY, String(Date.parse('2026-11-26T19:30:00Z')));
    localStorage.setItem('mc_cart_synced_at', String(ALLE_20));
    db.riga = { items: [{ ...PANE, quantity: 1 }], updated_at: ALLE_21 };
    const s = accendi(CartCrossDeviceSync);
    await gira();
    expect(getCart().map((r) => r.id), 'le uova aggiunte qui non si buttano').toContain('uova');
    s.smonta();
  });
});

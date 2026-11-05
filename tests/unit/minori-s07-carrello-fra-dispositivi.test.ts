/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import CartCrossDeviceSync from '@/components/CartCrossDeviceSync';
import { CART_UPDATED_AT_KEY, getCart } from '@/lib/cart';
import { accendi } from './aiuti/schermo';

const db = vi.hoisted(() => ({
  riga: null as null | { items: unknown[]; updated_at: string },
  erroreScrittura: null as null | { message: string },
  scritture: 0,
  recupero: 0,
}));

vi.mock('@/components/hooks/useUtente', () => ({ idUtenteInMemoria: async () => 'cliente-1' }));
vi.mock('@/lib/cart-sync', () => ({ syncAbandonedCart: () => { db.recupero++; } }));
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }) },
    from: () => {
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = () => q;
      q.maybeSingle = async () => ({ data: db.riga, error: null });
      q.upsert = async () => { db.scritture++; return { error: db.erroreScrittura }; };
      return q;
    },
  },
}));

const PANE = { id: 'pane', name: 'Pane', price: 3, quantity: 2 };
async function gira() {
  for (let i = 0; i < 20; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

describe('S07 · il carrello fra due dispositivi', () => {
  beforeEach(() => { localStorage.clear(); db.riga = null; db.erroreScrittura = null; db.scritture = 0; db.recupero = 0; });
  afterEach(() => { document.body.innerHTML = ''; });

  it('il cloud svuotato DOPO (spesa pagata altrove) non si riempie col carrello vecchio di questo computer', async () => {
    localStorage.setItem('cart', JSON.stringify([PANE]));
    localStorage.setItem(CART_UPDATED_AT_KEY, String(Date.parse('2026-11-04T20:00:00Z')));
    db.riga = { items: [], updated_at: '2026-11-05T08:00:00Z' };
    const s = accendi(CartCrossDeviceSync);
    await gira();
    expect(getCart()).toEqual([]);
    expect(db.scritture, 'il carrello vecchio è stato rimandato su').toBe(0);
    s.smonta();
  });

  it('se il server rifiuta il salvataggio, la data locale non avanza', async () => {
    localStorage.setItem('cart', JSON.stringify([PANE]));
    localStorage.setItem(CART_UPDATED_AT_KEY, '1000');
    db.riga = null; // mai scritto: si spinge il locale
    db.erroreScrittura = { message: 'permesso negato' };
    const s = accendi(CartCrossDeviceSync);
    await gira();
    expect(db.scritture).toBe(1);
    expect(localStorage.getItem(CART_UPDATED_AT_KEY)).toBe('1000');
    s.smonta();
  });

  it('il carrello che arriva dal cloud non riscrive la riga del carrello abbandonato', async () => {
    localStorage.setItem(CART_UPDATED_AT_KEY, '1000');
    db.riga = { items: [PANE], updated_at: '2026-11-05T08:00:00Z' };
    const s = accendi(CartCrossDeviceSync);
    await gira();
    expect(getCart().map((r) => r.id)).toEqual(['pane']);
    expect(db.recupero, 'aprire il sito da un altro dispositivo ha azzerato «email mandata»').toBe(0);
    s.smonta();
  });
});

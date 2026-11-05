/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach, afterAll } from 'vitest';
import { act } from 'react';
import CartPage from '@/app/cart/page';
import { accendi, clicca } from './aiuti/schermo';

vi.mock('next/link', () => ({ default: (p: { children?: unknown }) => p.children ?? null }));
vi.mock('next/image', () => ({ default: () => null }));
vi.mock('sonner', () => ({ toast: Object.assign(() => undefined, { success: () => undefined, error: () => undefined }) }));
vi.mock('@/components/cart/CartUpsell', () => ({ CartUpsell: () => null }));
vi.mock('@/components/ShareCartButton', () => ({ default: () => null }));
vi.mock('@/lib/cart-sync', () => ({ syncAbandonedCart: () => undefined }));
vi.mock('@/lib/promotions', async (originale) => ({
  ...(await originale<typeof import('@/lib/promotions')>()),
  fetchActiveDiscounts: async () => new Map(),
}));
vi.mock('@/lib/queries/seller-public-profiles', () => ({ fetchSellerPublicMap: async () => new Map() }));

const db = vi.hoisted(() => ({ prodotti: [] as unknown[], letti: false }));
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://supabase.finto.invalid';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'chiave-finta';
vi.mock('@supabase/ssr', () => {
  const catena = (tabella: string) => {
    const c: Record<string, unknown> = {};
    for (const k of ['select', 'eq', 'in', 'order', 'limit']) c[k] = () => c;
    c.then = (ok: (v: unknown) => unknown) => {
      if (tabella === 'products') db.letti = true;
      return Promise.resolve({ data: tabella === 'products' ? db.prodotti : [], error: null }).then(ok);
    };
    return c;
  };
  return {
    createBrowserClient: () => ({
      auth: { getSession: async () => ({ data: { session: null } }) },
      from: catena,
    }),
  };
});

const reteDiPartenza = globalThis.fetch;
globalThis.fetch = (async () => ({ ok: true, status: 200, headers: new Headers(), json: async () => ({ possibile: false }), text: async () => '' })) as unknown as typeof fetch;

let schermo: ReturnType<typeof accendi> | null = null;
afterEach(() => {
  schermo?.smonta();
  schermo = null;
  localStorage.clear();
});
afterAll(() => { globalThis.fetch = reteDiPartenza; });

async function carrello(righe: Array<{ id: string; name: string; quantity: number }>, prodotti: unknown[]) {
  db.prodotti = prodotti;
  db.letti = false;
  localStorage.setItem('cart', JSON.stringify(righe.map((r) => ({ ...r, price: 4, sellerId: 'neg-0', storeName: 'Pane Quotidiano' }))));
  schermo = accendi(CartPage);
  for (let i = 0, dopo = 0; i < 2000 && dopo < 10; i++) {
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    if (db.letti) dopo++;
  }
  expect(db.letti, 'la pagina non ha letto i prodotti').toBe(true);
  return schermo;
}

describe('S07 · il carrello non dice «Disponibile» su merce che non si può comprare', () => {
  it('il prodotto segnato «Esaurito» non torna dalla lettura: la riga lo dice e il pulsante si ferma', async () => {
    const s = await carrello([{ id: 'focaccia', name: 'Focaccia', quantity: 2 }], []);
    const testo = s.radice.textContent ?? '';
    expect(testo).toContain('Non più disponibile');
    expect(testo).not.toMatch(/✓?\s*Disponibile ·/);
    expect(testo).toContain('Togli l’articolo esaurito per continuare');
  });

  it('3 pezzi nel carrello e 2 disponibili: il pulsante chiede di abbassare la quantità', async () => {
    const s = await carrello([{ id: 'pane', name: 'Pane', quantity: 3 }], [{ id: 'pane', stock: 2, price: 4 }]);
    const testo = s.radice.textContent ?? '';
    expect(testo).toContain('Ne restano 2');
    expect(testo).toContain('Abbassa la quantità per continuare');
    expect(testo).not.toContain('Vai alla cassa');
  });

  it('togliendo una riga il fuoco va sul titolo e si dice cosa è stato tolto', async () => {
    const s = await carrello(
      [{ id: 'pane', name: 'Pane di Altamura', quantity: 1 }, { id: 'coppa', name: 'Coppa piacentina', quantity: 1 }],
      [{ id: 'pane', stock: 9, price: 4 }, { id: 'coppa', stock: 9, price: 4 }],
    );
    const rimuovi = s.radice.querySelector('button[aria-label="Rimuovi Pane di Altamura dal carrello"]') as HTMLButtonElement;
    expect(rimuovi).toBeTruthy();
    rimuovi.focus();
    s.agisci(() => clicca(rimuovi));
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(document.activeElement?.tagName).toBe('H1');
    expect(document.activeElement?.textContent).toContain('Il tuo carrello');
    const stato = [...s.radice.querySelectorAll('[role="status"]')].map((n) => n.textContent).join(' ');
    expect(stato).toContain('Pane di Altamura tolto dal carrello');
  });
});

describe('S07 · il reso nel carrello', () => {
  it('con dentro solo prodotti esclusi dal recesso non promette «Reso entro 14 giorni»', async () => {
    const s = await carrello([{ id: 'torta', name: 'Torta su ordinazione', quantity: 1 }], [{ id: 'torta', stock: 5, price: 4, non_recedibile: true }]);
    const t = s.radice.textContent ?? '';
    expect(t).not.toContain('Reso entro 14 giorni');
    expect(t).toContain('Esclusi dal recesso');
  });
  it('con un prodotto che il reso lo ha, resta «Reso entro 14 giorni · alcuni prodotti sono esclusi»', async () => {
    const s = await carrello(
      [{ id: 'torta', name: 'Torta', quantity: 1 }, { id: 'tazza', name: 'Tazza', quantity: 1 }],
      [{ id: 'torta', stock: 5, price: 4, non_recedibile: true }, { id: 'tazza', stock: 5, price: 4, non_recedibile: false }],
    );
    expect(s.radice.textContent).toContain('Reso entro 14 giorni');
  });
});

describe('S07 · la riga del carrello a 360 px', () => {
  it('quantità e «Rimuovi» possono andare a capo invece di uscire dal riquadro', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('app/cart/page.tsx', 'utf8');
    expect(src).toMatch(/<div className="flex items-center justify-between mt-2 flex-wrap gap-2">[\s\S]{0,200}<div className="flex flex-wrap items-center gap-2 min-w-0">/);
  });
});

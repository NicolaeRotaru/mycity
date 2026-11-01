/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act } from 'react';
import CartPage from '@/app/cart/page';
import { motivoFuoriZona } from '@/lib/ordini/zona-di-consegna';
import { accendi } from './aiuti/schermo';

/**
 * Chi abita oltre il raggio di consegna (Podenzano, Rottofreno) scopriva di
 * essere fuori zona solo premendo «ordina»: il controllo stava nelle due rotte
 * che creano l'ordine. Qui si prova che il carrello lo dice prima, con la stessa
 * frase, e che la cassa ferma il pulsante.
 */

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
// Il negozio in centro a Piacenza.
vi.mock('@/lib/queries/seller-public-profiles', () => ({
  fetchSellerPublicMap: async () => new Map([['neg-0', { id: 'neg-0', store_lat: 45.0526, store_lng: 9.693 }]]),
}));

const casa = { lat: null as number | null, lng: null as number | null, letta: false };
// L'import pigro del database dentro la pagina sfugge a un vi.mock sul modulo del client: si
// finge invece il costruttore che quel modulo chiama, e le variabili che gli servono.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://supabase.finto.invalid';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'chiave-finta';
vi.mock('@supabase/ssr', () => {
  const righe: Record<string, unknown[]> = {};
  const catena = (tabella: string) => {
    const c: Record<string, unknown> = {};
    for (const k of ['select', 'eq', 'in', 'order', 'limit']) c[k] = () => c;
    c.then = (ok: (v: unknown) => unknown) => {
      if (tabella === 'user_addresses') casa.letta = true;
      return Promise.resolve({
        data: tabella === 'user_addresses' ? [{ lat: casa.lat, lng: casa.lng }]
          : tabella === 'products' ? [{ id: 'p-0-0', stock: 10, price: 12 }]
            : (righe[tabella] ?? []),
        error: null,
      }).then(ok);
    };
    return c;
  };
  return {
    createBrowserClient: () => ({
      auth: { getSession: async () => ({ data: { session: { user: { id: 'cliente-1' } } } }) },
      from: catena,
    }),
  };
});

const reteDiPartenza = globalThis.fetch;
globalThis.fetch = (async () => ({ ok: true, status: 200, headers: new Headers(), json: async () => ({ possibile: true }), text: async () => '' })) as unknown as typeof fetch;

let schermo: ReturnType<typeof accendi> | null = null;
afterEach(() => {
  schermo?.smonta();
  schermo = null;
  localStorage.clear();
  vi.useRealTimers();
});
afterAll(() => {
  globalThis.fetch = reteDiPartenza;
});

async function carrelloCon(lat: number | null, lng: number | null) {
  casa.lat = lat;
  casa.lng = lng;
  casa.letta = false;
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(new Date(2026, 9, 30, 14, 0));
  localStorage.setItem('cart', JSON.stringify([
    { id: 'p-0-0', name: 'Pane', price: 12, quantity: 1, sellerId: 'neg-0', storeName: 'Negozio 0' },
  ]));
  schermo = accendi(CartPage);
  // Si aspetta che la pagina abbia chiesto dove consegniamo (sotto carico l'import pigro del
  // database arriva tardi), poi qualche giro ancora perche' la risposta arrivi a schermo.
  for (let i = 0, dopo = 0; i < 2000 && dopo < 10; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    if (casa.letta) dopo++;
  }
  expect(casa.letta, 'la pagina non ha chiesto l\'indirizzo: la prova non misura niente').toBe(true);
  return schermo.radice.textContent ?? '';
}

describe('il carrello dice la zona prima di «ordina»', () => {
  it('Podenzano, oltre il raggio: il carrello lo dice con la frase delle rotte', async () => {
    const pagina = await carrelloCon(44.955, 9.683);
    expect(pagina).toContain(motivoFuoriZona('Negozio 0'));
  });

  it('in centro, vicino al negozio: nessun avviso', async () => {
    const pagina = await carrelloCon(45.048, 9.70);
    expect(pagina).not.toContain(motivoFuoriZona('Negozio 0'));
  });

  it('indirizzo senza coordinate: non si blocca nessuno', async () => {
    const pagina = await carrelloCon(null, null);
    expect(pagina).not.toContain(motivoFuoriZona('Negozio 0'));
  });
});

describe('la cassa ferma il pulsante fuori zona', () => {
  const src = readFileSync(join(process.cwd(), 'app/checkout/page.tsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');

  it('la cassa fa la domanda delle rotte, sull\'indirizzo scelto e col ritiro', () => {
    const def = src.match(/const gruppoFuoriZona\s*=\s*([\s\S]*?\}\)\);)/);
    expect(def, 'la cassa non chiede la zona').toBeTruthy();
    expect(def![1]).toMatch(/fuoriZonaDiConsegna\(/);
    expect(def![1]).toMatch(/deliveryLat:\s*coordZona\?\.lat/);
    expect(def![1]).toMatch(/pickupInStore/);
  });

  it('fuori zona spegne il pulsante e porta la sua frase', () => {
    const bloccato = src.match(/const ordineBloccato\s*=\s*([^;]+);/)![1];
    expect(bloccato.split('||').map((p) => p.trim())).toContain('fuoriZona');
    const motivo = src.match(/const motivoDelBlocco\s*=\s*([^;]+);/)![1];
    expect(motivo).toMatch(/fuoriZona\s*\?\s*motivoFuoriZona\(/);
  });
});

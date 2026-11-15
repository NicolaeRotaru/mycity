/**
 * @vitest-environment jsdom
 */
/**
 * R24-006 (riga del carrello) — la miniatura nel carrello vero: se il file della foto non
 * risponde più, compare /foto-mancante.svg, non l'icona della foto rotta.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement } from 'react';
import CartPage from '@/app/cart/page';
import { accendi } from './aiuti/schermo';

const stato = vi.hoisted(() => ({
  prezzi: {} as Record<string, number>,
  negozi: new Map<string, { id: string; store_lat: number | null; store_lng: number | null }>(),
  casa: null as null | { lat: number; lng: number },
  varianti: [] as string[],
}));

vi.mock('next/link', () => ({ default: (p: { children?: unknown }) => p.children ?? null }));
vi.mock('next/image', () => ({
  default: ({ src, alt, onError }: { src: string; alt: string; onError?: (e: unknown) => void }) =>
    createElement('img', { src, alt, onError }),
}));
vi.mock('sonner', () => ({
  toast: Object.assign(() => undefined, { success: () => undefined, error: () => undefined, info: () => undefined }),
}));
vi.mock('@/components/cart/CartUpsell', () => ({ CartUpsell: () => null }));
vi.mock('@/components/ShareCartButton', () => ({ default: () => null }));
vi.mock('@/lib/cart-sync', () => ({ syncAbandonedCart: () => undefined }));
vi.mock('@/lib/promotions', async (originale) => ({
  ...(await originale<typeof import('@/lib/promotions')>()),
  fetchActiveDiscounts: async () => new Map(),
}));
vi.mock('@/lib/queries/seller-public-profiles', () => ({ fetchSellerPublicMap: async () => stato.negozi }));
// L'import pigro del database, dentro la pagina, sfugge a vi.mock: nasce il client VERO su un
// indirizzo finto, con una sessione nei cookie, e la rete finta qui sotto risponde come PostgREST.
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.finto.invalid';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'chiave-finta';
const reteDiPartenza = globalThis.fetch;
const json = (dati: unknown) => new Response(JSON.stringify(dati), { status: 200, headers: { 'content-type': 'application/json' } });
globalThis.fetch = (async (input: unknown) => {
  const url = String(typeof input === 'object' && input !== null && 'url' in input ? (input as { url: unknown }).url : input);
  if (url.includes('/api/consegna/veloce')) return json({ possibile: true });
  if (url.includes('/rest/v1/products')) return json(Object.entries(stato.prezzi).map(([id, price]) => ({ id, stock: 50, price })));
  if (url.includes('/rest/v1/product_variants')) return json(stato.varianti.map((id) => ({ id, stock: 50 })));
  if (url.includes('/rest/v1/user_addresses')) return json(stato.casa ? [stato.casa] : []);
  if (url.includes('/rest/v1/')) return json([]);
  return new Response('', { status: 503 });
}) as unknown as typeof fetch;

function sessioneNeiCookie() {
  const ora = Math.floor(Date.now() / 1000);
  const sessione = {
    access_token: 'gettone-finto', refresh_token: 'rinnovo-finto', token_type: 'bearer',
    expires_in: 3600 * 24 * 365, expires_at: ora + 3600 * 24 * 365,
    user: { id: 'cliente-1', aud: 'authenticated', role: 'authenticated', email: 'luca@example.it', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' },
  };
  document.cookie = `sb-supabase-auth-token=${encodeURIComponent(JSON.stringify(sessione))}; path=/`;
}

let schermo: ReturnType<typeof accendi> | null = null;
afterEach(() => { schermo?.smonta(); schermo = null; localStorage.clear(); vi.useRealTimers(); stato.prezzi = {}; });
process.on('exit', () => { globalThis.fetch = reteDiPartenza; });

describe('R24-006 · la miniatura del carrello con la foto cancellata', () => {
  it('dopo l\'errore dell\'immagine si vede la foto di ripiego', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(new Date(2026, 9, 30, 14, 0));
    stato.prezzi['p1'] = 12;
    sessioneNeiCookie();
    localStorage.setItem('cart', JSON.stringify([{
      id: 'p1', name: 'Prodotto p1', price: 12, quantity: 1, sellerId: 'neg-a', storeName: 'Negozio a',
      image: 'https://example.com/cancellata.jpg',
    }]));
    schermo = accendi(CartPage);
    for (let i = 0; i < 12; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    const foto = () => [...schermo!.radice.querySelectorAll('img')].find((i) => i.getAttribute('alt') === 'Prodotto p1') as HTMLImageElement;
    expect(foto().getAttribute('src')).toContain('example.com');
    await act(async () => { foto().dispatchEvent(new Event('error')); });
    expect(foto().getAttribute('src')).toBe('/foto-mancante.svg');
  });
});

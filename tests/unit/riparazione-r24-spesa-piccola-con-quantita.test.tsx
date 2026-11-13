/**
 * @vitest-environment jsdom
 */
/**
 * R24-011 — L'avviso «Spesa sotto i 10 €: … Ti mancano X» del carrello conta la spesa del negozio
 * prezzo × quantità (app/cart/page.tsx, `subtotalCents` dentro `prezziDelCarrello`), ma nessuna
 * prova lo guardava con più di un pezzo per riga: togliendo la quantità dal conto restavano tutte
 * verdi. Qui il carrello VERO, con righe da 2, 3 e 4 pezzi, e si legge l'avviso a video.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from 'react';
import CartPage from '@/app/cart/page';
import { avvisoSpesaPiccola } from '@/lib/promesse-pubbliche';
import { formatPrice } from '@/lib/format';
import { accendi } from './aiuti/schermo';

const stato = vi.hoisted(() => ({
  prezzi: {} as Record<string, number>,
  negozi: new Map<string, { id: string; store_lat: number | null; store_lng: number | null }>(),
  casa: null as null | { lat: number; lng: number },
}));

vi.mock('next/link', () => ({ default: (p: { children?: unknown }) => p.children ?? null }));
vi.mock('next/image', () => ({ default: () => null }));
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
afterEach(() => {
  schermo?.smonta();
  schermo = null;
  localStorage.clear();
  vi.useRealTimers();
  stato.prezzi = {};
  stato.negozi = new Map();
  stato.casa = null;
});
afterEach(() => { /* la rete finta resta per tutto il file */ });
process.on('exit', () => { globalThis.fetch = reteDiPartenza; });

type Riga = { id: string; prezzo: number; negozio: string; quantita: number; nome?: string };

async function carrello(righe: Riga[]): Promise<string> {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(new Date(2026, 9, 30, 14, 0));
  for (const r of righe) stato.prezzi[r.id] = r.prezzo;
  sessioneNeiCookie();
  localStorage.setItem('cart', JSON.stringify(righe.map((r) => ({
    id: r.id, name: `Prodotto ${r.id}`, price: r.prezzo, quantity: r.quantita, sellerId: r.negozio, storeName: r.nome ?? `Negozio ${r.negozio}`,
  }))));
  schermo = accendi(CartPage);
  for (let i = 0; i < 12; i++) {
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }
  return schermo.radice.textContent ?? '';
}

describe('R24-011 · l’avviso «spesa sotto i 10 €» conta i pezzi, non solo le righe', () => {
  it('2 × 3 €: la spesa è 6 €, mancano 4 € (non 7)', async () => {
    const t = await carrello([{ id: 'p-pane', prezzo: 3, negozio: 'neg-a', quantita: 2 }]);
    expect(t, 'controprova: il carrello si deve disegnare').toContain('Prodotto p-pane');
    expect(t, 'l’avviso legge un pezzo solo').not.toContain(avvisoSpesaPiccola(300)!);
    expect(t).toContain(avvisoSpesaPiccola(600)!);
  });

  it('3 × 4 €: la spesa è 12 €, nessun avviso', async () => {
    const t = await carrello([{ id: 'p-olio', prezzo: 4, negozio: 'neg-a', quantita: 3 }]);
    expect(t, 'controprova: il carrello si deve disegnare').toContain('Prodotto p-olio');
    expect(t, 'sopra i 10 € con tre pezzi, il carrello chiede ancora di aggiungere').not.toMatch(/Spesa sotto i/);
  });

  it('due negozi: l’avviso del negozio piccolo conta i suoi 3 pezzi da 1,15 €', async () => {
    const t = await carrello([
      { id: 'p-grande', prezzo: 12, negozio: 'neg-a', quantita: 1 },
      { id: 'p-piccolo', prezzo: 1.15, negozio: 'neg-b', quantita: 3 },
    ]);
    expect(t).toContain(avvisoSpesaPiccola(345)!);
    expect(t, 'accanto al negozio c’è la spesa di un pezzo solo').toContain(`Negozio neg-b · ${formatPrice(3.45)}`);
    expect(t.split('Spesa sotto i').length - 1, 'l’avviso compare anche per il negozio grande').toBe(1);
  });
});

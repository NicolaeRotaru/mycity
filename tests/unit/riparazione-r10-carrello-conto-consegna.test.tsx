/**
 * @vitest-environment jsdom
 */
/**
 * R10-025 — Buco nelle prove del carrello: alcune mutanti sul conto della
 * consegna in app/cart/page.tsx restavano verdi. Rifatte a mano il 12/11 contro
 * tutte le prove che montano il carrello, sopravvivevano:
 *  · il subtotale di un negozio arrotondato per difetto (Math.floor al posto di
 *    Math.round: 1,15 € × 100 = 114,999… → 114 centesimi);
 *  · l'avviso «spesa sotto i 10 €» letto sempre dal primo negozio;
 *  · latitudine e longitudine del negozio scambiate (l'avviso «troppo lontano»).
 * Le prove di prima giravano senza coordinate né banca dati, e con un negozio
 * solo. Qui il carrello è quello VERO, con una banca dati finta che risponde.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from 'react';
import CartPage from '@/app/cart/page';
import { avvisoSpesaPiccola } from '@/lib/promesse-pubbliche';
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

type Riga = { id: string; prezzo: number; negozio: string };

async function carrello(righe: Riga[]): Promise<string> {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(new Date(2026, 9, 30, 14, 0));
  for (const r of righe) stato.prezzi[r.id] = r.prezzo;
  sessioneNeiCookie();
  localStorage.setItem('cart', JSON.stringify(righe.map((r) => ({
    id: r.id, name: `Prodotto ${r.id}`, price: r.prezzo, quantity: 1, sellerId: r.negozio, storeName: `Negozio ${r.negozio}`,
  }))));
  schermo = accendi(CartPage);
  for (let i = 0; i < 12; i++) {
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }
  return schermo.radice.textContent ?? '';
}

const PIAZZA_CAVALLI = { lat: 45.0526, lng: 9.6929 };
const VIA_EMILIA = { lat: 45.0441, lng: 9.7046 }; // a circa 1,3 km

describe('R10-025 — il conto della consegna nel carrello, coi casi che le prove non guardavano', () => {
  it('l’avviso «spesa sotto i 10 €» è del negozio piccolo, con i centesimi giusti', async () => {
    const t = await carrello([
      { id: 'p-grande', prezzo: 12, negozio: 'neg-a' },
      { id: 'p-piccolo', prezzo: 1.15, negozio: 'neg-b' },
    ]);
    const giusto = avvisoSpesaPiccola(115)!;
    expect(t, 'l’avviso del secondo negozio manca o legge la spesa del primo').toContain(giusto);
    expect(t.split(giusto).length - 1, 'l’avviso compare per il negozio sbagliato').toBe(1);
    expect(t, 'il subtotale del negozio è arrotondato per difetto').not.toContain(avvisoSpesaPiccola(114)!);
  });

  it('negozio e casa a un chilometro: nessun avviso «troppo lontano»', async () => {
    stato.negozi = new Map([['neg-a', { id: 'neg-a', store_lat: PIAZZA_CAVALLI.lat, store_lng: PIAZZA_CAVALLI.lng }]]);
    stato.casa = VIA_EMILIA;
    const t = await carrello([{ id: 'p-pane', prezzo: 12, negozio: 'neg-a' }]);
    expect(t, 'controprova: il carrello si deve disegnare').toContain('Prodotto p-pane');
    expect(t, 'un indirizzo a un chilometro risulta fuori zona').not.toMatch(/troppo lontano/);
  });

  it('casa a Milano: l’avviso «troppo lontano» c’è', async () => {
    stato.negozi = new Map([['neg-a', { id: 'neg-a', store_lat: PIAZZA_CAVALLI.lat, store_lng: PIAZZA_CAVALLI.lng }]]);
    stato.casa = { lat: 45.4642, lng: 9.19 };
    const t = await carrello([{ id: 'p-pane', prezzo: 12, negozio: 'neg-a' }]);
    expect(t).toMatch(/troppo lontano/);
  });
});

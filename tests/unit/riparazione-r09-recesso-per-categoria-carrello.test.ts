/**
 * @vitest-environment jsdom
 */
/**
 * 27/11/2026 (R09-015) — IL CARRELLO DICEVA «ESCLUSI DAL RECESSO» SOLO CON LA SPUNTA.
 *
 * Con dentro solo prodotti esclusi il carrello dice l'esclusione invece di «Reso entro 14 giorni».
 * Ma «escluso» voleva dire solo `non_recedibile` (la spunta del negozio, che parte spenta): un
 * carrello di solo pane del Panificio, senza spunta, prometteva il reso prima dell'acquisto
 * (art. 49 c.1 lett. m Cod. Cons.), e la rotta dei resi poi lo rifiutava per la categoria.
 *
 * Qui il carrello VERO, con una banca dati finta che risponde come PostgREST.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from 'react';
import CartPage from '@/app/cart/page';
import { RESO_CARRELLO, RESO_CARRELLO_TUTTI_ESCLUSI } from '@/lib/promesse-pubbliche';
import { accendi } from './aiuti/schermo';

const stato = vi.hoisted(() => ({
  prodotti: [] as Array<Record<string, unknown>>,
  categorie: [] as Array<Record<string, unknown>>,
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
vi.mock('@/lib/queries/seller-public-profiles', () => ({ fetchSellerPublicMap: async () => new Map() }));
// L'import pigro del database, dentro la pagina, sfugge a vi.mock: nasce il client VERO su un
// indirizzo finto, e la rete finta qui sotto risponde come PostgREST.
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.finto.invalid';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'chiave-finta';
const reteDiPartenza = globalThis.fetch;
const json = (dati: unknown) => new Response(JSON.stringify(dati), { status: 200, headers: { 'content-type': 'application/json' } });
globalThis.fetch = (async (input: unknown) => {
  const url = String(typeof input === 'object' && input !== null && 'url' in input ? (input as { url: unknown }).url : input);
  if (url.includes('/api/consegna/veloce')) return json({ possibile: true });
  if (url.includes('/rest/v1/products')) return json(stato.prodotti);
  if (url.includes('/rest/v1/categories')) return json(stato.categorie);
  if (url.includes('/rest/v1/')) return json([]);
  return new Response('', { status: 503 });
}) as unknown as typeof fetch;
process.on('exit', () => { globalThis.fetch = reteDiPartenza; });

/** Panificio → «Pane di casa» (una sottocategoria creata dal pannello), e il miele fuori dai freschi. */
const CATEGORIE = [
  { id: 'cat-panificio', slug: 'panificio', parent_id: null },
  { id: 'cat-pane-di-casa', slug: 'pane-di-casa', parent_id: 'cat-panificio' },
  { id: 'cat-miele', slug: 'alimentari-miele', parent_id: null },
];

let schermo: ReturnType<typeof accendi> | null = null;
afterEach(() => {
  schermo?.smonta();
  schermo = null;
  localStorage.clear();
  vi.useRealTimers();
  stato.prodotti = [];
  stato.categorie = [];
});

type Riga = { id: string; nome: string; categoria: string | null; spunta: boolean };

async function carrello(righe: Riga[]): Promise<string> {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(new Date('2026-11-27T10:00:00Z'));
  stato.categorie = CATEGORIE;
  stato.prodotti = righe.map((r) => ({ id: r.id, stock: 50, price: 4.5, category_id: r.categoria, non_recedibile: r.spunta }));
  localStorage.setItem('cart', JSON.stringify(righe.map((r) => ({
    id: r.id, name: r.nome, price: 4.5, quantity: 1, sellerId: 'neg-a', storeName: 'Forno Piacenza',
  }))));
  schermo = accendi(CartPage);
  for (let i = 0; i < 12; i++) {
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }
  return schermo.radice.textContent ?? '';
}

describe('R09-015 — il carrello dice «esclusi dal recesso» anche per la categoria', () => {
  it('IL CASO CHE ROMPEVA — solo pane del Panificio, senza spunta: niente «Reso entro 14 giorni»', async () => {
    const t = await carrello([
      { id: 'p-filone', nome: 'Filone', categoria: 'cat-pane-di-casa', spunta: false },
      { id: 'p-michetta', nome: 'Michetta', categoria: 'cat-panificio', spunta: false },
    ]);
    expect(t, 'controprova: il carrello si deve disegnare').toContain('Filone');
    expect(t, 'il pane escluso per categoria non dice l’esclusione prima dell’acquisto').toContain(RESO_CARRELLO_TUTTI_ESCLUSI);
  }, 30_000);

  it('controprova: il pane col miele (non escluso) dice il termine e rimanda agli esclusi', async () => {
    const t = await carrello([
      { id: 'p-filone', nome: 'Filone', categoria: 'cat-pane-di-casa', spunta: false },
      { id: 'p-miele', nome: 'Miele di acacia', categoria: 'cat-miele', spunta: false },
    ]);
    expect(t).toContain('Miele di acacia');
    expect(t).toContain(RESO_CARRELLO);
    expect(t).not.toContain(RESO_CARRELLO_TUTTI_ESCLUSI);
  }, 30_000);
});

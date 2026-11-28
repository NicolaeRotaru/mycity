import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { databaseDellaVetrina, DOPO, OGGI, type Dati } from './aiuti/database-della-vetrina';

/**
 * R03-013 — Il finto condiviso della vetrina (`aiuti/database-della-vetrina.ts`) non conosceva
 * l'aggancio storie → vista dei negozi: alla domanda nuova del carosello
 * (`negozio:seller_public_profiles!inner(id)`) rispondeva PGRST200, e le prove che lo usano
 * coprivano solo il ripiego (200 storie, poi il filtro), mai la strada nuova.
 *
 * ① il finto risponde all'aggancio, con la regola di `!inner` (le storie dei negozi fuori vetrina
 *   non escono, e vengono scartate PRIMA del tetto, come in Postgres);
 * ② il carosello vero, letto col finto, passa dalla strada nuova: una sola lettura delle storie.
 */

const PANE = 'n-pane';
const SEGRETA = 'n-segreta';
const ADESSO = new Date('2026-11-17T10:00:00Z');
const DOMANI = '2026-11-18T10:00:00Z';

/** Trentuno storie recenti di un negozio fuori vetrina, e una più vecchia di un negozio in vetrina. */
function dati(): Dati {
  return {
    profiles: [
      { id: PANE, role: 'seller', is_approved: true, store_name: 'Pane Quotidiano', store_logo: 'logo-pane.png' },
      { id: SEGRETA, role: 'seller', is_approved: false, store_name: 'Bottega Segreta', store_logo: null },
    ],
    seller_stories: [
      ...Array.from({ length: 31 }, (_, i) => ({
        id: `s-segreta-${i}`, seller_id: SEGRETA, image_url: `segreta-${i}.jpg`, caption: null, link_url: null,
        view_count: 0, expires_at: DOMANI, created_at: `2026-11-17T09:${String(i).padStart(2, '0')}:00Z`,
      })),
      { id: 's-pane', seller_id: PANE, image_url: 'pane.jpg', caption: 'Appena sfornato', link_url: null, view_count: 2, expires_at: DOMANI, created_at: '2026-11-17T07:00:00Z' },
    ],
  };
}

const cattura = vi.hoisted(() => ({
  client: null as unknown,
  queryFn: null as null | (() => Promise<unknown>),
}));
vi.mock('@/lib/supabase/client', () => ({
  supabase: new Proxy({}, { get: (_t, k) => (cattura.client as Record<string | symbol, unknown>)[k] }),
}));
vi.mock('@tanstack/react-query', () => ({
  useQuery: (o: { queryFn: () => Promise<unknown> }) => {
    cattura.queryFn = o.queryFn;
    return { data: [] };
  },
  // R09-008 — Le sezioni della home leggono i negozi dalla cache della pagina: una cache vuota.
  useQueryClient: () => ({ getQueryState: () => undefined, getQueryData: () => undefined, setQueryData: () => undefined }),
}));
vi.mock('@/lib/logger', () => ({ logger: { warn: () => {}, error: () => {}, info: () => {}, debug: () => {} } }));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(ADESSO);
  cattura.client = null;
  cattura.queryFn = null;
});
afterEach(() => {
  vi.useRealTimers();
});

describe('R03-013 ① — il finto della vetrina conosce l’aggancio storie → vista dei negozi', () => {
  it.each([[DOPO.nome, DOPO], [OGGI.nome, OGGI]])(
    'la domanda del carosello ha risposta, solo coi negozi in vetrina, scartati prima del tetto — %s',
    async (_n, mondo) => {
      const db = databaseDellaVetrina(dati(), mondo, null);
      const { data, error } = await db.client
        .from('seller_stories')
        .select('id, seller_id, image_url, caption, link_url, view_count, expires_at, negozio:seller_public_profiles!inner(id)')
        .gt('expires_at', ADESSO.toISOString())
        .order('created_at', { ascending: false })
        .limit(30);
      expect(error, 'il finto non conosce l’aggancio storie → vista dei negozi').toBeNull();
      expect(data).toEqual([
        {
          id: 's-pane', seller_id: PANE, image_url: 'pane.jpg', caption: 'Appena sfornato', link_url: null,
          view_count: 2, expires_at: DOMANI, negozio: { id: PANE },
        },
      ]);
    },
  );
});

describe('R03-013 ② — il carosello vero, col finto, passa dalla strada nuova', () => {
  it('una sola lettura delle storie, con l’aggancio alla vista: niente ripiego', async () => {
    const db = databaseDellaVetrina(dati(), DOPO, null);
    cattura.client = db.client;
    const { default: StoriesCarousel } = await import('@/components/home/StoriesCarousel');
    renderToString(createElement(StoriesCarousel));
    expect(cattura.queryFn, 'il carosello non ha chiesto le storie').toBeTypeOf('function');

    const storie = (await cattura.queryFn!()) as Array<{ id: string; seller: { store_name: string | null } }>;
    expect(storie.map((s) => [s.id, s.seller.store_name])).toEqual([['s-pane', 'Pane Quotidiano']]);

    const lettureStorie = db.letture.filter((l) => l.tabella === 'seller_stories');
    expect(
      lettureStorie.map((l) => l.colonne.includes('seller_public_profiles!inner')),
      'il carosello è passato dal ripiego: il finto ha rifiutato la domanda nuova',
    ).toEqual([true]);
  });
});

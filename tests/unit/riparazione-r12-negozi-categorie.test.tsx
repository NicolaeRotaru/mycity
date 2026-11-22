/**
 * @vitest-environment jsdom
 */
/**
 * R12 — LA PAGINA DEI NEGOZI E LE SUE CATEGORIE.
 *
 * 1. Le categorie per negozio (`categorie_per_negozio`, una riga per negozio coi prodotti) si
 *    leggevano con una domanda sola: il servizio dati ne restituisce al massimo mille (max_rows) e
 *    non lo dice. Sopra i mille negozi coi prodotti, quelli dopo la millesima riga perdevano le loro
 *    categorie e col filtro del loro settore sparivano. Qui il finto taglia a mille come quello vero:
 *    1.101 righe, e il negozio in vetrina sta dopo la millesima.
 *
 * 2. Se la lettura delle categorie cadeva, i filtri per settore sparivano e la pagina non diceva
 *    niente: chi cercava «Panificio» non capiva perché il filtro non c'era. Adesso un avviso breve.
 *
 * La pagina si monta col react-query vero: la lettura dei dati gira davvero.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { creaPostgrestColTetto, TETTO_RIGHE, type Riga } from './aiuti/riparazione-r06-postgrest-col-tetto';

const categorie: Riga[] = [
  { id: 'm-pan', slug: 'panificio', name: 'Panificio', parent_id: null, icon: null },
  { id: 'm-fio', slug: 'fiori', name: 'Fiori', parent_id: null, icon: null },
];

const negozio = (id: string, nome: string) => ({
  id, store_name: nome, store_phone: null, store_address: 'Via Roma 1', store_lat: null, store_lng: null,
  store_logo: null, store_hours: null, store_media: null, is_approved: true, stripe_charges_enabled: true, stripe_payouts_enabled: true,
});

// Mille e cento negozi coi prodotti che non sono in vetrina, e in fondo i due che lo sono.
const righeCategorie: Riga[] = [
  { seller_id: 'a-vicino', categorie: ['m-pan'] },
  ...Array.from({ length: 1100 }, (_, i) => ({ seller_id: `b-${String(i).padStart(4, '0')}`, categorie: ['m-fio'] })),
  { seller_id: 'z-lontano', categorie: ['m-pan'] },
];

const stato = { erroreCategorie: false, errorePerNegozio: false };
const pg = creaPostgrestColTetto({
  categories: categorie,
  seller_public_profiles: [negozio('a-vicino', 'Forno Vicino'), negozio('z-lontano', 'Forno Lontano')],
});
const lettureRpc: Array<{ finestra: [number, number] | null; ordini: string[] }> = [];

/** Un finto `rpc('categorie_per_negozio')`: ordine, finestra e il tetto di mille come PostgREST. */
function rpcCategorie() {
  const ordini: string[] = [];
  let finestra: [number, number] | null = null;
  const q = {
    order(c: string) { ordini.push(c); return q; },
    range(da: number, a: number) { finestra = [da, a]; return q; },
    then<T>(risolvi: (v: { data: Riga[]; error: null }) => T, rifiuta?: (e: unknown) => unknown) {
      lettureRpc.push({ finestra, ordini: [...ordini] });
      if (stato.errorePerNegozio) {
        return Promise.resolve({ data: null, error: { message: 'servizio dati giù' } }).then(risolvi as never, rifiuta);
      }
      let righe = [...righeCategorie];
      if (ordini.includes('seller_id')) righe.sort((x, y) => String(x.seller_id).localeCompare(String(y.seller_id)));
      if (finestra) righe = righe.slice(finestra[0], finestra[1] + 1);
      return Promise.resolve({ data: righe.slice(0, TETTO_RIGHE), error: null }).then(risolvi, rifiuta);
    },
  };
  return q;
}

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    from: (t: string) => {
      if (t === 'categories' && stato.erroreCategorie) {
        const q = {
          select: () => q, order: () => q, range: () => q,
          then: <T,>(r: (v: { data: null; error: { message: string } }) => T) =>
            Promise.resolve({ data: null, error: { message: 'servizio dati giù' } }).then(r),
        };
        return q;
      }
      return pg.client.from(t);
    },
    rpc: (nome: string) => {
      if (nome === 'categorie_per_negozio') return rpcCategorie();
      if (nome === 'store_cards') {
        return Promise.resolve({
          data: [{ seller_id: 'a-vicino', prodotti: [], totale: 3 }, { seller_id: 'z-lontano', prodotti: [], totale: 3 }],
          error: null,
        });
      }
      return Promise.resolve({ data: [], error: null });
    },
  },
}));
vi.mock('@/components/StorePreviewCard', async () => {
  const { createElement: ce } = await import('react');
  return { default: (p: { store: { store_name: string } }) => ce('article', null, p.store.store_name) };
});
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('next/link', async () => {
  const { createElement: ce } = await import('react');
  return { default: ({ href, children, ...r }: Record<string, unknown>) => ce('a', { href: String(href), ...r }, children as never) };
});

import StoresPage from '@/app/stores/page';

async function montaLaPagina() {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const radice = document.createElement('div');
  document.body.appendChild(radice);
  const root = createRoot(radice);
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client }, createElement(StoresPage)));
  });
  for (let i = 0; i < 40 && !radice.textContent?.includes('Forno Vicino'); i++) {
    await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
  }
  return { radice, smonta: () => act(() => root.unmount()) };
}

beforeEach(() => {
  stato.erroreCategorie = false;
  stato.errorePerNegozio = false;
  lettureRpc.length = 0;
  document.body.innerHTML = '';
});

describe('R12-012 — le categorie per negozio si leggono a finestre', () => {
  it('il negozio la cui riga viene dopo la millesima resta nel filtro del suo settore', async () => {
    const { radice, smonta } = await montaLaPagina();
    const bottoni = () => [...radice.querySelectorAll('button')];
    const panificio = bottoni().find((b) => b.textContent?.trim() === 'Panificio');
    expect(panificio, 'controprova: i filtri delle categorie si disegnano').toBeTruthy();

    await act(async () => { panificio!.click(); });
    expect(radice.textContent, 'controprova: il negozio della prima riga c\'è').toContain('Forno Vicino');
    expect(
      radice.textContent,
      'il negozio dopo la millesima riga di categorie_per_negozio è sparito dal filtro: la lettura si è fermata a mille',
    ).toContain('Forno Lontano');
    smonta();
  }, 60000);
});

describe('R12-013 — se la lettura delle categorie cade, la pagina lo dice', () => {
  const avviso = (radice: HTMLElement) =>
    [...radice.querySelectorAll('[role="status"]')].find((n) => /settori/i.test(n.textContent ?? ''));

  it('controprova: con le categorie lette non c\'è nessun avviso', async () => {
    const { radice, smonta } = await montaLaPagina();
    expect(radice.textContent).toContain('Forno Vicino');
    expect(avviso(radice)).toBeUndefined();
    smonta();
  }, 60000);

  it('le categorie non arrivano: i filtri non ci sono, ma un avviso visibile lo spiega', async () => {
    stato.erroreCategorie = true;
    const { radice, smonta } = await montaLaPagina();
    expect(radice.textContent, 'controprova: i negozi si vedono lo stesso').toContain('Forno Vicino');
    expect([...radice.querySelectorAll('button')].some((b) => b.textContent?.trim() === 'Panificio')).toBe(false);
    expect(avviso(radice), 'i filtri per settore sono spariti senza nessun avviso').toBeTruthy();
    smonta();
  }, 60000);

  it('le categorie dei negozi non arrivano: anche qui l\'avviso', async () => {
    stato.errorePerNegozio = true;
    const { radice, smonta } = await montaLaPagina();
    expect(radice.textContent, 'controprova: i negozi si vedono lo stesso').toContain('Forno Vicino');
    expect(avviso(radice), 'il filtro per settore non trova più i negozi e la pagina non lo dice').toBeTruthy();
    smonta();
  }, 60000);
});

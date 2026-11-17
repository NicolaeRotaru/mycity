/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement, type ComponentType } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * R01-005 — Menu, piede, vetrina e pagina delle categorie mostrano solo le categorie con qualcosa
 * dentro. Ma quando una RILETTURA dell'elenco delle piene falliva, tutti e quattro scartavano
 * l'elenco già noto (`piene.isError ? null : piene.data`) e rimettevano in mostra le categorie
 * vuote: react-query, su una rilettura caduta, tiene `data` e accende `isError`.
 *
 * Qui gira il react-query vero: la prima lettura riesce (Alimentari è piena, Abbigliamento ed
 * Elettronica no), poi la rete cade e la rilettura fallisce. Le categorie vuote devono restare
 * fuori. La controprova: se la prima lettura in assoluto fallisce, si mostrano tutte, come prima.
 */
const mondo = vi.hoisted(() => ({
  prodottiCadono: false,
  categorie: [
    { id: 'c-ali', slug: 'alimentari', name: 'Alimentari', parent_id: null, icon: null },
    { id: 'c-forno', slug: 'forno', name: 'Forno', parent_id: 'c-ali', icon: null },
    { id: 'c-abb', slug: 'abbigliamento', name: 'Abbigliamento', parent_id: null, icon: null },
    { id: 'c-ele', slug: 'elettronica', name: 'Elettronica', parent_id: null, icon: null },
  ],
}));

vi.mock('@/lib/supabase/client', () => {
  const da = (tabella: string) => {
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'order', 'limit', 'gt', 'is', 'in']) q[m] = () => q;
    q.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
      let r: { data: unknown; error: unknown };
      if (tabella === 'products') {
        r = mondo.prodottiCadono
          ? { data: null, error: { message: 'rete caduta' } }
          : { data: [{ id: 'p1', category_id: 'c-forno', seller_id: 's1' }], error: null };
      } else if (tabella === 'seller_public_profiles') {
        r = { data: [{ id: 's1' }], error: null };
      } else {
        r = { data: mondo.categorie, error: null };
      }
      return Promise.resolve(r).then(ok, ko);
    };
    return q;
  };
  return { supabase: { from: da } };
});
vi.mock('next/link', async () => {
  const { createElement: ce } = await import('react');
  return { default: ({ href, children, ...resto }: { href: string; children: unknown }) => ce('a', { href, ...resto }, children) };
});
vi.mock('next/navigation', () => ({ usePathname: () => '/', useRouter: () => ({ push: () => {} }) }));
vi.mock('@/lib/logger', () => ({ logger: { warn: () => {}, error: () => {}, info: () => {}, debug: () => {} } }));
vi.mock('@/components/hooks/useProfile', () => ({
  useProfile: () => ({ isSeller: false, isRider: false, isAuthenticated: false }),
}));
vi.mock('@/components/hooks/useBranding', async () => {
  const { defaultBranding } = await import('@/lib/site-branding');
  return { useBranding: () => defaultBranding() };
});
vi.mock('@/components/NewsletterForm', () => ({ default: () => null }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const CHIAVE_PIENE = ['categories', 'con-prodotti'];

let radice: Root | null = null;
let div: HTMLDivElement | null = null;
let client: QueryClient;

/** Aspetta che le letture finiscano, e poi un giro ancora perché React disegni le risposte. */
async function finché(condizione: () => boolean) {
  for (let i = 0; i < 50 && !condizione(); i += 1) {
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  }
  await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
}
const quieto = () => client.isFetching() === 0;

async function disegna(Componente: ComponentType) {
  div = document.createElement('div');
  document.body.appendChild(div);
  radice = createRoot(div);
  await act(async () => {
    radice!.render(createElement(QueryClientProvider, { client }, createElement(Componente)));
  });
  await finché(() => quieto() && client.getQueryState(CHIAVE_PIENE)?.status !== 'pending');
}
const link = (slug: string) => div!.querySelector(`a[href="/category/${slug}"]`);

/** La rete cade e la lista delle piene si rilegge: fallisce, ma react-query tiene quella già nota. */
async function rilettaCaduta() {
  mondo.prodottiCadono = true;
  await act(async () => { await client.refetchQueries({ queryKey: CHIAVE_PIENE }); });
  await finché(quieto);
  const stato = client.getQueryState<string[]>(CHIAVE_PIENE)!;
  expect(stato.status, 'controprova: la rilettura delle piene deve essere fallita').toBe('error');
  expect(stato.data, 'controprova: react-query tiene l\'elenco già noto').toEqual(expect.arrayContaining(['c-ali']));
}

beforeEach(() => {
  mondo.prodottiCadono = false;
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // La vetrina in home legge le categorie dalla rotta in cache: qui risponde lei.
  vi.stubGlobal('fetch', async () => new Response(
    JSON.stringify(mondo.categorie.filter((c) => c.parent_id === null)),
    { status: 200, headers: { 'content-type': 'application/json' } },
  ));
});

afterEach(() => {
  act(() => radice?.unmount());
  div?.remove();
  client.clear();
  vi.unstubAllGlobals();
});

async function apriIlMenu() {
  const pulsante = [...div!.querySelectorAll('button')].find((b) => /Tutte le categorie/.test(b.textContent ?? ''));
  expect(pulsante, 'controprova: il pulsante «Tutte le categorie» deve essere a video').toBeTruthy();
  await act(async () => { pulsante!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
}

describe('R01-005 · una rilettura caduta non rimette in mostra le categorie vuote', () => {
  it('il menu «Tutte le categorie»', async () => {
    const { default: CategoryBar } = await import('@/components/CategoryBar');
    await disegna(CategoryBar);
    await apriIlMenu();
    expect(link('alimentari')).not.toBeNull();
    expect(link('abbigliamento'), 'controprova: prima della caduta Abbigliamento (vuota) non c\'è').toBeNull();
    await rilettaCaduta();
    expect(link('alimentari')).not.toBeNull();
    expect(link('abbigliamento'), 'dopo la rilettura caduta il menu rimette Abbigliamento, vuota').toBeNull();
    expect(link('elettronica')).toBeNull();
  });

  it('il piede della pagina', async () => {
    const { default: Footer } = await import('@/components/Footer');
    await disegna(Footer);
    expect(link('alimentari')).not.toBeNull();
    expect(link('abbigliamento'), 'controprova: prima della caduta Abbigliamento (vuota) non c\'è').toBeNull();
    await rilettaCaduta();
    expect(link('alimentari')).not.toBeNull();
    expect(link('abbigliamento'), 'dopo la rilettura caduta il piede rimette Abbigliamento, vuota').toBeNull();
    expect(link('elettronica')).toBeNull();
  });

  it('la vetrina delle categorie in home', async () => {
    const { default: CategoryShowcase } = await import('@/components/CategoryShowcase');
    await disegna(CategoryShowcase);
    expect(link('alimentari')).not.toBeNull();
    expect(link('abbigliamento'), 'controprova: prima della caduta Abbigliamento (vuota) non c\'è').toBeNull();
    await rilettaCaduta();
    expect(link('alimentari')).not.toBeNull();
    expect(link('abbigliamento'), 'dopo la rilettura caduta la vetrina rimette Abbigliamento, vuota').toBeNull();
    expect(link('elettronica')).toBeNull();
  });

  it('la pagina /categorie', async () => {
    const { default: CategoriePage } = await import('@/app/categorie/page');
    await disegna(CategoriePage);
    expect(link('alimentari')).not.toBeNull();
    expect(link('abbigliamento'), 'controprova: prima della caduta Abbigliamento (vuota) non c\'è').toBeNull();
    await rilettaCaduta();
    expect(link('alimentari')).not.toBeNull();
    expect(link('abbigliamento'), 'dopo la rilettura caduta la pagina rimette Abbigliamento, vuota').toBeNull();
    expect(link('elettronica')).toBeNull();
  });

  it('controprova: se la prima lettura in assoluto fallisce, il piede le elenca tutte come prima', async () => {
    mondo.prodottiCadono = true;
    const { default: Footer } = await import('@/components/Footer');
    await disegna(Footer);
    expect(client.getQueryState(CHIAVE_PIENE)?.status).toBe('error');
    expect(link('alimentari')).not.toBeNull();
    expect(link('abbigliamento')).not.toBeNull();
  });
});

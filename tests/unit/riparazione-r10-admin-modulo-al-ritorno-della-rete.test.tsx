/**
 * @vitest-environment jsdom
 */
/**
 * R10-013 — Nella modifica prodotto dell'amministratore:
 *  ① aperta senza rete con prodotto, taglie e categorie in memoria, al ritorno della rete le letture
 *    ripartivano e il caricamento prendeva il posto del modulo: il modulo si smontava e quello che
 *    l'amministratore aveva scritto spariva;
 *  ② aperta senza rete con il prodotto in memoria ma non le taglie, il modulo si apriva con 0 taglie
 *    (la lettura «in pausa» non è né caricamento né errore, e il ripiego era `[]`).
 * E il caso accanto: senza rete e senza il prodotto in memoria la pagina diceva «Prodotto non
 * trovato». Qui la pagina VERA, con React Query vero messo senza rete (`onlineManager`), e un modulo
 * finto che tiene quello che si scrive come lo tiene il modulo vero (stato suo, perso se si smonta).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queries/keys';

type Riga = Record<string, unknown>;

const stato = vi.hoisted(() => ({
  tabelle: {} as Record<string, Array<Record<string, unknown>>>,
  aperture: [] as Array<{ taglie: number; categorie: number }>,
  smontaggi: 0,
  /** La rete vera ci mette un po': le risposte arrivano dopo questi millisecondi. */
  ritardo: 0,
}));

const conLaRete = <T,>(valore: T): Promise<T> =>
  new Promise((ok) => setTimeout(() => ok(valore), stato.ritardo));

vi.mock('react', async (importOriginal) => {
  const vero = await importOriginal<typeof import('react')>();
  return { ...vero, use: (p: { valore: unknown }) => p.valore };
});
vi.mock('next-intl', async (importOriginal) => {
  const vero = await importOriginal<Record<string, unknown>>();
  const t = Object.assign((k: string) => k, { rich: (k: string) => k, raw: (k: string) => k, has: () => true });
  return { ...vero, useTranslations: () => t, useLocale: () => 'it' };
});
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined, back: () => undefined, refresh: () => undefined }),
  usePathname: () => '/admin/products',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/link', async () => {
  const { createElement: crea } = await vi.importActual<typeof import('react')>('react');
  return { default: ({ href, children }: { href: unknown; children?: ReactNode }) => crea('a', { href: String(href) }, children) };
});
vi.mock('sonner', () => ({ toast: Object.assign(() => undefined, { success: () => undefined, error: () => undefined }) }));
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: null } }) },
    from: (tavola: string) => ({
      select() {
        const filtri: Array<[string, unknown]> = [];
        const trova = () => (stato.tabelle[tavola] ?? []).filter((r) => filtri.every(([c, v]) => r[c] === v)).map((r) => ({ ...r }));
        const catena = {
          eq: (c: string, v: unknown) => (filtri.push([c, v]), catena),
          order: () => catena,
          maybeSingle: () => conLaRete({ data: trova()[0] ?? null, error: null }),
          then: (ok: (r: unknown) => unknown, ko?: (e: unknown) => unknown) => conLaRete({ data: trova(), error: null }).then(ok, ko),
        };
        return catena;
      },
    }),
  },
}));
vi.mock('@/lib/products/persistVariants', () => ({
  loadProductVariants: () =>
    conLaRete([
      { id: 'v-m', options: { Taglia: 'M' }, label: 'M', stock: 3, position: 0 },
      { id: 'v-l', options: { Taglia: 'L' }, label: 'L', stock: 2, position: 1 },
    ]),
}));
vi.mock('@/components/admin/ExternalDataPanel', () => ({ default: () => null }));
vi.mock('@/components/seller/ProductForm', async () => {
  const R = await vi.importActual<typeof import('react')>('react');
  return {
    default: function ModuloFinto(props: { categories: unknown[]; initialValues?: { variants?: unknown[]; name?: string } }) {
      const [nome, setNome] = R.useState(props.initialValues?.name ?? '');
      R.useEffect(() => {
        stato.aperture.push({ taglie: props.initialValues?.variants?.length ?? 0, categorie: props.categories.length });
        return () => {
          stato.smontaggi += 1;
        };
      }, []);
      return R.createElement(
        'div',
        { 'data-modulo': '' },
        R.createElement('output', { 'data-nome': '' }, nome),
        R.createElement('button', { type: 'button', onClick: () => setNome('Maglietta in cotone biologico') }, 'scrivi'),
      );
    },
  };
});

const ID = '11111111-1111-4111-8111-111111111111';
const CATEGORIE = [{ id: 'cat-1', name: 'Abbigliamento', slug: 'abbigliamento', parent_id: null }];
const TAGLIE = [
  { id: 'v-m', options: { Taglia: 'M' }, label: 'M', stock: 3, position: 0 },
  { id: 'v-l', options: { Taglia: 'L' }, label: 'L', stock: 2, position: 1 },
];

function maglietta(): Riga {
  return {
    id: ID, seller_id: 'seller-1', name: 'Maglietta', description: 'Cotone pesante.', price: 18, compare_at_price: null,
    unit: 'pezzo', condition: 'new', stock: 5, category_id: 'cat-1', images: [], attributes: {}, tags: [],
    express_enabled: null, status: 'available',
  };
}

let root: Root | null = null;
let radice: HTMLElement | null = null;

async function finche(condizione: () => boolean) {
  for (let i = 0; i < 80 && !condizione(); i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
  }
}

async function giri(n: number) {
  for (let i = 0; i < n; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
  }
}

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  stato.tabelle = { categories: CATEGORIE, products: [maglietta()] };
  stato.aperture = [];
  stato.smontaggi = 0;
  stato.ritardo = 0;
  radice = document.createElement('div');
  document.body.appendChild(radice);
  root = createRoot(radice);
});

afterEach(() => {
  act(() => root?.unmount());
  radice?.remove();
  onlineManager.setOnline(true);
});

/** Apre la pagina senza rete, con in memoria quello che `memoria` dice (le categorie sempre). */
async function apriSenzaRete(memoria: { prodotto: boolean; taglie: boolean }) {
  const { default: Pagina } = await import('@/app/admin/products/[id]/edit/page');
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (memoria.prodotto) qc.setQueryData(queryKeys.admin.product(ID), maglietta());
  if (memoria.taglie) qc.setQueryData([...queryKeys.admin.product(ID), 'variants'], TAGLIE);
  qc.setQueryData(queryKeys.categories.form, CATEGORIE);
  onlineManager.setOnline(false);
  act(() =>
    root!.render(createElement(QueryClientProvider, { client: qc }, createElement(Pagina as never, { params: { valore: { id: ID } } }))),
  );
  await finche(() => stato.aperture.length > 0 || (radice!.textContent ?? '').includes('Errore'));
}

const testo = () => radice!.textContent ?? '';
const riprova = () => Array.from(radice!.querySelectorAll('button')).find((b) => b.textContent === 'Riprova');

describe('R10-013 — la modifica prodotto dell\'amministratore senza rete e al ritorno della rete', () => {
  it('al ritorno della rete il modulo aperto resta montato, con quello che si è scritto', async () => {
    await apriSenzaRete({ prodotto: true, taglie: true });
    expect(radice!.querySelector('[data-modulo]'), 'con prodotto e taglie in memoria il modulo si apre').not.toBeNull();
    const scrivi = Array.from(radice!.querySelectorAll('button')).find((b) => b.textContent === 'scrivi')!;
    act(() => scrivi.click());
    expect(radice!.querySelector('[data-nome]')?.textContent).toBe('Maglietta in cotone biologico');

    // La rete torna, e le letture ripartite ci mettono un momento (come sul telefono vero).
    stato.ritardo = 40;
    act(() => onlineManager.setOnline(true));
    await giri(20);

    expect(stato.smontaggi, 'il caricamento ha preso il posto del modulo: le modifiche sono andate perse').toBe(0);
    expect(radice!.querySelector('[data-nome]')?.textContent).toBe('Maglietta in cotone biologico');
  });

  it('taglie non in memoria: senza rete il modulo non si apre con 0 taglie, la pagina lo dice e offre «Riprova»', async () => {
    await apriSenzaRete({ prodotto: true, taglie: false });
    expect(stato.aperture, 'il modulo si è aperto con 0 taglie: al «Salva» andrebbero perse').toEqual([]);
    expect(testo()).toMatch(/Senza rete/);
    expect(testo()).toMatch(/taglie/);
    expect(riprova()).toBeDefined();
  });

  it('quando la rete torna le taglie si leggono e il modulo si apre con tutte e due', async () => {
    await apriSenzaRete({ prodotto: true, taglie: false });
    act(() => onlineManager.setOnline(true));
    await finche(() => stato.aperture.length > 0);
    expect(stato.aperture).toEqual([{ taglie: 2, categorie: 1 }]);
  });

  it('il caso accanto: senza rete e senza il prodotto in memoria non dice «Prodotto non trovato»', async () => {
    await apriSenzaRete({ prodotto: false, taglie: false });
    expect(stato.aperture).toEqual([]);
    expect(testo()).not.toMatch(/Prodotto non trovato/);
    expect(testo()).toMatch(/Senza rete/);
    expect(riprova()).toBeDefined();
  });
});

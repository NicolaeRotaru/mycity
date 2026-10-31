/**
 * @vitest-environment jsdom
 */
/**
 * 31/10/2026 (collaudo dell'ondata 4) — DOPO «LA SCORTA E' CAMBIATA» SI PUO' DAVVERO RIPROVARE.
 *
 * La porta del catalogo ferma la scorta quando in banca dati non c'e' piu' il numero visto.
 * Il messaggio dice «riapri il prodotto, controlla il numero e salva di nuovo». Due pagine
 * non lo permettevano:
 *
 * - la MODIFICA IN BLOCCO dell'elenco restava sui numeri vecchi: al nuovo «Salva» rimandava
 *   anche i prodotti gia' salvati, e la scorta in conflitto ripartiva con la vista vecchia.
 *   Ogni «Salva» falliva, per sempre;
 * - il MODULO del prodotto (negoziante e amministrazione) si riapriva con la copia in memoria,
 *   letta prima della vendita: la scorta vista era ancora quella vecchia, e l'errore tornava.
 *
 * Le pagine sono quelle VERE, montate con React Query vero. Il modulo e la rete sono finti;
 * la porta di scrittura e' quella vera (`salvaProdottoTracciato`) su una banca dati finta.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import QueryProvider from '@/components/providers/QueryProvider';
import { queryKeys } from '@/lib/queries/keys';

type Riga = Record<string, unknown>;

const stato = vi.hoisted(() => ({
  tabelle: {} as Record<string, Array<Record<string, unknown>>>,
  aperture: [] as unknown[],
  invia: null as null | ((stock: number) => void),
  errori: [] as string[],
  successi: [] as string[],
}));

function bancaDati() {
  return {
    from(tavola: string) {
      const righe = () => stato.tabelle[tavola] ?? [];
      return {
        select() {
          const filtri: Array<[string, unknown]> = [];
          const trova = () => righe().filter((r) => filtri.every(([c, v]) => r[c] === v)).map((r) => ({ ...r }));
          const catena = {
            eq(c: string, v: unknown) {
              filtri.push([c, v]);
              return catena;
            },
            order: () => catena,
            range: () => catena,
            async single() {
              return { data: trova()[0] ?? null, error: null };
            },
            async maybeSingle() {
              return { data: trova()[0] ?? null, error: null };
            },
            then(ok: (r: unknown) => unknown, ko?: (e: unknown) => unknown) {
              const data = trova();
              return Promise.resolve({ data, error: null, count: data.length }).then(ok, ko);
            },
          };
          return catena;
        },
        update(valori: Riga) {
          const filtri: Array<[string, unknown]> = [];
          const applica = () => {
            const colpite = righe().filter((r) => filtri.every(([c, v]) => r[c] === v));
            colpite.forEach((r) => Object.assign(r, valori));
            return colpite;
          };
          const catena = {
            eq(c: string, v: unknown) {
              filtri.push([c, v]);
              return catena;
            },
            async select() {
              return { data: applica().map((r) => ({ id: r.id })), error: null };
            },
            then(ok: (r: unknown) => unknown, ko?: (e: unknown) => unknown) {
              applica();
              return Promise.resolve({ error: null }).then(ok, ko);
            },
          };
          return catena;
        },
      };
    },
  };
}

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
  usePathname: () => '/seller/products',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/link', async () => {
  const { createElement: crea } = await vi.importActual<typeof import('react')>('react');
  return { default: ({ href, children }: { href: unknown; children?: ReactNode }) => crea('a', { href: String(href) }, children) };
});
vi.mock('next/image', async () => {
  const { createElement: crea } = await vi.importActual<typeof import('react')>('react');
  return { default: ({ alt }: { alt?: string }) => crea('img', { alt: alt ?? '' }) };
});
vi.mock('sonner', () => ({
  toast: Object.assign(() => undefined, {
    success: (m: string) => stato.successi.push(String(m)),
    error: (m: string) => stato.errori.push(String(m)),
    message: () => undefined,
    info: () => undefined,
  }),
}));
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: {
      getUser: async () => ({ data: { user: { id: 'seller-1' } } }),
      getSession: async () => ({ data: { session: { access_token: 'gettone' } } }),
    },
    from: (t: string) => bancaDati().from(t),
    rpc: async () => ({ data: [], error: null }),
  },
}));
// La porta vera del catalogo, dietro una rete finta: l'errore arriva come testo, come dalla rotta.
vi.mock('@/lib/products/salva-dal-browser', () => ({
  salvaProdottoDalBrowser: async (o: { prodottoId: string; payload: Riga; origine: string }) => {
    const { salvaProdottoTracciato } = await import('@/lib/products/salvataggio-tracciato');
    try {
      const esito = await salvaProdottoTracciato({
        db: bancaDati() as never,
        prodottoId: o.prodottoId,
        attoreId: 'seller-1',
        payload: o.payload,
        origine: o.origine,
        scriviTraccia: () => undefined,
      });
      return esito.campi;
    } catch (e) {
      throw new Error((e as Error).message);
    }
  },
}));
vi.mock('@/lib/products/persistVariants', () => ({ loadProductVariants: async () => [] }));
vi.mock('@/lib/products/persistVariantsServer', () => ({ saveProductVariantsServer: async () => undefined }));
vi.mock('@/lib/queries/consegna-veloce-del-negozio', () => ({
  useConsegnaVeloceDelNegozio: () => ({ offre: false, inLettura: false, nonLetta: false }),
}));
vi.mock('@/components/admin/ExternalDataPanel', () => ({ default: () => null }));
// Il modulo finto fa quello che fa il vero: tiene la scorta vista ALL'APERTURA e la manda
// accanto a quella nuova.
vi.mock('@/components/seller/ProductForm', async () => {
  const { useState: stato0 } = await vi.importActual<typeof import('react')>('react');
  return {
    default: function ModuloFinto(props: {
      initialValues?: { stock?: unknown };
      onSubmit: (p: Riga, ctx: Riga) => void;
    }) {
      const [vista] = stato0(() => {
        stato.aperture.push(props.initialValues?.stock);
        return props.initialValues?.stock;
      });
      stato.invia = (stock: number) =>
        props.onSubmit({ stock, stock_visto: vista }, { variants: [], campiDallAi: [], scorteViste: {} });
      return null;
    },
  };
});

const ID = '11111111-1111-4111-8111-111111111111';

function prodotto(id: string, name: string, stock: number): Riga {
  return {
    id,
    seller_id: 'seller-1',
    name,
    description: 'Fatta stamattina con olio extravergine.',
    price: 4,
    compare_at_price: null,
    unit: 'pz',
    condition: 'new',
    stock,
    category_id: 'cat-1',
    images: ['https://mycity.test/foto.jpg'],
    attributes: {},
    tags: [],
    express_enabled: null,
    status: 'available',
    categories: { name: 'Pane' },
  };
}

let root: Root | null = null;
let radice: HTMLElement | null = null;

async function finche(condizione: () => boolean, cosa: string) {
  for (let i = 0; i < 60; i++) {
    if (condizione()) return;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
  }
  throw new Error(`non e' successo: ${cosa}`);
}

function scrivi(el: HTMLInputElement, valore: string) {
  const imposta = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    imposta.call(el, valore);
    el.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
}

function clicca(testo: string) {
  const b = Array.from(radice!.querySelectorAll('button')).find((x) => (x.textContent ?? '').includes(testo));
  if (!b) throw new Error(`manca il pulsante «${testo}»`);
  act(() => {
    b.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

const campoScorta = (nome: string) => radice!.querySelector<HTMLInputElement>(`input[aria-label="Stock di ${nome}"]`);

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  stato.tabelle = { categories: [] };
  stato.aperture = [];
  stato.invia = null;
  stato.errori = [];
  stato.successi = [];
  radice = document.createElement('div');
  document.body.appendChild(radice);
  root = createRoot(radice);
});

afterEach(() => {
  act(() => root?.unmount());
  radice?.remove();
  vi.unstubAllGlobals();
});

describe('la modifica in blocco dopo un conflitto di scorta', () => {
  it('IL CASO CHE ROMPEVA — il primo si salva, il secondo e\' stato venduto: al nuovo «Salva» passa', async () => {
    const { default: SellerProductsPage } = await import('@/app/seller/products/page');
    stato.tabelle.products = [prodotto('a', 'Focaccia', 5), prodotto('b', 'Pizza al taglio', 5)];
    act(() => root!.render(createElement(QueryProvider, null, createElement(SellerProductsPage))));
    await finche(() => (radice!.textContent ?? '').includes('Modifica in blocco'), 'elenco caricato');
    clicca('Modifica in blocco');
    await finche(() => campoScorta('Focaccia') !== null, 'campi della scorta');

    scrivi(campoScorta('Focaccia')!, '8');
    scrivi(campoScorta('Pizza al taglio')!, '6');
    stato.tabelle.products[1].stock = 3; // due tranci venduti mentre il negoziante scriveva

    clicca('Salva modifiche');
    await finche(() => stato.errori.length > 0, 'il conflitto sulla pizza');
    expect(stato.errori[0]).toMatch(/ora sono 3/);
    expect(stato.tabelle.products[0].stock).toBe(8);
    expect(stato.tabelle.products[1].stock, 'la vendita della pizza e\' sparita').toBe(3);

    // Il campo torna al numero vero: il negoziante lo vede e scrive quello giusto.
    await finche(() => campoScorta('Pizza al taglio')?.value === '3', 'la pizza torna a 3 pezzi');
    scrivi(campoScorta('Pizza al taglio')!, '4');
    clicca('Salva modifiche');
    await finche(() => stato.successi.length > 0 || stato.errori.length > 1, 'il secondo «Salva»');
    expect(stato.errori, 'il secondo «Salva» fallisce ancora').toHaveLength(1);
    expect(stato.tabelle.products[0].stock).toBe(8);
    expect(stato.tabelle.products[1].stock).toBe(4);
  });
});

describe('il modulo riaperto dopo «la scorta e\' cambiata»', () => {
  function Prendi({ dove }: { dove: { qc: QueryClient | null } }) {
    dove.qc = useQueryClient();
    return null;
  }

  async function riapri(pagina: unknown, chiave: readonly unknown[]) {
    const dove: { qc: QueryClient | null } = { qc: null };
    let mostra: (v: boolean) => void = () => undefined;
    function Guscio() {
      const [si, setSi] = useState(false);
      mostra = setSi;
      return createElement(
        QueryProvider,
        null,
        createElement(Prendi, { dove }),
        si ? createElement(pagina as never, { params: { valore: { id: ID } } }) : null,
      );
    }
    stato.tabelle.products = [prodotto(ID, 'Focaccia genovese', 5)];
    act(() => root!.render(createElement(Guscio)));
    // La copia in memoria: letta poco fa, quando i pezzi erano 5.
    dove.qc!.setQueryData(chiave, prodotto(ID, 'Focaccia genovese', 5));
    dove.qc!.setQueryData([...chiave, 'variants'], []);
    act(() => mostra(true));
    await finche(() => stato.aperture.length === 1 && stato.invia !== null, 'primo modulo aperto');

    stato.tabelle.products[0].stock = 3; // due focacce vendute col modulo aperto
    act(() => stato.invia!(6));
    await finche(() => stato.errori.length > 0, 'il conflitto');
    expect(stato.tabelle.products[0].stock).toBe(3);

    // «Riapri il prodotto»: il negoziante esce e rientra.
    act(() => mostra(false));
    act(() => mostra(true));
    await finche(() => stato.aperture.length === 2, 'modulo riaperto');
    return stato.aperture[1];
  }

  it('IL CASO CHE ROMPEVA — negoziante: la scorta vista e\' quella della banca dati, non la copia in memoria', async () => {
    const { default: EditProductPage } = await import('@/app/seller/products/[id]/edit/page');
    expect(await riapri(EditProductPage, queryKeys.seller.product(ID))).toBe(3);
    act(() => stato.invia!(4));
    await finche(() => stato.tabelle.products[0].stock === 4 || stato.errori.length > 1, 'il salvataggio dopo la riapertura');
    expect(stato.errori, 'riaperto il prodotto, ripete l\'errore').toHaveLength(1);
    expect(stato.tabelle.products[0].stock).toBe(4);
  });

  it('IL CASO CHE ROMPEVA — amministrazione: la scorta vista e\' quella della banca dati', async () => {
    vi.stubGlobal('fetch', async () =>
      new Response(JSON.stringify({ error: { message: 'La scorta è cambiata mentre la scheda era aperta: avevi davanti 5 pezzi.' } }), {
        status: 409,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const { default: AdminEditProductPage } = await import('@/app/admin/products/[id]/edit/page');
    expect(await riapri(AdminEditProductPage, queryKeys.admin.product(ID))).toBe(3);
  });
});

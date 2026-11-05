/**
 * S05 · scheda 2519 — il modulo prodotto dell'amministrazione, dopo «la scorta è
 * cambiata», ridava lo stesso errore a ogni «Salva» finché non lo si riapriva a mano.
 * Ora si rimonta da solo coi dati riletti. (Impianto preso dalla prova
 * dopo-una-scorta-cambiata-lista-e-modulo-ripartono-dalla-banca-dati.)
 */
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
  expect(condizione(), `non e' successo: ${cosa}`).toBe(true);
}

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


describe('modulo prodotto dell’admin dopo un conflitto di scorta', () => {
  it('2519: dopo il 409 il modulo riparte dalla scorta riletta, senza uscire', async () => {
    stato.tabelle.products = [prodotto(ID, 'Focaccia genovese', 5)];
    let risposte = 0;
    vi.stubGlobal('fetch', async () => {
      risposte += 1;
      return new Response(JSON.stringify({ error: { message: 'La scorta è cambiata mentre la scheda era aperta: avevi davanti 5 pezzi.' } }), {
        status: 409, headers: { 'content-type': 'application/json' },
      });
    });
    const { default: Pagina } = await import('@/app/admin/products/[id]/edit/page');
    act(() => root!.render(createElement(QueryProvider, null, createElement(Pagina as never, { params: { valore: { id: ID } } }))));
    await finche(() => stato.aperture.length === 1 && stato.invia !== null, 'modulo aperto');
    expect(stato.aperture[0]).toBe(5);
    stato.tabelle.products[0].stock = 3; // due vendute col modulo aperto
    act(() => stato.invia!(6));
    await finche(() => stato.aperture.length === 2, 'il modulo si rimonta coi dati riletti');
    expect(risposte).toBe(1);
    expect(stato.aperture[1], 'la scorta vista deve essere quella della banca dati').toBe(3);
  });
});

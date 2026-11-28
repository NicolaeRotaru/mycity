/**
 * @vitest-environment jsdom
 */
/**
 * R10-013 — Nella modifica prodotto dell'amministratore:
 *  ① aperta senza rete con prodotto, taglie e categorie in memoria, al ritorno della rete le letture
 *    ripartivano e il caricamento prendeva il posto del modulo: il modulo si smontava e quello che
 *    l'amministratore aveva scritto spariva;
 *  ② aperta senza rete con il prodotto in memoria ma non le taglie, il modulo si apriva con 0 taglie
 *    (la lettura «in pausa» non è né caricamento né errore, e il ripiego era `[]`);
 *  ③ il caso accanto: senza rete e senza il prodotto in memoria la pagina diceva «Prodotto non trovato».
 *
 * La prima cura (169ce728, ritirata con 9ff70b0f) teneva il modulo montato ma ignorava gli errori:
 * dopo un 409 con la rilettura caduta il modulo ripartiva coi numeri vecchi dicendo «ho riletto il
 * prodotto». Qui anche quel caso: ④ dopo un 409 con la rilettura caduta il modulo resta (con quello
 * che si è scritto), non si dice «ho riletto», sopra il modulo c'è l'errore con «Riprova»; riuscita
 * la rilettura il modulo riparte dai numeri nuovi. ⑤ Una rilettura caduta col modulo aperto non gli
 * prende il posto.
 *
 * La pagina VERA, con React Query vero messo senza rete (`onlineManager`), e un modulo finto che
 * tiene quello che si scrive come lo tiene il modulo vero (stato suo, perso se si smonta).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queries/keys';

type Riga = Record<string, unknown>;

const stato = vi.hoisted(() => ({
  tabelle: {} as Record<string, Array<Record<string, unknown>>>,
  aperture: [] as Array<{ taglie: number; categorie: number; scorta: unknown }>,
  smontaggi: 0,
  /** La rete vera ci mette un po': le risposte arrivano dopo questi millisecondi. */
  ritardo: 0,
  /** La lettura del prodotto cade (guasto, non «senza rete»). */
  prodottoCade: false,
  invia: null as null | (() => void),
  errori: [] as string[],
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
vi.mock('sonner', () => ({
  toast: Object.assign(() => undefined, {
    success: () => undefined,
    error: (m: string) => { stato.errori.push(m); },
  }),
}));
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
          maybeSingle: () =>
            conLaRete(
              tavola === 'products' && stato.prodottoCade
                ? { data: null, error: { message: 'TypeError: Failed to fetch', code: '' } }
                : { data: trova()[0] ?? null, error: null },
            ),
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
    default: function ModuloFinto(props: {
      categories: unknown[];
      initialValues?: { variants?: unknown[]; name?: string; stock?: unknown };
      onSubmit: (p: Riga, ctx: Riga) => void;
    }) {
      const [nome, setNome] = R.useState(props.initialValues?.name ?? '');
      R.useEffect(() => {
        stato.aperture.push({ taglie: props.initialValues?.variants?.length ?? 0, categorie: props.categories.length, scorta: props.initialValues?.stock });
        return () => {
          stato.smontaggi += 1;
        };
      }, []);
      stato.invia = () => props.onSubmit({ name: nome, stock: props.initialValues?.stock }, { variants: [], campiDallAi: [], scorteViste: {} });
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
let qc: QueryClient;

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
  stato.prodottoCade = false;
  stato.invia = null;
  stato.errori = [];
  radice = document.createElement('div');
  document.body.appendChild(radice);
  root = createRoot(radice);
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  act(() => root?.unmount());
  radice?.remove();
  onlineManager.setOnline(true);
  vi.unstubAllGlobals();
});

async function monta() {
  const { default: Pagina } = await import('@/app/admin/products/[id]/edit/page');
  act(() =>
    root!.render(createElement(QueryClientProvider, { client: qc }, createElement(Pagina as never, { params: { valore: { id: ID } } }))),
  );
  await finche(() => stato.aperture.length > 0 || /Errore|Senza rete/.test(radice!.textContent ?? ''));
}

/** Apre la pagina senza rete, con in memoria quello che `memoria` dice (le categorie sempre). */
async function apriSenzaRete(memoria: { prodotto: boolean; taglie: boolean }) {
  if (memoria.prodotto) qc.setQueryData(queryKeys.admin.product(ID), maglietta());
  if (memoria.taglie) qc.setQueryData([...queryKeys.admin.product(ID), 'variants'], TAGLIE);
  qc.setQueryData(queryKeys.categories.form, CATEGORIE);
  onlineManager.setOnline(false);
  await monta();
}

const testo = () => radice!.textContent ?? '';
const riprova = () => Array.from(radice!.querySelectorAll('button')).find((b) => b.textContent === 'Riprova');
const scrivi = () => act(() => Array.from(radice!.querySelectorAll('button')).find((b) => b.textContent === 'scrivi')!.click());
const nomeScritto = () => radice!.querySelector('[data-nome]')?.textContent;

describe('R10-013 — la modifica prodotto dell\'amministratore senza rete e al ritorno della rete', () => {
  it('① al ritorno della rete il modulo aperto resta montato, con quello che si è scritto', async () => {
    await apriSenzaRete({ prodotto: true, taglie: true });
    expect(radice!.querySelector('[data-modulo]'), 'con prodotto e taglie in memoria il modulo si apre').not.toBeNull();
    scrivi();
    expect(nomeScritto()).toBe('Maglietta in cotone biologico');

    // La rete torna, e le letture ripartite ci mettono un momento (come sul telefono vero).
    stato.ritardo = 40;
    act(() => onlineManager.setOnline(true));
    await giri(20);

    expect(stato.smontaggi, 'il caricamento ha preso il posto del modulo: le modifiche sono andate perse').toBe(0);
    expect(nomeScritto()).toBe('Maglietta in cotone biologico');
  });

  it('② taglie non in memoria: senza rete il modulo non si apre con 0 taglie, la pagina lo dice e offre «Riprova»', async () => {
    await apriSenzaRete({ prodotto: true, taglie: false });
    expect(stato.aperture, 'il modulo si è aperto con 0 taglie: al «Salva» andrebbero perse').toEqual([]);
    expect(testo()).toMatch(/Senza rete/);
    expect(testo()).toMatch(/taglie/);
    expect(riprova()).toBeDefined();
  });

  it('② quando la rete torna le taglie si leggono e il modulo si apre con tutte e due', async () => {
    await apriSenzaRete({ prodotto: true, taglie: false });
    act(() => onlineManager.setOnline(true));
    await finche(() => stato.aperture.length > 0);
    expect(stato.aperture.map(({ taglie, categorie }) => ({ taglie, categorie }))).toEqual([{ taglie: 2, categorie: 1 }]);
  });

  it('③ senza rete e senza il prodotto in memoria non dice «Prodotto non trovato»', async () => {
    await apriSenzaRete({ prodotto: false, taglie: false });
    expect(stato.aperture).toEqual([]);
    expect(testo()).not.toMatch(/Prodotto non trovato/);
    expect(testo()).toMatch(/Senza rete/);
    expect(riprova()).toBeDefined();
  });
});

describe('R10-013 — col modulo aperto una rilettura caduta si dice, senza smontare il modulo e senza dire «ho riletto»', () => {
  it('④ 409 con la rilettura caduta: il modulo resta coi numeri di prima e quello che si è scritto, nessun «ho riletto», errore con «Riprova»', async () => {
    vi.stubGlobal('fetch', async () =>
      new Response(JSON.stringify({ error: { message: 'La scorta è cambiata mentre la scheda era aperta.' } }), {
        status: 409, headers: { 'content-type': 'application/json' },
      }));
    await monta();
    expect(stato.aperture).toHaveLength(1);
    scrivi();

    stato.tabelle.products[0].stock = 3; // due vendute col modulo aperto
    stato.prodottoCade = true; // e la rilettura dopo il 409 cade
    act(() => stato.invia!());
    await finche(() => stato.errori.length > 0);
    await giri(5);

    expect(stato.errori.join(' · '), 'dopo un 409 con la rilettura caduta diceva «ho riletto il prodotto»').not.toMatch(/ho riletto/i);
    expect(stato.errori.join(' · ')).toMatch(/non riesco a rileggere/i);
    expect(stato.aperture, 'il modulo è ripartito coi numeri vecchi').toHaveLength(1);
    expect(stato.smontaggi, 'la pagina d’errore ha preso il posto del modulo').toBe(0);
    expect(nomeScritto(), 'quello che si era scritto è sparito').toBe('Maglietta in cotone biologico');
    expect(radice!.querySelector('[role="alert"]')?.textContent).toMatch(/Non riesco a rileggere il prodotto/);
    expect(riprova(), 'manca «Riprova» per la rilettura').toBeDefined();

    // La rete torna buona: «Riprova» rilegge e il modulo riparte dai numeri nuovi, come dopo ogni 409.
    stato.prodottoCade = false;
    act(() => riprova()!.click());
    await finche(() => stato.aperture.length === 2);
    expect(stato.aperture[1].scorta, 'la scorta vista deve essere quella riletta').toBe(3);
    expect(stato.errori.at(-1)).toMatch(/Ho riletto il prodotto/);
    expect(radice!.querySelector('[role="alert"]')).toBeNull();
  });

  it('④ controprova: 409 con la rilettura riuscita, il modulo riparte subito dalla scorta riletta e lo dice', async () => {
    vi.stubGlobal('fetch', async () =>
      new Response(JSON.stringify({ error: { message: 'La scorta è cambiata.' } }), { status: 409, headers: { 'content-type': 'application/json' } }));
    await monta();
    stato.tabelle.products[0].stock = 3;
    act(() => stato.invia!());
    await finche(() => stato.aperture.length === 2);
    expect(stato.aperture[1].scorta).toBe(3);
    expect(stato.errori.join(' · ')).toMatch(/ho riletto il prodotto/);
    expect(radice!.querySelector('[role="alert"]')).toBeNull();
  });

  it('⑤ una rilettura caduta col modulo aperto non prende il posto del modulo', async () => {
    await monta();
    scrivi();
    stato.prodottoCade = true;
    await act(async () => { await qc.refetchQueries({ queryKey: queryKeys.admin.product(ID) }); });
    await giri(5);
    expect(stato.smontaggi, 'la pagina «Errore» ha preso il posto del modulo').toBe(0);
    expect(nomeScritto()).toBe('Maglietta in cotone biologico');
    expect(radice!.querySelector('[role="alert"]')?.textContent).toMatch(/Non riesco a rileggere il prodotto/);

    stato.prodottoCade = false;
    act(() => riprova()!.click());
    await finche(() => radice!.querySelector('[role="alert"]') === null);
    expect(radice!.querySelector('[role="alert"]')).toBeNull();
    expect(stato.aperture, 'senza un conflitto la rilettura riuscita non rimonta il modulo').toHaveLength(1);
    expect(nomeScritto()).toBe('Maglietta in cotone biologico');
  });
});

/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * R01-012 — La pagina «Nuovo prodotto»: l'invio che passa al modulo dura fino alla fine
 * dell'inserimento.
 *
 * Il modulo chiude il secondo clic finché l'invio è in corso. Ma la pagina passava un invio che
 * finiva subito (`create.mutate`, che non aspetta niente): il modulo si riapriva mentre
 * l'inserimento in `products` era ancora in volo. Ora la pagina restituisce la promessa
 * dell'inserimento, e un inserimento caduto la chiude senza lasciare errori non raccolti
 * (il messaggio lo dà già `onError`).
 */
const stato = vi.hoisted(() => ({
  moduli: [] as Record<string, unknown>[],
  inserimenti: 0,
  rispondi: (_r: { data: unknown; error: unknown }) => undefined as void,
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams('') }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/ui/LoadingState', () => ({ LoadingState: () => createElement('p', null, 'CARICAMENTO') }));
vi.mock('@/lib/analytics/events', async (importOriginal) => ({ ...(await importOriginal<object>()), trackProductPublished: vi.fn(), trackErrorShown: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: 's1' } } }) },
    from: () => ({
      insert: () => {
        stato.inserimenti += 1;
        return { select: () => ({ single: () => new Promise((r) => { stato.rispondi = r; }) }) };
      },
    }),
  },
}));
vi.mock('@/components/seller/ProductForm', () => ({
  default: (p: Record<string, unknown>) => { stato.moduli.push(p); return createElement('p', null, 'MODULO'); },
}));
vi.mock('@/lib/queries/consegna-veloce-del-negozio', () => ({
  useConsegnaVeloceDelNegozio: () => ({ offre: false, inLettura: false, nonLetta: false }),
}));
vi.mock('@tanstack/react-query', async (importOriginal) => {
  const vero = await importOriginal<typeof import('@tanstack/react-query')>();
  return {
    ...vero,
    // Le letture della pagina arrivano già pronte; la mutazione resta quella vera.
    useQuery: (o: { queryKey: unknown[] }) => {
      const k = JSON.stringify(o.queryKey);
      if (k.includes('categor')) return { data: [{ id: 'c1', name: 'Casa', slug: 'casa', parent_id: null }], isLoading: false, isError: false, isPending: false, fetchStatus: 'idle', refetch: vi.fn() };
      return { data: undefined, isLoading: false, isError: false, refetch: vi.fn() };
    },
  };
});
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const { default: Pagina } = await import('@/app/seller/products/new/page');

async function montaPagina() {
  const div = document.createElement('div');
  document.body.appendChild(div);
  const root = createRoot(div);
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  await act(async () => { root.render(createElement(QueryClientProvider, { client }, createElement(Pagina))); });
  const modulo = stato.moduli.at(-1);
  expect(modulo, 'controprova: il modulo deve essere a video').toBeTruthy();
  return { root, onSubmit: modulo!.onSubmit as (p: unknown, c: unknown) => unknown };
}

const PAYLOAD = { name: 'Poltrona', status: 'available' };
const CTX = { intent: 'publish', variants: [], campiDallAi: [], scorteViste: {} };
const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 10)); });

beforeEach(() => { stato.moduli = []; stato.inserimenti = 0; });

describe('R01-012 — la pagina «Nuovo prodotto» e la fine dell\'invio', () => {
  it('l\'invio passato al modulo finisce solo quando l\'inserimento è finito', async () => {
    const { root, onSubmit } = await montaPagina();
    let finito = false;
    await act(async () => { void Promise.resolve(onSubmit(PAYLOAD, CTX)).then(() => { finito = true; }); });
    await tick();
    expect(stato.inserimenti).toBe(1);
    expect(finito, 'l\'invio è finito con l\'inserimento ancora in volo: il modulo si riapre e un clic fa un doppione').toBe(false);
    await act(async () => { stato.rispondi({ data: { id: 'nuovo-1' }, error: null }); });
    await tick();
    expect(finito, 'a inserimento finito anche l\'invio deve finire').toBe(true);
    root.unmount();
  });

  it('un inserimento caduto chiude l\'invio senza lasciare un errore non raccolto', async () => {
    const { root, onSubmit } = await montaPagina();
    let esito = 'in volo';
    await act(async () => {
      void Promise.resolve(onSubmit(PAYLOAD, CTX)).then(() => { esito = 'finito'; }, () => { esito = 'errore non raccolto'; });
    });
    await tick();
    expect(esito).toBe('in volo');
    await act(async () => { stato.rispondi({ data: null, error: { message: 'rete' } }); });
    await tick();
    expect(esito).toBe('finito');
    root.unmount();
  });
});

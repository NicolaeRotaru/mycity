/**
 * @vitest-environment jsdom
 *
 * «Duplica» con la sorgente e le taglie in memoria da meno di 30 secondi (la memoria del sito) apriva
 * il modulo con quelle di prima: la spunta del recesso e le taglie cambiate nel frattempo non
 * arrivavano. Adesso la copia si apre solo con la sorgente e le taglie riletta all'apertura.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';

const stato = vi.hoisted(() => ({
  moduli: [] as Array<Record<string, unknown>>,
  // Il modulo montato e la spunta che ha letto al montaggio (il modulo vero la legge solo lì).
  modulo: null as { props: Record<string, unknown>; spunta: boolean } | null,
  sorgenteCade: false,
  taglieCadono: false,
  inseriti: [] as Array<Record<string, unknown>>,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams('from=p-pane'),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/ui/LoadingState', () => ({ LoadingState: () => createElement('p', null, 'CARICAMENTO') }));
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: 's1' } } }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => (stato.sorgenteCade ? { data: null, error: new Error('Failed to fetch') } : {
            data: { id: 'p-pane', seller_id: 's1', name: 'Pane di Altamura', price: 4, images: [], attributes: {}, non_recedibile: true },
            error: null,
          }),
        }),
      }),
      insert: (riga: Record<string, unknown>) => ({
        select: () => ({
          single: async () => { stato.inseriti.push(riga); return { data: { id: 'p-copia' }, error: null }; },
        }),
      }),
    }),
  },
}));
vi.mock('@/lib/products/persistVariants', () => ({
  loadProductVariants: async () => {
    if (stato.taglieCadono) throw new Error('Failed to fetch');
    return [
      { id: 'v1', label: 'S', options: { Taglia: 'S' } },
      { id: 'v2', label: 'M', options: { Taglia: 'M' } },
    ];
  },
  saveProductVariants: async () => undefined,
}));
vi.mock('@/components/seller/ProductForm', () => ({
  default: function ModuloFinto(p: Record<string, unknown>) {
    // Come il modulo vero (useState di components/seller/ProductForm.tsx): la spunta si legge al montaggio.
    const [spunta] = useState(() => (p.initialValues as { nonRecedibile?: boolean } | undefined)?.nonRecedibile === true);
    stato.moduli.push(p);
    stato.modulo = { props: p, spunta };
    return createElement('p', null, 'MODULO');
  },
}));
vi.mock('@/lib/queries/consegna-veloce-del-negozio', () => ({
  useConsegnaVeloceDelNegozio: () => ({ offre: false, inLettura: false, nonLetta: false }),
}));
vi.mock('@tanstack/react-query', async (importOriginal) => {
  const vero = await importOriginal<typeof import('@tanstack/react-query')>();
  return {
    ...vero,
    useQuery: (o: { queryKey: unknown[] }) => {
      const k = JSON.stringify(o.queryKey);
      if (k.includes('duplicate')) return vero.useQuery(o as never);
      const pronto = { isLoading: false, isError: false, isPending: false, fetchStatus: 'idle', refetch: vi.fn() };
      if (k.includes('categor')) return { ...pronto, data: [{ id: 'c1', name: 'Casa', slug: 'casa', parent_id: null }] };
      return { ...pronto, data: undefined };
    },
  };
});
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const { default: Pagina } = await import('@/app/seller/products/new/page');

let root: Root | null = null;
let div: HTMLDivElement | null = null;
const gira = async (volte = 6) => {
  for (let i = 0; i < volte; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
};

beforeEach(() => {
  stato.moduli = [];
  stato.modulo = null;
  stato.sorgenteCade = false;
  stato.taglieCadono = false;
  stato.inseriti = [];
});
afterEach(async () => {
  await act(async () => { root?.unmount(); });
  div?.remove();
  root = null;
  onlineManager.setOnline(true);
});

describe('«Duplica» con la sorgente in memoria da pochi secondi', () => {
  it('il primo modulo aperto ha le taglie e la spunta vere, non quelle della memoria', async () => {
    // Come il sito: 30 secondi di memoria fresca. In memoria: la sorgente di prima, senza spunta e senza taglie.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, staleTime: 30_000 } } });
    client.setQueryData(['duplicate-source', 'p-pane'], { id: 'p-pane', seller_id: 's1', name: 'Pane di Altamura', price: 4, images: [], attributes: {}, non_recedibile: false });
    client.setQueryData(['duplicate-variants', 'p-pane'], []);

    div = document.createElement('div');
    document.body.appendChild(div);
    root = createRoot(div);
    await act(async () => { root!.render(createElement(QueryClientProvider, { client }, createElement(Pagina))); });
    await gira();

    const primo = stato.moduli[0]?.initialValues as { nonRecedibile?: boolean; variants?: unknown[] } | undefined;
    expect(primo, 'il modulo non si è aperto').toBeTruthy();
    expect(primo!.variants, 'il modulo si è aperto con le taglie di prima').toHaveLength(2);
    expect(primo!.nonRecedibile, 'il modulo si è aperto con la spunta di prima').toBe(true);
  });
});

// Collaudo K05: con la sorgente in memoria e la rilettura caduta (o senza rete) il modulo si apriva con la
// spunta di prima; dopo «Riprova», o al ritorno della rete, il salvataggio si sbloccava con quella spunta.
const TAGLIE = [
  { id: 'v1', label: 'S', options: { Taglia: 'S' } },
  { id: 'v2', label: 'M', options: { Taglia: 'M' } },
];

async function apriConLaMemoriaVecchia() {
  // In memoria: la sorgente di prima, senza la spunta «escluso dal recesso»; le taglie sono già quelle vere.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, staleTime: 30_000 } } });
  client.setQueryData(['duplicate-source', 'p-pane'], { id: 'p-pane', seller_id: 's1', name: 'Pane di Altamura', price: 4, images: [], attributes: {}, non_recedibile: false });
  client.setQueryData(['duplicate-variants', 'p-pane'], TAGLIE);
  div = document.createElement('div');
  document.body.appendChild(div);
  root = createRoot(div);
  await act(async () => { root!.render(createElement(QueryClientProvider, { client }, createElement(Pagina))); });
  await gira();
}

const pulsante = (testo: string) => [...(div?.querySelectorAll('button') ?? [])].find((b) => (b.textContent ?? '').includes(testo));
async function clic(testo: string) {
  const b = pulsante(testo);
  expect(b, `il pulsante «${testo}» non è a video`).toBeTruthy();
  await act(async () => { b!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); });
  await gira();
}

/** «Salva» del modulo montato: come il modulo vero in creazione, la spunta parte solo se è messa. */
async function salva() {
  expect(stato.modulo, 'il modulo non è a video').toBeTruthy();
  const { props, spunta } = stato.modulo!;
  const payload = { name: 'Pane di Altamura (copia)', price: 4, status: 'draft', ...(spunta ? { non_recedibile: true } : {}) };
  await act(async () => { await (props.onSubmit as (p: unknown, c: unknown) => Promise<unknown> | undefined)(payload, { variants: [] }); });
  await gira();
}

const copieRecedibili = () => stato.inseriti.filter((r) => r.non_recedibile !== true);

describe('«Duplica» con la sorgente in memoria e la rilettura che non arriva (K05)', () => {
  it('la rilettura della sorgente cade, poi «Riprova» riesce: la copia del pane non si salva recedibile', async () => {
    stato.sorgenteCade = true;
    await apriConLaMemoriaVecchia();
    stato.sorgenteCade = false;
    await clic('Riprova');
    await salva();
    expect(copieRecedibili(), 'la copia si è salvata con la spunta di prima: recedibile').toEqual([]);
  });

  it('cadono le riletture di sorgente e taglie, poi «Riprova» riesce: la copia del pane non si salva recedibile', async () => {
    stato.sorgenteCade = true;
    stato.taglieCadono = true;
    await apriConLaMemoriaVecchia();
    stato.sorgenteCade = false;
    stato.taglieCadono = false;
    await clic('Riprova');
    await salva();
    expect(copieRecedibili(), 'la copia si è salvata con la spunta di prima: recedibile').toEqual([]);
  });

  it('aperta senza rete, poi la rete torna: la copia del pane non si salva recedibile', async () => {
    onlineManager.setOnline(false);
    await apriConLaMemoriaVecchia();
    await act(async () => { onlineManager.setOnline(true); });
    await gira();
    await salva();
    expect(copieRecedibili(), 'la copia si è salvata con la spunta di prima: recedibile').toEqual([]);
  });

  it('controprova: riaperta con i dati riletti, la copia ha la spunta vera e si salva esclusa dal recesso', async () => {
    stato.sorgenteCade = true;
    await apriConLaMemoriaVecchia();
    stato.sorgenteCade = false;
    await clic('Riprova');
    await clic('Riapri la copia');
    expect(stato.modulo?.spunta, 'riaperta, la copia ha ancora la spunta di prima').toBe(true);
    await salva();
    expect(stato.inseriti, 'riaperta, la copia non si salva').toHaveLength(1);
    expect(stato.inseriti[0].non_recedibile).toBe(true);
  });
});

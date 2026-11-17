/**
 * @vitest-environment jsdom
 *
 * Un doppio clic su «Pubblica prodotto» non mette in vendita due prodotti: il clic ravvicinato e
 * il doppio Invio erano già chiusi. Restava una finestra DOPO l'inserimento riuscito: la guardia
 * del modulo si toglie a invio finito, e la pagina passava `submitting={create.isPending}`, che
 * torna falso prima che router.push cambi pagina. Un clic in quel momento creava un secondo
 * prodotto. Qui la pagina vera monta il modulo vero; router.push non porta via (come nel tempo
 * prima che la pagina nuova arrivi) e si clicca di nuovo.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const stato = vi.hoisted(() => ({ inserimenti: 0, push: [] as string[] }));

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), loading: vi.fn(), dismiss: vi.fn() }) }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('next/image', () => ({ default: () => null }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: (u: string) => { stato.push.push(u); }, replace: vi.fn() }),
  usePathname: () => '/seller/products/new',
  useSearchParams: () => new URLSearchParams('from=p-origine'),
}));
vi.mock('@/lib/analytics/events', async (importOriginal) => ({ ...(await importOriginal<object>()), trackProductPublished: vi.fn(), trackErrorShown: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { access_token: 'tok' } } }),
      getUser: async () => ({ data: { user: { id: 's1' } } }),
    },
    from: () => ({
      insert: () => {
        stato.inserimenti += 1;
        return { select: () => ({ single: async () => ({ data: { id: `nuovo-${stato.inserimenti}` }, error: null }) }) };
      },
    }),
  },
}));
vi.mock('@/lib/queries/consegna-veloce-del-negozio', () => ({
  useConsegnaVeloceDelNegozio: () => ({ offre: false, inLettura: false, nonLetta: false }),
}));
const ORIGINE = {
  id: 'p-origine', seller_id: 's1', name: 'Poltrona in velluto',
  description: 'Poltrona in velluto verde, come nuova, ritiro in negozio',
  price: 120, unit: 'pezzo', stock: 1, category_id: 'c1', images: ['https://x/1.jpg'],
  attributes: {}, tags: [], express_enabled: null, non_recedibile: false,
};
vi.mock('@tanstack/react-query', async (importOriginal) => {
  const vero = await importOriginal<typeof import('@tanstack/react-query')>();
  return {
    ...vero,
    // Le letture della pagina arrivano già pronte; la mutazione resta quella vera.
    useQuery: (o: { queryKey: unknown[] }) => {
      const k = JSON.stringify(o.queryKey);
      const pronto = { isLoading: false, isError: false, isPending: false, fetchStatus: 'idle', refetch: vi.fn() };
      if (k.includes('categor')) return { ...pronto, data: [{ id: 'c1', name: 'Casa', slug: 'casa', parent_id: null }] };
      if (k.includes('duplicate-source')) return { ...pronto, data: ORIGINE };
      if (k.includes('duplicate-variants')) return { ...pronto, data: [] };
      return { ...pronto, data: undefined };
    },
  };
});
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const { default: Pagina } = await import('@/app/seller/products/new/page');

const clic = (b: HTMLElement) => b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
const attesa = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });

async function montaPagina() {
  const div = document.createElement('div');
  document.body.appendChild(div);
  const root = createRoot(div);
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  await act(async () => { root.render(createElement(QueryClientProvider, { client }, createElement(Pagina))); });
  await attesa();
  const bottone = (re: RegExp) => [...div.querySelectorAll('button')].find((b) => re.test(b.textContent ?? '')) as HTMLButtonElement | undefined;
  expect(bottone(/Pubblica prodotto/), 'controprova: il pulsante «Pubblica prodotto» deve essere a video').toBeTruthy();
  return { root, bottone };
}

beforeEach(() => { stato.inserimenti = 0; stato.push = []; });

describe('dopo un inserimento riuscito, prima del cambio di pagina', () => {
  it('un altro clic su «Pubblica prodotto» (o su «Salva come bozza») non inserisce un secondo prodotto', async () => {
    const { root, bottone } = await montaPagina();

    await act(async () => { clic(bottone(/Pubblica prodotto/)!); });
    await attesa();
    expect(stato.inserimenti, 'controprova: il primo clic deve inserire').toBe(1);
    expect(stato.push, 'controprova: la pagina chiede di tornare all’elenco').toEqual(['/seller/products']);

    // La pagina nuova non è ancora arrivata: il modulo è ancora a video.
    await act(async () => { clic(bottone(/Pubblica prodotto/)!); });
    await attesa();
    const bozza = bottone(/Salva come bozza/);
    if (bozza) { await act(async () => { clic(bozza); }); await attesa(); }

    expect(stato.inserimenti, 'il clic dopo il successo ha messo in vendita un secondo prodotto').toBe(1);
    expect(bottone(/Pubblica prodotto/)!.disabled, 'il pulsante si riapre prima del cambio di pagina').toBe(true);
    root.unmount();
  });
});

/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';

/**
 * R01-012 — Un doppio clic su «Pubblica prodotto» non mette in vendita due prodotti uguali.
 *
 * Il pulsante si spegneva solo quando la pagina diceva «sto salvando» (submitting), cioè dopo la
 * convalida asincrona del modulo e dopo che l'inserimento era partito: nel frattempo il secondo
 * clic rifaceva tutto il giro e chiamava di nuovo l'invio. Ora una guardia sincrona tiene chiuso
 * il modulo dal primo clic fino alla fine dell'invio.
 * Banco del montaggio preso da minori-s06-modulo-prodotto-ai.test.tsx.
 */
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), loading: vi.fn(), dismiss: vi.fn() }) }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/' }));
vi.mock('next/image', () => ({ default: () => null }));
vi.mock('@/lib/supabase/client', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }), getUser: async () => ({ data: { user: { id: 's1' } } }) } },
}));
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const CATEGORIE = [{ id: 'c1', name: 'Casa', slug: 'casa', parent_id: null }];
const PRONTO = {
  name: 'Poltrona in velluto', description: 'Poltrona in velluto verde, come nuova, ritiro in negozio',
  price: 120, unit: 'pezzo' as const, stock: 1, category_id: 'c1', images: ['https://x/1.jpg'],
  attributes: {}, tags: [], status: 'available', variants: [],
};

async function monta(onSubmit: (...a: unknown[]) => unknown) {
  const { default: ProductForm } = await import('@/components/seller/ProductForm');
  const div = document.createElement('div');
  document.body.appendChild(div);
  const root = createRoot(div);
  await act(async () => {
    root.render(createElement(ProductForm, {
      mode: 'create', categories: CATEGORIE, aiAccesa: false, sellerOffersExpress: false,
      consegnaDelNegozioNonLetta: false, initialValues: PRONTO, onSubmit: onSubmit as never,
    }));
  });
  const pubblica = [...div.querySelectorAll('button')].find((b) => /Pubblica prodotto/.test(b.textContent ?? ''));
  const bozza = [...div.querySelectorAll('button')].find((b) => /Salva come bozza/.test(b.textContent ?? ''));
  expect(pubblica, 'controprova: il pulsante «Pubblica prodotto» deve essere a video').toBeTruthy();
  expect(bozza, 'controprova: il pulsante «Salva come bozza» deve essere a video').toBeTruthy();
  return { div, root, pubblica: pubblica!, bozza: bozza! };
}

const clic = (b: HTMLElement) => b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
const attesa = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });

describe('R01-012 — il doppio clic su «Pubblica prodotto»', () => {
  it('due clic di fila: l\'invio parte una volta sola', async () => {
    const onSubmit = vi.fn();
    const { root, pubblica } = await monta(onSubmit);
    await act(async () => { clic(pubblica); clic(pubblica); });
    await attesa();
    expect(onSubmit, 'il secondo clic ha messo in vendita un doppione').toHaveBeenCalledTimes(1);
    root.unmount();
  });

  it('tre clic, anche mischiati con «Salva come bozza»: un invio solo', async () => {
    const onSubmit = vi.fn();
    const { root, pubblica, bozza } = await monta(onSubmit);
    await act(async () => { clic(pubblica); clic(bozza); clic(pubblica); });
    await attesa();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect((onSubmit.mock.calls[0][1] as { intent: string }).intent).toBe('publish');
    root.unmount();
  });

  it('il modulo resta chiuso finché l\'invio non è finito, poi si riapre', async () => {
    let finisci: () => void = () => undefined;
    const onSubmit = vi.fn(() => new Promise<void>((r) => { finisci = r; }));
    const { root, pubblica } = await monta(onSubmit);
    await act(async () => { clic(pubblica); });
    await attesa();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    // L'inserimento è ancora in volo (la pagina non ha ancora acceso «submitting»): un altro clic non riparte.
    await act(async () => { clic(pubblica); });
    await attesa();
    expect(onSubmit, 'un clic durante l\'inserimento ne ha fatto partire un altro').toHaveBeenCalledTimes(1);
    // Finito l'invio (per esempio caduto per la rete) si può riprovare.
    await act(async () => { finisci(); });
    await act(async () => { clic(pubblica); });
    await attesa();
    expect(onSubmit, 'dopo la fine dell\'invio il modulo deve permettere di riprovare').toHaveBeenCalledTimes(2);
    root.unmount();
  });
});

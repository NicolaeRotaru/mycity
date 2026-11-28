/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';

/**
 * R04-001 (onda 2, 28/11/2026) — UN ALIMENTARE NUOVO NON SI SALVA SULLA SOLA RADICE «ALIMENTARI».
 *
 * Un pane salvato su «Alimentari» senza sottocategoria e senza spunta del recesso accettava «Ho
 * cambiato idea»: nessun dato lo distingueva dalla dispensa (la rotta dei resi decide i freschi
 * dalla sottocategoria). Ora in creazione la sottocategoria degli alimentari è obbligatoria; in
 * modifica e nelle altre categorie resta facoltativa.
 * Banco del montaggio preso da riparazione-r01-doppio-clic-pubblica.test.tsx.
 */
const avvisi = vi.hoisted(() => ({ errori: [] as string[] }));
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(), error: vi.fn((m: string) => { avvisi.errori.push(m); }), warning: vi.fn(), loading: vi.fn(), dismiss: vi.fn(),
  }),
}));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/' }));
vi.mock('next/image', () => ({ default: () => null }));
vi.mock('@/lib/supabase/client', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }), getUser: async () => ({ data: { user: { id: 's1' } } }) } },
}));
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const CATEGORIE = [
  { id: 'c-alim', name: 'Alimentari', slug: 'alimentari', parent_id: null },
  { id: 'c-pane', name: 'Panificio', slug: 'panificio', parent_id: 'c-alim' },
  { id: 'c-disp', name: 'Dispensa & Conserve', slug: 'alimentari-dispensa', parent_id: 'c-alim' },
  { id: 'c-casa', name: 'Casa', slug: 'casa', parent_id: null },
  { id: 'c-cucina', name: 'Cucina', slug: 'casa-cucina', parent_id: 'c-casa' },
];
const prodotto = (category_id: string) => ({
  name: 'Pane casereccio di grano duro', description: 'Pane casereccio cotto a legna ogni mattina, crosta croccante e mollica soffice',
  price: 3, unit: 'pezzo' as const, stock: 10, category_id, images: ['https://x/1.jpg'],
  attributes: { allergeni: 'Glutine', ingredienti: 'Farina, acqua, sale, lievito madre' }, tags: [], status: 'available', variants: [],
});

async function monta(mode: 'create' | 'edit', category_id: string, onSubmit: (...a: unknown[]) => unknown) {
  const { default: ProductForm } = await import('@/components/seller/ProductForm');
  const div = document.createElement('div');
  document.body.appendChild(div);
  const root = createRoot(div);
  await act(async () => {
    root.render(createElement(ProductForm, {
      mode, categories: CATEGORIE, aiAccesa: false, sellerOffersExpress: false,
      consegnaDelNegozioNonLetta: false, initialValues: prodotto(category_id), onSubmit: onSubmit as never,
    }));
  });
  const etichetta = mode === 'create' ? /Pubblica prodotto/ : /Salva modifiche|Salva/;
  const invio = [...div.querySelectorAll('button')].find((b) => etichetta.test(b.textContent ?? ''));
  expect(invio, 'controprova: il pulsante di invio deve essere a video').toBeTruthy();
  return { div, root, invio: invio! };
}

const clic = (b: HTMLElement) => b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
const attesa = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });

beforeEach(() => {
  avvisi.errori = [];
  // jsdom non ha scrollIntoView: il modulo lo chiama per portare l'occhio sul campo da sistemare.
  Element.prototype.scrollIntoView = vi.fn();
});

describe('R04-001 onda 2 · la sottocategoria degli alimentari in creazione', () => {
  it('IL CASO CHE ROMPEVA — un pane nuovo sulla sola radice «Alimentari» non si pubblica, e il modulo dice perché', async () => {
    const onSubmit = vi.fn();
    const { div, root, invio } = await monta('create', 'c-alim', onSubmit);
    expect(div.textContent).not.toMatch(/Sottocategoria \(opzionale\)/);
    expect(div.textContent).not.toMatch(/tutta «Alimentari»/);
    await act(async () => { clic(invio); });
    await attesa();
    expect(onSubmit, 'il pane sulla sola radice «Alimentari» è stato pubblicato').not.toHaveBeenCalled();
    expect(avvisi.errori.join(' ')).toMatch(/Scegli la sottocategoria/);
    expect(div.textContent).toMatch(/escluso dal recesso/);
    root.unmount();
  });

  it('scelta la sottocategoria (Panificio) si pubblica', async () => {
    const onSubmit = vi.fn();
    const { root, invio } = await monta('create', 'c-pane', onSubmit);
    await act(async () => { clic(invio); });
    await attesa();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect((onSubmit.mock.calls[0][0] as { category_id: string }).category_id).toBe('c-pane');
    root.unmount();
  });

  it('controprova: un prodotto di «Casa» senza sottocategoria si pubblica (resta facoltativa)', async () => {
    const onSubmit = vi.fn();
    const { div, root, invio } = await monta('create', 'c-casa', onSubmit);
    expect(div.textContent).toMatch(/Sottocategoria \(opzionale\)/);
    await act(async () => { clic(invio); });
    await attesa();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    root.unmount();
  });

  it('controprova: in modifica un alimentare già sulla radice si salva ancora', async () => {
    const onSubmit = vi.fn();
    const { root, invio } = await monta('edit', 'c-alim', onSubmit);
    await act(async () => { clic(invio); });
    await attesa();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    root.unmount();
  });
});

/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * R07-012 — Se le categorie formano un cerchio (A dentro B, B dentro A) il modulo prodotto risaliva
 * per sempre i genitori e restava appeso. Qui il modulo VERO si apre con un cerchio; per non
 * appendere la prova, la lista smette di rispondere dopo troppe ricerche (senza la correzione il modulo
 * ne fa all'infinito).
 */
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), loading: vi.fn(() => 't'), dismiss: vi.fn() }) }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/' }));
vi.mock('next/image', () => ({ default: () => null }));
vi.mock('@/lib/supabase/client', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }), getUser: async () => ({ data: { user: { id: 's1' } } }) } },
}));
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const { default: ProductForm } = await import('@/components/seller/ProductForm');

let div: HTMLDivElement;
let root: Root;
afterEach(() => { act(() => root.unmount()); div.remove(); });

describe('R07-012 · categorie a cerchio', () => {
  it('il modulo si apre anche se A sta dentro B e B dentro A', async () => {
    const categorie = [
      { id: 'a', name: 'Alfa', slug: 'alfa', parent_id: 'b' },
      { id: 'b', name: 'Beta', slug: 'beta', parent_id: 'a' },
    ];
    let ricerche = 0;
    const originale = categorie.find.bind(categorie);
    Object.defineProperty(categorie, 'find', {
      value: (f: Parameters<typeof originale>[0]) => {
        // oltre il tetto la lista finge di non trovare niente: il giro finisce e la prova lo vede.
        if (++ricerche > 500) return undefined;
        return originale(f);
      },
    });
    div = document.createElement('div');
    document.body.appendChild(div);
    root = createRoot(div);
    await act(async () => {
      root.render(createElement(ProductForm, {
        mode: 'edit', categories: categorie, aiAccesa: false, sellerOffersExpress: true, consegnaDelNegozioNonLetta: false,
        onSubmit: () => {},
        initialValues: { name: 'Plaid', description: 'Plaid in lana', price: 40, unit: 'pezzo', stock: 1,
          category_id: 'a', images: [], attributes: {}, tags: [], status: 'available' },
      }));
    });
    expect(div.querySelector('form')).toBeTruthy();
    expect(ricerche, 'il modulo ha risalito le categorie senza fermarsi').toBeLessThan(50);
  });
});

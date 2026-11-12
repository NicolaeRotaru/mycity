/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { createProductSchema } from '@/lib/products/schema';

/**
 * R03-022 — Se il negoziante scrive il prezzo all'italiana, «1.250,00», il prodotto non va in
 * vendita a 1,25 euro.
 *
 * Il campo «Prezzo (€)» era type="number": il browser leggeva il punto come virgola decimale e
 * scartava il resto («1.25000»), poi lo schema faceva z.coerce.number e accettava. Ora il campo
 * è di testo (con la tastiera numerica) e lo schema legge il prezzo con `leggiPrezzo`.
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

const BASE = { name: 'Poltrona', description: 'Poltrona in velluto verde, come nuova, ritiro in negozio', category_id: 'c1' };

describe('R03-022 — il prezzo all italiana nel modulo del prodotto', () => {
  it('lo schema legge «1.250,00» come 1250, «1.250» come 1250 e «12,50» come 12,5', () => {
    const schema = createProductSchema({ minDescription: 30 });
    const r = schema.safeParse({ ...BASE, price: '1.250,00' });
    expect(r.success).toBe(true);
    expect(r.success && r.data.price, 'la poltrona va in vendita a 1,25 €').toBe(1250);
    expect(schema.safeParse({ ...BASE, price: '1.250' }).data?.price).toBe(1250);
    expect(schema.safeParse({ ...BASE, price: '12,50' }).data?.price).toBe(12.5);
    expect(schema.safeParse({ ...BASE, price: 'abc' }).success).toBe(false);
    expect(schema.safeParse({ ...BASE, price: '1.250,00', compareAtPrice: '1.500,00' }).data?.compareAtPrice).toBe(1500);
    // Collaudo: un prezzo pieno illeggibile si rifiuta, non si perde come «opzionale».
    expect(schema.safeParse({ ...BASE, price: '1.200', compareAtPrice: 'abc' }).success).toBe(false);
    expect(schema.safeParse({ ...BASE, price: '1.200', compareAtPrice: '' }).success).toBe(true);
  });

  it('il campo «Prezzo (€)» non è un campo numerico del browser (che trasforma «1.250,00» in 1.25)', async () => {
    const { default: ProductForm } = await import('@/components/seller/ProductForm');
    const div = document.createElement('div');
    document.body.appendChild(div);
    const root = createRoot(div);
    await act(async () => {
      root.render(createElement(ProductForm, {
        mode: 'create', categories: [{ id: 'c1', name: 'Casa', slug: 'casa', parent_id: null }], aiAccesa: false,
        sellerOffersExpress: false, consegnaDelNegozioNonLetta: false, onSubmit: () => {},
      }));
    });
    const etichetta = [...div.querySelectorAll('label')].find((l) => (l.textContent ?? '').startsWith('Prezzo (€)'));
    const input = (etichetta?.getAttribute('for') ? document.getElementById(etichetta.getAttribute('for')!) : etichetta?.querySelector('input')) as HTMLInputElement | null;
    expect(input, 'controprova: il campo del prezzo si deve trovare').toBeTruthy();
    expect(input!.getAttribute('type')).not.toBe('number');
    expect(input!.getAttribute('inputmode')).toBe('decimal');
    root.unmount();
  });
});

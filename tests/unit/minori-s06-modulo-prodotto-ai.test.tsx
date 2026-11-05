/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';

/**
 * S06 — Il modulo prodotto.
 * 616:  «Ordina foto» con l'AI che non risponde dice il messaggio del server, non tace.
 * 2263: la foto dice «usato»: un avviso spiega perché la condizione resta vuota.
 * 2291: niente «attiva l'Express dal profilo» sotto «questa scelta non cambia niente».
 * 1566: niente giallo Tailwind (amber) nell'avviso del modulo.
 */
const toast = vi.hoisted(() => Object.assign(vi.fn(), {
  success: vi.fn(), error: vi.fn(), warning: vi.fn(), loading: vi.fn(() => 't1'), dismiss: vi.fn(),
}));
vi.mock('sonner', () => ({ toast }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/' }));
vi.mock('next/image', () => ({ default: () => null }));
vi.mock('@/lib/supabase/client', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }), getUser: async () => ({ data: { user: { id: 's1' } } }) } },
}));
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const { default: ProductForm } = await import('@/components/seller/ProductForm');
const CATEGORIE = [{ id: 'c1', name: 'Casa', slug: 'casa', parent_id: null }];

beforeEach(() => { toast.error.mockClear(); toast.dismiss.mockClear(); });

describe('616 — «Ordina foto» con l\'AI che non risponde', () => {
  it('mostra il messaggio del server', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: { message: 'Servizio AI non configurato' } }), { status: 503 }));
    const div = document.createElement('div');
    document.body.appendChild(div);
    const root = createRoot(div);
    await act(async () => {
      root.render(createElement(ProductForm, {
        mode: 'edit', categories: CATEGORIE, aiAccesa: true, sellerOffersExpress: true, consegnaDelNegozioNonLetta: false,
        onSubmit: () => {},
        initialValues: { name: 'Vaso', description: 'Vaso in ceramica fatto a mano', price: 10, unit: 'pezzo', stock: 1,
          category_id: 'c1', images: ['https://x/1.jpg', 'https://x/2.jpg'], attributes: {}, tags: [], status: 'available', variants: [] },
      }));
    });
    const b = [...div.querySelectorAll('button')].find((x) => /Ordina foto/.test(x.textContent ?? ''));
    expect(b, 'il pulsante «Ordina foto» non è a video').toBeTruthy();
    await act(async () => { b!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(toast.error).toHaveBeenCalledWith('Servizio AI non configurato', { id: 't1' });
    root.unmount();
    vi.unstubAllGlobals();
  });
  it('anche codice a barre e varianti leggono il messaggio del server', () => {
    const s = readFileSync('components/seller/ProductForm.tsx', 'utf8');
    expect(s).toContain("apiErrorMessage(json, 'Il codice EAN è salvato, ma la ricerca online non è riuscita.')");
    expect(s).toContain("apiErrorMessage(json, 'Non sono riuscito a proporre le varianti.')");
  });
});

describe('2263 · 2291 · 1566 — testi del modulo', () => {
  const s = readFileSync('components/seller/ProductForm.tsx', 'utf8');
  it('la condizione scartata ha il suo avviso', () => {
    expect(s).toMatch(/if \(norm\) setCondition\(norm\);\s+\/\/[^\n]*\n\s+else if \(cond\.trim\(\)\) toast\.warning/);
  });
  it('niente «attivalo dal profilo negozio»', () => {
    expect(s).not.toContain('La consegna veloce richiede l&apos;Express attivo');
  });
  it('niente amber', () => {
    expect(s).not.toContain('text-amber-700');
  });
});

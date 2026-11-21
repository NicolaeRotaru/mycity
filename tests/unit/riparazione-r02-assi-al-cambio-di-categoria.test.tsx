/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * R02-020 — Cambiando categoria gli assi delle varianti della categoria vecchia restavano. Un capo
 * passato da Abbigliamento (Taglia, Colore) a Casa (Dimensioni, Colore) teneva la Taglia fra le
 * varianti: il modulo non la mostra più (il campo non c'è nella categoria nuova), nessuno poteva
 * toglierla, e ogni colore aggiunto si moltiplicava per le taglie invisibili.
 *
 * Qui il modulo VERO (components/seller/ProductForm.tsx): al cambio di categoria restano solo gli assi
 * che la categoria nuova fa variare.
 */
const toast = vi.hoisted(() => Object.assign(vi.fn(), {
  success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), loading: vi.fn(() => 't1'), dismiss: vi.fn(),
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

const CATEGORIE = [
  { id: 'c-abiti', name: 'Abbigliamento', slug: 'abbigliamento', parent_id: null },
  { id: 'c-maglie', name: 'Maglieria', slug: 'maglieria', parent_id: 'c-abiti' },
  { id: 'c-casa', name: 'Casa', slug: 'casa', parent_id: null },
];

const variante = (o: Record<string, string>, i: number) => ({ id: `v${i}`, options: o, label: Object.values(o).join(' · '), stock: 2, position: i });
const TAGLIE_PER_COLORI = ['S', 'M'].flatMap((taglia) => ['Bianco', 'Nero'].map((colore) => ({ taglia, colore }))).map(variante);

let div: HTMLDivElement;
let root: Root;

async function monta() {
  div = document.createElement('div');
  document.body.appendChild(div);
  root = createRoot(div);
  await act(async () => {
    root.render(createElement(ProductForm, {
      mode: 'edit', categories: CATEGORIE, aiAccesa: false, sellerOffersExpress: true, consegnaDelNegozioNonLetta: false,
      onSubmit: () => {},
      initialValues: { name: 'Plaid', description: 'Plaid in lana', price: 40, unit: 'pezzo', stock: 0,
        category_id: 'c-abiti', images: [], attributes: {}, tags: [], status: 'available', variants: TAGLIE_PER_COLORI },
    }));
  });
}

const etichetteVarianti = () =>
  [...div.querySelectorAll('input[aria-label^="Disponibilità "]')].map((i) => (i.getAttribute('aria-label') ?? '').replace('Disponibilità ', ''));

async function scegli(etichetta: string, valore: string) {
  const label = [...div.querySelectorAll('label')].find((l) => (l.textContent ?? '').trim().startsWith(etichetta));
  const select = (label?.htmlFor ? document.getElementById(label.htmlFor) : label?.parentElement?.querySelector('select')) as HTMLSelectElement | null;
  expect(select, `manca il menu «${etichetta}»`).toBeTruthy();
  const imposta = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
  await act(async () => {
    imposta.call(select, valore);
    select!.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

async function scriviNellAsse(etichettaAsse: string, valore: string) {
  const campo = div.querySelector(`input[aria-label="Aggiungi ${etichettaAsse}"]`) as HTMLInputElement;
  expect(campo, `manca il campo per aggiungere ${etichettaAsse}`).toBeTruthy();
  const imposta = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    imposta.call(campo, valore);
    campo.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => { campo.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
}

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => {
  act(() => root.unmount());
  div.remove();
});

describe('R02-020 · al cambio di categoria restano solo gli assi della categoria nuova', () => {
  it('controprova: in Abbigliamento il capo ha Taglia × Colore, 4 varianti', async () => {
    await monta();
    expect(etichetteVarianti()).toEqual(['S · Bianco', 'S · Nero', 'M · Bianco', 'M · Nero']);
  });

  it('da Abbigliamento a Casa la Taglia esce dalle varianti: restano i colori', async () => {
    await monta();
    await scegli('Categoria', 'c-casa');
    expect(etichetteVarianti(), 'la Taglia, che in Casa non si vede né si toglie, è rimasta fra le varianti').toEqual(['Bianco', 'Nero']);
  });

  it('in Casa un colore in più è una variante in più, non una per ogni taglia invisibile', async () => {
    await monta();
    await scegli('Categoria', 'c-casa');
    await scriviNellAsse('Colore', 'Rosso');
    expect(etichetteVarianti()).toEqual(['Bianco', 'Nero', 'Rosso']);
  });

  it('una sottocategoria della stessa categoria tiene gli assi e le scorte', async () => {
    await monta();
    await scegli('Sottocategoria', 'c-maglie');
    expect(etichetteVarianti()).toEqual(['S · Bianco', 'S · Nero', 'M · Bianco', 'M · Nero']);
    const scorte = [...div.querySelectorAll('input[aria-label^="Disponibilità "]')].map((i) => (i as HTMLInputElement).value);
    expect(scorte).toEqual(['2', '2', '2', '2']);
  });
});

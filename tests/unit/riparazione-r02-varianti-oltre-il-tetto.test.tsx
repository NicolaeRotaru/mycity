/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * R02-021 — Un capo con più di cento combinazioni di taglia e colore perdeva le ultime in silenzio.
 * Il modulo del negozio (components/seller/ProductForm.tsx) rigenerava le varianti con
 * reconcileVariants, che sopra i tetti di lib/products/variants.ts (100 combinazioni, 30 valori per
 * asse) ne tiene solo una parte senza dirlo: il negozio salvava 100 varianti credendo di averne 110,
 * e il cliente che sceglieva la coppia mancante non poteva comprarla. (La scheda prodotto dice già
 * «Questa combinazione non c'è» e spegne i valori senza variante.)
 *
 * Qui il modulo VERO: sopra un tetto gli assi non si applicano e il modulo dice perché; sotto, tutto
 * come prima, col conto delle combinazioni a vista.
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

const CATEGORIE = [{ id: 'c-abiti', name: 'Abbigliamento', slug: 'abbigliamento', parent_id: null }];
// Dieci taglie dalla lista del campo «Taglia» (lib/category-attributes.ts) e dieci colori.
const TAGLIE = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '36', '38', '40'];
const COLORI = ['Bianco', 'Nero', 'Blu', 'Rosso', 'Verde', 'Giallo', 'Grigio', 'Rosa', 'Viola', 'Beige'];

const variante = (o: Record<string, string>, i: number) => ({ id: `v${i}`, options: o, label: Object.values(o).join(' · '), stock: 2, position: i });
const cartesiano = (taglie: string[], colori: string[]) =>
  taglie.flatMap((taglia) => colori.map((colore) => ({ taglia, colore }))).map(variante);

let div: HTMLDivElement;
let root: Root;

async function monta(varianti: ReturnType<typeof variante>[]) {
  div = document.createElement('div');
  document.body.appendChild(div);
  root = createRoot(div);
  await act(async () => {
    root.render(createElement(ProductForm, {
      mode: 'edit', categories: CATEGORIE, aiAccesa: false, sellerOffersExpress: true, consegnaDelNegozioNonLetta: false,
      onSubmit: () => {},
      initialValues: { name: 'Maglia girocollo', description: 'Maglia in cotone', price: 25, unit: 'pezzo', stock: 0,
        category_id: 'c-abiti', images: [], attributes: {}, tags: [], status: 'available', variants: varianti },
    }));
  });
}

/** Le righe della tabella «Disponibilità per variante». */
const righeVarianti = () => [...div.querySelectorAll('input[aria-label^="Disponibilità "]')];
/** I valori di un asse, come chip con «Rimuovi …». */
const chip = (valore: string) => div.querySelector(`button[aria-label="Rimuovi ${valore}"]`);
const testo = () => (div.textContent ?? '').replace(/\s+/g, ' ');

async function clicSu(etichetta: string) {
  const b = [...div.querySelectorAll('button')].find((x) => (x.textContent ?? '').replace(/\s+/g, ' ').trim() === etichetta);
  expect(b, `manca il pulsante «${etichetta}»`).toBeTruthy();
  await act(async () => { b!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
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

describe('R02-021 · il modulo del negozio non taglia in silenzio le combinazioni', () => {
  it('controprova: 10 taglie × 10 colori sono 100 varianti, e il modulo ne mostra il conto', async () => {
    await monta(cartesiano(TAGLIE, COLORI));
    expect(righeVarianti()).toHaveLength(100);
    expect(testo()).toContain('100 di 100 combinazioni');
  });

  it('un\'undicesima taglia farebbe 110 combinazioni: non si aggiunge, e il modulo dice perché', async () => {
    await monta(cartesiano(TAGLIE, COLORI));
    await clicSu('42');
    expect(toast.error, 'il modulo deve dire che 110 combinazioni non entrano').toHaveBeenCalled();
    expect(String(toast.error.mock.calls.at(-1)?.[0])).toContain('110 combinazioni, il massimo è 100');
    expect(chip('42'), 'la taglia 42 è entrata fra gli assi: le sue combinazioni si perderebbero').toBeNull();
    expect(righeVarianti()).toHaveLength(100);
  });

  it('un colore oltre i 30 non si aggiunge: il trentunesimo sparirebbe senza dirlo', async () => {
    const trenta = Array.from({ length: 30 }, (_, i) => `Colore ${i + 1}`);
    await monta(trenta.map((colore, i) => variante({ colore }, i)));
    expect(righeVarianti()).toHaveLength(30);
    await scriviNellAsse('Colore', 'Colore 31');
    expect(String(toast.error.mock.calls.at(-1)?.[0] ?? '')).toContain('Colore: 31 valori, il massimo è 30');
    expect(chip('Colore 31')).toBeNull();
    expect(righeVarianti()).toHaveLength(30);
  });

  it('sotto i tetti tutto come prima: 9 taglie × 10 colori più un colore fanno 99 varianti, conservando le scorte', async () => {
    await monta(cartesiano(TAGLIE.slice(0, 9), COLORI.slice(0, 10)));
    expect(righeVarianti()).toHaveLength(90);
    await scriviNellAsse('Colore', 'Ocra');
    expect(toast.error).not.toHaveBeenCalled();
    expect(chip('Ocra')).not.toBeNull();
    expect(righeVarianti()).toHaveLength(99);
    expect(testo()).toContain('99 di 100 combinazioni');
    const prima = righeVarianti()[0] as HTMLInputElement;
    expect(prima.value).toBe('2');
  });
});

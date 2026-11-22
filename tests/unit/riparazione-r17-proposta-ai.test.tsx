/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * R17-012 — con la proposta di «Genera con AI» aperta, le correzioni fatte a mano nel campo non si
 * perdono in silenzio premendo «Usa questa»: se il testo è cambiato si chiede conferma.
 * (R03-006 — «Genera con AI» riscriveva la descrizione e la METTEVA AL POSTO di quella del
 * negoziante: tre frasi al posto di 700 caratteri con lievitazione e conservazione, e i dettagli
 * veri sparivano. Adesso, sopra un testo già scritto, il risultato è una proposta con «Usa questa»
 * e «Tieni la mia». Il prompt (già corretto prima) vieta di inventare e riceve la descrizione
 * attuale intera: qui lo si guarda anche dalla rotta.
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

const CATEGORIE = [{ id: 'c1', name: 'Panetteria', slug: 'panetteria', parent_id: null }];
const DEL_NEGOZIANTE =
  'Pane di Altamura a lievitazione naturale di 24 ore, cotto ogni mattina nel forno a legna. '.repeat(7) +
  'Si conserva tre giorni avvolto in un panno di cotone. FINE-DEL-TESTO';
const DELL_AI = 'Un pane rustico dalla crosta croccante. Ottimo con i salumi.';

let div: HTMLDivElement;
let root: Root;

async function monta(descrizione: string) {
  div = document.createElement('div');
  document.body.appendChild(div);
  root = createRoot(div);
  await act(async () => {
    root.render(createElement(ProductForm, {
      mode: 'edit', categories: CATEGORIE, aiAccesa: true, sellerOffersExpress: true, consegnaDelNegozioNonLetta: false,
      onSubmit: () => {},
      initialValues: { name: 'Pane di Altamura', description: descrizione, price: 4, unit: 'pezzo', stock: 1,
        category_id: 'c1', images: [], attributes: {}, tags: [], status: 'available', variants: [] },
    }));
  });
}

const bottone = (testo: RegExp) => [...div.querySelectorAll('button')].find((b) => testo.test(b.textContent ?? ''));
const campo = () => div.querySelector('textarea[name="description"]') as HTMLTextAreaElement;

async function clic(b: HTMLButtonElement | undefined) {
  expect(b, 'il pulsante non è a video').toBeTruthy();
  await act(async () => { b!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}


async function scrivi(valore: string) {
  await act(async () => {
    const el = campo();
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    setter.call(el, valore);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('R17-012 · «Usa questa» non butta le correzioni fatte a mano', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ description: DELL_AI }), { status: 200 }));
  });
  afterEach(() => {
    root.unmount();
    div.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('proposta aperta, modifica a mano, «Usa questa»: se il venditore dice no, la modifica resta', async () => {
    const conferma = vi.fn(() => false);
    vi.stubGlobal('confirm', conferma);
    await monta(DEL_NEGOZIANTE);
    await clic(bottone(/Genera con AI/));
    await scrivi(DEL_NEGOZIANTE + ' MODIFICA-A-MANO');
    await clic(bottone(/Usa questa/));
    expect(conferma).toHaveBeenCalledTimes(1);
    expect(campo().value).toContain('MODIFICA-A-MANO');
    expect(campo().value).not.toBe(DELL_AI);
  });

  it('se il venditore conferma, la proposta prende il posto del testo', async () => {
    vi.stubGlobal('confirm', () => true);
    await monta(DEL_NEGOZIANTE);
    await clic(bottone(/Genera con AI/));
    await scrivi(DEL_NEGOZIANTE + ' MODIFICA-A-MANO');
    await clic(bottone(/Usa questa/));
    expect(campo().value).toBe(DELL_AI);
  });

  it('senza modifiche a mano non chiede niente', async () => {
    const conferma = vi.fn(() => false);
    vi.stubGlobal('confirm', conferma);
    await monta(DEL_NEGOZIANTE);
    await clic(bottone(/Genera con AI/));
    await clic(bottone(/Usa questa/));
    expect(conferma).not.toHaveBeenCalled();
    expect(campo().value).toBe(DELL_AI);
  });
});

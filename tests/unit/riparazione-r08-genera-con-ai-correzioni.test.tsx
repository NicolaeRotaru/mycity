/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
vi.mock('@/lib/funzioni-al-lancio', async (originale) => ({ ...((await originale()) as Record<string, unknown>), AI_NEGOZI_ACCESA: true }));

/**
 * R08-007 — «Usa questa» chiede conferma se la descrizione e' cambiata dopo la proposta, ma il
 * testo con cui si confrontava era quello di quando la risposta ARRIVA, non di quando si preme
 * «Genera»: una correzione fatta durante l'attesa finiva dentro il «testo di partenza», e premendo
 * «Usa questa» spariva senza nessuna conferma.
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
const T0 = 'Pane di Altamura a lievitazione naturale di 24 ore, cotto ogni mattina nel forno a legna.';
const CORREZIONE = ' CORREZIONE-A-MANO: si conserva tre giorni.';
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
}
async function scrivi(testo: string) {
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    set.call(campo(), testo);
    campo().dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('R08-007 · «Usa questa» si accorge delle correzioni fatte mentre la proposta era in arrivo', () => {
  let rispondi: () => void = () => undefined;
  let conferma: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    conferma = vi.fn(() => false);
    vi.stubGlobal('confirm', conferma);
    window.confirm = conferma as unknown as typeof window.confirm;
    // La risposta dell'AI resta in attesa finche' la prova non la lascia andare.
    vi.stubGlobal('fetch', () => new Promise<Response>((ok) => {
      rispondi = () => ok(new Response(JSON.stringify({ description: DELL_AI }), { status: 200 }));
    }));
  });
  afterEach(() => {
    root.unmount();
    div.remove();
    vi.unstubAllGlobals();
  });

  async function generaConUnaCorrezioneNellAttesa() {
    await monta(T0);
    await clic(bottone(/Genera con AI/));
    await scrivi(T0 + CORREZIONE);
    await act(async () => { rispondi(); await new Promise((r) => setTimeout(r, 0)); });
    expect(div.textContent, 'la proposta non e arrivata').toContain(DELL_AI);
  }

  it('la correzione fatta durante l attesa: «Usa questa» chiede conferma, e con «no» la correzione resta', async () => {
    await generaConUnaCorrezioneNellAttesa();
    await clic(bottone(/Usa questa/));
    expect(conferma, 'nessuna conferma: la correzione sparirebbe').toHaveBeenCalledTimes(1);
    expect(campo().value).toBe(T0 + CORREZIONE);
  });

  it('con «sì» alla conferma la proposta entra nel campo', async () => {
    conferma.mockReturnValue(true);
    await generaConUnaCorrezioneNellAttesa();
    await clic(bottone(/Usa questa/));
    expect(conferma).toHaveBeenCalledTimes(1);
    expect(campo().value).toBe(DELL_AI);
  });

  it('CONTROLLO: senza correzioni nell attesa, «Usa questa» non chiede niente', async () => {
    await monta(T0);
    await clic(bottone(/Genera con AI/));
    await act(async () => { rispondi(); await new Promise((r) => setTimeout(r, 0)); });
    await clic(bottone(/Usa questa/));
    expect(conferma).not.toHaveBeenCalled();
    expect(campo().value).toBe(DELL_AI);
  });
});

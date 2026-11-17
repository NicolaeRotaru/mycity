/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { monta, nomeAccessibile } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';

/**
 * R33-025 — «Compila con una foto» non scrive sopra quello che il negoziante ha scritto a mano, e
 * allergeni e ingredienti letti dall'etichetta restano una proposta da confermare.
 *
 * Il fornaio apre la sua focaccia (allergeni scritti a mano: «Glutine, sesamo») e la rifotografa
 * per cambiare la foto. Il modello legge male l'etichetta: «Latte». Prima il campo Allergeni
 * diventava «Latte», il nome e la descrizione quelli del modello. Qui il modulo si monta per
 * davvero, la foto passa dal pulsante vero e la lettura arriva dalla rotta finta.
 */

const avvisi = vi.hoisted(() => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    loading: vi.fn(() => 'avviso'),
    dismiss: vi.fn(),
  }),
}));
vi.mock('sonner', () => ({ toast: avvisi.toast, Toaster: () => null }));

/** Un'immagine che si «carica» subito: jsdom senza il pacchetto canvas non ne carica nessuna. */
class ImmagineFinta {
  width = 800;
  height = 600;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(_v: string) {
    setTimeout(() => this.onload?.(), 0);
  }
}

const CATEGORIE = [{ id: 'alim', name: 'Alimentari', slug: 'alimentari', parent_id: null }];
let lettaDallaFoto: Record<string, unknown>;

beforeEach(() => {
  for (const f of [avvisi.toast, ...Object.values(avvisi.toast)]) (f as ReturnType<typeof vi.fn>).mockClear?.();
  vi.stubGlobal('Image', ImmagineFinta);
  const tela = window.HTMLCanvasElement.prototype as unknown as Record<string, unknown>;
  vi.spyOn(window.HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => ({ fillStyle: '', fillRect: () => {}, drawImage: () => {} }) as unknown as CanvasRenderingContext2D,
  );
  tela.toDataURL = () => 'data:image/jpeg;base64,QUJD';
  tela.toBlob = (cb: (b: Blob | null) => void) => cb(new Blob(['x'], { type: 'image/jpeg' }));
  vi.stubGlobal('fetch', async (url: string) => {
    if (String(url) === '/api/vision/extract-product') {
      return new Response(JSON.stringify(lettaDallaFoto), { status: 200 });
    }
    throw new Error(`chiamata inattesa: ${url}`);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function apriLaFocaccia(attributi: Record<string, unknown>, nome = 'Focaccia genovese del forno', descrizione = 'La nostra focaccia, alta e morbida.') {
  const mod = await monta('components/seller/ProductForm.tsx');
  return accendi(mod.default, {
    aiAccesa: true,
    mode: 'edit',
    categories: CATEGORIE,
    initialValues: {
      name: nome,
      description: descrizione,
      price: 4.5,
      unit: 'pezzo',
      stock: 10,
      category_id: 'alim',
      images: [],
      attributes: attributi,
      tags: [],
      status: 'available',
      variants: [],
      condition: 'nuovo',
    },
    onSubmit: () => {},
  });
}
type Schermo = Awaited<ReturnType<typeof apriLaFocaccia>>;

/** Passa una foto dal pulsante «Compila con una foto» e aspetta che il modulo l'abbia letta. */
async function fotografa(s: Schermo) {
  const input = Array.from(s.radice.querySelectorAll<HTMLInputElement>('input[type="file"]')).find((i) =>
    (i.parentElement?.textContent ?? '').includes('Compila con una foto'),
  );
  expect(input, 'il pulsante «Compila con una foto» non è a video: la prova girerebbe a vuoto').toBeTruthy();
  Object.defineProperty(input!, 'files', {
    configurable: true,
    value: [new File(['x'], 'focaccia.jpg', { type: 'image/jpeg' })],
  });
  s.agisci(() => {
    input!.dispatchEvent(new window.Event('change', { bubbles: true }));
  });
  for (let i = 0; i < 100; i++) {
    if (avvisi.toast.success.mock.calls.some((c) => String(c[0]).startsWith('Campi compilati'))) break;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  }
  const errori = avvisi.toast.error.mock.calls.map((c) => String(c[0]));
  expect(
    avvisi.toast.success.mock.calls.some((c) => String(c[0]).startsWith('Campi compilati')),
    `la lettura della foto non è arrivata al modulo (${errori.join(' · ')})`,
  ).toBe(true);
}

/** Il campo col nome che sente un lettore di schermo (gli obbligatori portano anche l'asterisco). */
const campo = (s: Schermo, etichetta: string) =>
  Array.from(s.radice.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')).find(
    (x) => nomeAccessibile(x).replace(/\s*\*\s*$/, '').trim() === etichetta,
  );
const nomiDeiCampi = (s: Schermo) =>
  Array.from(s.radice.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')).map((x) => nomeAccessibile(x));
const daControllare = (s: Schermo) =>
  Array.from(s.radice.querySelectorAll('section')).find((x) => (x.textContent ?? '').includes('Da controllare'));

describe('R33-025 — «Compila con una foto» nel modulo del prodotto', () => {
  it('allergeni e ingredienti letti dalla foto non entrano nei campi: restano in «Da controllare»', async () => {
    lettaDallaFoto = {
      name: 'Focaccia',
      category_id: 'alim',
      attributes: { allergeni: 'Latte', ingredienti: 'farina, acqua, latte' },
    };
    const s = await apriLaFocaccia({ allergeni: 'Glutine, sesamo' });
    await fotografa(s);

    expect(campo(s, 'Allergeni'), `il campo Allergeni non è a video (${nomiDeiCampi(s).join(' · ')})`).toBeTruthy();
    expect(campo(s, 'Allergeni')?.value, 'la foto ha scritto sopra gli allergeni scritti a mano').toBe('Glutine, sesamo');
    expect(campo(s, 'Ingredienti')?.value ?? '', 'gli ingredienti letti dalla foto sono entrati senza conferma').toBe('');
    const riquadro = daControllare(s)?.textContent ?? '';
    expect(riquadro, 'la proposta degli allergeni non si vede').toContain('Latte');
    expect(riquadro, 'la proposta degli ingredienti non si vede').toContain('farina, acqua, latte');
    s.smonta();
  }, 60000);

  it('nome, descrizione e caratteristiche scritte a mano restano; i campi vuoti si riempiono', async () => {
    lettaDallaFoto = {
      name: 'Focaccia',
      description: 'Focaccia letta dalla foto.',
      category_id: 'alim',
      attributes: { marca: 'Marca della foto', peso: '300 g' },
    };
    const s = await apriLaFocaccia({ marca: 'Forno Bianchi' });
    await fotografa(s);

    expect(campo(s, 'Nome prodotto')?.value, 'la foto ha cambiato il nome scritto a mano').toBe('Focaccia genovese del forno');
    expect(campo(s, 'Descrizione')?.value, 'la foto ha cambiato la descrizione scritta a mano').toBe('La nostra focaccia, alta e morbida.');
    expect(campo(s, 'Marca')?.value, 'la foto ha scritto sopra la marca scritta a mano').toBe('Forno Bianchi');
    expect(campo(s, 'Peso / Quantità')?.value, 'il campo vuoto non si è riempito dalla foto').toBe('300 g');
    s.smonta();
  }, 60000);

  it('su una scheda vuota nome e descrizione della foto entrano (il verde di controllo)', async () => {
    lettaDallaFoto = { name: 'Focaccia', description: 'Focaccia letta dalla foto.', category_id: 'alim', attributes: {} };
    const s = await apriLaFocaccia({}, '', '');
    await fotografa(s);
    expect(campo(s, 'Nome prodotto')?.value).toBe('Focaccia');
    expect(campo(s, 'Descrizione')?.value).toBe('Focaccia letta dalla foto.');
    s.smonta();
  }, 60000);
});

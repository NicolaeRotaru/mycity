/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { monta, nomeAccessibile } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';

/**
 * 30/10/2026 — «USATO» LETTO DALLA FOTO NON ENTRA NEMMENO NEL MODULO MONTATO.
 *
 * MyCity non vende l'usato (CONTESTO_BUSINESS.md). `l-usato-non-entra-da-nessuna-porta.test.ts`
 * prova le regole in `lib/`, ma la porta «Compila con una foto» del modulo del prodotto
 * (`handleExtracted` in ProductForm) scriveva la condizione per conto suo: con
 * `normalizeCondition` al posto di `condizioneDalSuggerimento`, la foto di una bici con
 * «condizione: usato» metteva «Usato» nel menu della condizione, e il negoziante salvava un
 * prodotto usato senza averlo scelto. Rimettere quella riga lasciava verde tutto il resto.
 *
 * Qui il modulo si monta per davvero, la foto passa dal pulsante vero, la risposta della lettura
 * arriva dalla rotta finta, e si guarda cosa dice il menu «Condizione».
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

let lettaDallaFoto: Record<string, unknown>;

beforeEach(() => {
  for (const f of [avvisi.toast, ...Object.values(avvisi.toast)]) (f as ReturnType<typeof vi.fn>).mockClear?.();
  vi.stubGlobal('Image', ImmagineFinta);
  const tela = window.HTMLCanvasElement.prototype as unknown as Record<string, unknown>;
  vi.spyOn(window.HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => ({ drawImage: () => {} }) as unknown as CanvasRenderingContext2D,
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

async function apri(condizioneSalvata?: string) {
  const mod = await monta('components/seller/ProductForm.tsx');
  return accendi(mod.default, {
    // I pulsanti AI, come il giorno in cui si riaccendono (al lancio sono spenti).
    aiAccesa: true,
    mode: condizioneSalvata ? 'edit' : 'create',
    categories: [],
    initialValues: condizioneSalvata
      ? {
          name: 'Bicicletta da città',
          description: 'Bicicletta da città con cestino.',
          price: 120,
          unit: 'pezzo',
          stock: 1,
          category_id: '',
          images: [],
          attributes: {},
          tags: [],
          status: 'available',
          variants: [],
          condition: condizioneSalvata,
        }
      : undefined,
    onSubmit: () => {},
  });
}
type Schermo = Awaited<ReturnType<typeof apri>>;

const menuCondizione = (s: Schermo) =>
  Array.from(s.radice.querySelectorAll('select')).find((x) => nomeAccessibile(x) === 'Condizione');

/** Passa una foto dal pulsante «Compila con una foto» e aspetta che il modulo l'abbia letta. */
async function fotografa(s: Schermo, condizione: string) {
  lettaDallaFoto = { name: 'Bicicletta da città', attributes: { condizione } };
  const input = Array.from(s.radice.querySelectorAll<HTMLInputElement>('input[type="file"]')).find((i) =>
    (i.parentElement?.textContent ?? '').includes('Compila con una foto'),
  );
  expect(input, 'il pulsante «Compila con una foto» non è a video: la prova girerebbe a vuoto').toBeTruthy();
  Object.defineProperty(input!, 'files', {
    configurable: true,
    value: [new File(['x'], 'bici.jpg', { type: 'image/jpeg' })],
  });
  s.agisci(() => {
    input!.dispatchEvent(new window.Event('change', { bubbles: true }));
  });
  for (let i = 0; i < 100; i++) {
    const letta = avvisi.toast.success.mock.calls.some((c) => String(c[0]).startsWith('Campi compilati'));
    if (letta) break;
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

describe('«Compila con una foto» nel modulo del prodotto', () => {
  it.each(['usato', 'Usato, come nuovo', 'Ricondizionato garantito'])(
    'la foto dice «%s»: il menu della condizione resta vuoto e non offre l’usato',
    async (condizione) => {
      const s = await apri();
      await fotografa(s, condizione);
      const menu = menuCondizione(s);
      expect(menu, 'il menu «Condizione» non è a video').toBeTruthy();
      expect(menu!.value, `la foto ha scritto «${menu!.value}» nella condizione`).toBe('');
      const scelte = Array.from(menu!.querySelectorAll('option')).map((o) => o.value);
      expect(scelte, 'il menu offre l’usato dopo la foto').not.toContain('usato');
      expect(scelte).not.toContain('ricondizionato');
      s.smonta();
    },
  );

  it('la foto dice «nuovo»: la condizione si compila (la porta è aperta per ciò che il menu offre)', async () => {
    const s = await apri();
    await fotografa(s, 'Nuovo con etichetta');
    expect(menuCondizione(s)!.value).toBe('nuovo');
    s.smonta();
  });

  it('un prodotto vecchio salvato «usato» non diventa «ricondizionato» per una foto, e non perde il suo valore', async () => {
    const s = await apri('usato');
    expect(menuCondizione(s)!.value).toBe('usato');
    await fotografa(s, 'ricondizionato');
    expect(menuCondizione(s)!.value, 'la foto ha riscritto la condizione salvata').toBe('usato');
    s.smonta();
  });
});

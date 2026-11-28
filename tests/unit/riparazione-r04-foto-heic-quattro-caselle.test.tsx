/**
 * @vitest-environment jsdom
 */
/**
 * R04-003 — LE FOTO HEIC DELL'IPHONE NON SI SALVANO PIU' COSI' COME SONO: DIVENTANO JPEG, O NON PARTONO.
 *
 * Quattro caselle — le foto delle recensioni, le storie 24h, la galleria e la copertina del sito
 * del negozio. Un HEIC salvato com'era su Chrome e Android restava un riquadro rotto; poi si
 * rifiutava sempre, anche dove il browser lo sa leggere. Qui si montano i componenti veri
 * (react-dropzone vero) e si guarda cosa arriva al caricamento:
 *   · su un browser che sa leggere l'HEIC (Safari: qui `createImageBitmap` e la tela simulati)
 *     arriva un JPEG — tipo image/jpeg, nome .jpg — anche col tipo vuoto, come lo consegna un PC;
 *   · una foto da 24 MP si rimpicciolisce sotto il tetto della tela di Safari (4096 × 4096);
 *   · dove il browser non lo sa leggere non parte niente, e chi carica legge perche';
 *   · JPEG e PNG arrivano intatti, lo stesso file.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { screen, within, fireEvent } from '@testing-library/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const stato = vi.hoisted(() => ({
  errori: [] as string[],
  caricati: [] as File[],
  disegni: [] as Array<{ larghezza: number; altezza: number; telaL: number; telaA: number }>,
}));

vi.mock('sonner', () => ({
  toast: Object.assign(() => undefined, {
    success: () => undefined,
    info: () => undefined,
    error: (m: unknown) => { stato.errori.push(String(m)); },
  }),
}));
vi.mock('@/lib/storage/carica-immagine', async (orig) => ({
  ...(await orig<typeof import('@/lib/storage/carica-immagine')>()),
  caricaImmagine: async (_c: unknown, r: { file: File }) => {
    stato.caricati.push(r.file);
    return { percorso: `u/x/${stato.caricati.length}.jpg`, publicUrl: `https://foto/${stato.caricati.length}.jpg` };
  },
}));
vi.mock('@/lib/supabase/client', () => {
  const lettura = () => {
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'order']) q[m] = () => q;
    q.limit = async () => ({ data: [], error: null });
    return q;
  };
  return {
    supabase: {
      auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
      from: () => ({ ...lettura(), insert: async () => ({ error: null }) }),
      storage: { from: () => ({ remove: async () => ({}) }) },
    },
  };
});
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('next/image', async () => {
  const { createElement: ce } = await import('react');
  return { default: (p: Record<string, unknown>) => ce('img', { src: String(p.src ?? ''), alt: String(p.alt ?? '') }) };
});

import PhotoReviewUpload from '@/components/PhotoReviewUpload';
import SellerStoriesPage from '@/app/seller/stories/page';
import GalleryFields from '@/components/seller/site/GalleryFields';
import { SingleImageUpload } from '@/components/seller/site/ImageUpload';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
const accesi: Root[] = [];
const aspetta = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

/** Un browser che sa leggere l'HEIC, come Safari: la foto si decodifica e la tela codifica il JPEG. */
function browserCheLoSaLeggere(larghezza = 4032, altezza = 3024) {
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: larghezza, height: altezza, close: () => undefined })));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    const tela = this;
    return {
      fillStyle: '',
      fillRect: () => undefined,
      drawImage: (_s: unknown, _x: number, _y: number, l: number, a: number) => {
        stato.disegni.push({ larghezza: l, altezza: a, telaL: tela.width, telaA: tela.height });
      },
    } as never;
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (cb: BlobCallback, tipo?: string) {
    cb(new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: String(tipo) }));
  });
}

/** Un browser che non sa leggere l'HEIC, come Chrome: la decodifica fallisce, con o senza <img>. */
function browserCheNonLoSaLeggere() {
  vi.stubGlobal('createImageBitmap', vi.fn(async () => { throw new DOMException('The source image could not be decoded.', 'InvalidStateError'); }));
  Object.defineProperty(HTMLImageElement.prototype, 'decode', {
    configurable: true,
    value: () => Promise.reject(new DOMException('The source image cannot be decoded.', 'EncodingError')),
  });
}

beforeEach(() => {
  stato.errori.length = 0;
  stato.caricati.length = 0;
  stato.disegni.length = 0;
});
afterEach(() => {
  for (const r of accesi.splice(0)) act(() => r.unmount());
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (HTMLImageElement.prototype as unknown as Record<string, unknown>).decode;
});

async function monta(el: ReactElement): Promise<HTMLElement> {
  const radice = document.createElement('div');
  document.body.appendChild(radice);
  const root = createRoot(radice);
  accesi.push(root);
  await act(async () => { root.render(el); });
  return radice;
}

const DALL_IPHONE = () => new File([new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112])], 'IMG_0421.HEIC', { type: 'image/heic' });
const DAL_PC = () => new File([new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112])], 'IMG_0421.heic', { type: '' });
const UN_HEIF = () => new File([new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112])], 'scatto.heif', { type: 'image/heif' });
const UN_JPG = () => new File([new Uint8Array([0xff, 0xd8, 0xff])], 'negozio.jpg', { type: 'image/jpeg' });
const UN_PNG = () => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'logo.png', { type: 'image/png' });

async function scegli(input: HTMLInputElement, files: File[]) {
  await act(async () => { fireEvent.change(input, { target: { files } }); });
  await aspetta();
}

function campoFile(radice: HTMLElement): HTMLInputElement {
  const input = radice.querySelector('input[type="file"]') as HTMLInputElement | null;
  expect(input, 'controprova: il campo file c e').toBeTruthy();
  return input!;
}

/** Arrivato al caricamento: un JPEG vero, mai un HEIC. */
function arrivatoUnJpeg(nome: string) {
  expect(stato.caricati, 'al caricamento doveva arrivare una foto').toHaveLength(1);
  const f = stato.caricati[0];
  expect(f.type, 'al magazzino e arrivato un HEIC, che Chrome e Android non mostrano').toBe('image/jpeg');
  expect(f.name).toBe(nome);
  expect(f.name).not.toMatch(/\.hei[cf]$/i);
  expect(stato.errori).toEqual([]);
}

function nonPartitoEDettoPerche() {
  expect(stato.caricati, 'un HEIC che il browser non sa convertire e partito lo stesso').toHaveLength(0);
  const detto = stato.errori.join(' ');
  expect(detto).toMatch(/HEIC/);
  expect(detto).toMatch(/JPG/);
}

/**
 * Ogni casella si guida allo stesso modo: si sceglie (o si trascina) un file e si guarda cosa
 * arriva al caricamento. Le storie hanno un passo in piu': il tasto «Pubblica».
 */
type Casella = { nome: string; carica: (files: File[]) => Promise<void> };

const CASELLE: Casella[] = [
  {
    nome: 'foto delle recensioni (PhotoReviewUpload)',
    carica: async (files) => {
      const r = await monta(createElement(PhotoReviewUpload, { userId: 'u1', productId: 'p1', onUploaded: () => {} }));
      await scegli(campoFile(r), files);
    },
  },
  {
    nome: 'storie 24h (pagina delle storie)',
    carica: async (files) => {
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
      await monta(createElement(QueryClientProvider, { client: qc }, createElement(SellerStoriesPage)));
      await aspetta();
      await act(async () => { screen.getByRole('button', { name: /Nuova storia/ }).click(); });
      const dialogo = screen.getByRole('dialog');
      await scegli(dialogo.querySelector('input[type="file"]') as HTMLInputElement, files);
      const pubblica = within(dialogo).getByRole('button', { name: /Pubblica/ }) as HTMLButtonElement;
      if (!pubblica.disabled) {
        await act(async () => { pubblica.click(); });
        await aspetta();
      }
    },
  },
  {
    nome: 'galleria della vetrina (GalleryFields)',
    carica: async (files) => {
      const sezione = { id: 'g1', type: 'gallery', config: { items: [] } } as never;
      const r = await monta(createElement(GalleryFields, { section: sezione, onChange: () => {} }));
      await scegli(campoFile(r), files);
    },
  },
  {
    nome: 'copertina del sito (SingleImageUpload)',
    carica: async (files) => {
      const r = await monta(createElement(SingleImageUpload, { value: '', onChange: () => {} }));
      await scegli(campoFile(r), files);
    },
  },
];

describe.each(CASELLE)('R04-003 — $nome', ({ carica }) => {
  it('un HEIC dall iPhone, dove il browser lo sa leggere, arriva come JPEG', async () => {
    browserCheLoSaLeggere();
    await carica([DALL_IPHONE()]);
    arrivatoUnJpeg('IMG_0421.jpg');
  });

  it('un HEIC da un PC, col tipo vuoto, arriva come JPEG', async () => {
    browserCheLoSaLeggere();
    await carica([DAL_PC()]);
    arrivatoUnJpeg('IMG_0421.jpg');
  });

  it('un HEIF arriva come JPEG', async () => {
    browserCheLoSaLeggere();
    await carica([UN_HEIF()]);
    arrivatoUnJpeg('scatto.jpg');
  });

  it('dove il browser non sa leggere l HEIC non parte niente, e chi carica sa perche', async () => {
    browserCheNonLoSaLeggere();
    await carica([DAL_PC()]);
    nonPartitoEDettoPerche();
  });

  it('un JPG arriva intatto, lo stesso file', async () => {
    browserCheLoSaLeggere();
    const jpg = UN_JPG();
    await carica([jpg]);
    expect(stato.caricati).toHaveLength(1);
    expect(stato.caricati[0].name).toBe('negozio.jpg');
    expect(stato.caricati[0].type).toBe('image/jpeg');
    expect(await stato.caricati[0].arrayBuffer()).toEqual(await jpg.arrayBuffer());
    expect(stato.disegni, 'un JPG non va ridisegnato').toEqual([]);
  });

  it('un PNG arriva intatto', async () => {
    browserCheLoSaLeggere();
    await carica([UN_PNG()]);
    expect(stato.caricati.map((f) => [f.name, f.type])).toEqual([['logo.png', 'image/png']]);
    expect(stato.disegni).toEqual([]);
  });
});

describe('R04-003 — la foto da 24 MP di un iPhone recente', () => {
  it('si rimpicciolisce sotto il tetto della tela di Safari (4096 × 4096) e arriva come JPEG', async () => {
    browserCheLoSaLeggere(5712, 4284);
    await CASELLE[0].carica([DALL_IPHONE()]);
    arrivatoUnJpeg('IMG_0421.jpg');
    expect(stato.disegni).toHaveLength(1);
    const d = stato.disegni[0];
    expect(Math.max(d.telaL, d.telaA)).toBeLessThanOrEqual(4096);
    expect(d.telaL * d.telaA, 'la tela supera 16.777.216 pixel: su iPhone toBlob fallisce').toBeLessThanOrEqual(16_777_216);
    expect(d.larghezza / d.altezza).toBeCloseTo(5712 / 4284, 2);
  });

  it('una foto piu piccola del tetto resta della sua misura', async () => {
    browserCheLoSaLeggere(4032, 3024);
    await CASELLE[0].carica([DALL_IPHONE()]);
    expect(stato.disegni.map((d) => [d.telaL, d.telaA])).toEqual([[4032, 3024]]);
  });
});

describe('R04-003 — piu foto insieme nelle recensioni', () => {
  it('l HEIC convertito e il JPG partono tutti e due', async () => {
    browserCheLoSaLeggere();
    await CASELLE[0].carica([DAL_PC(), UN_JPG()]);
    expect(stato.caricati.map((f) => [f.name, f.type])).toEqual([
      ['IMG_0421.jpg', 'image/jpeg'],
      ['negozio.jpg', 'image/jpeg'],
    ]);
  });

  it('dove il browser non sa leggere l HEIC, il JPG parte lo stesso', async () => {
    browserCheNonLoSaLeggere();
    await CASELLE[0].carica([DAL_PC(), UN_JPG()]);
    expect(stato.caricati.map((f) => f.name)).toEqual(['negozio.jpg']);
    expect(stato.errori.join(' ')).toMatch(/HEIC/);
  });
});

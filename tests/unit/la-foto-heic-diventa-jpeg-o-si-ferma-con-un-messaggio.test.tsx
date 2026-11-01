// @vitest-environment jsdom
/**
 * La foto HEIC dell'iPhone, nei quattro punti di caricamento (foto delle recensioni, storie 24h,
 * galleria e copertina del sito del negozio):
 *   · se il browser sa leggerla → parte come JPEG (contentType image/jpeg), non come HEIC che
 *     Chrome/Android mostrano come un riquadro rotto;
 *   · se non sa leggerla → NON parte, e chi carica legge «questa foto è in formato HEIC…».
 * Nessuna decodifica vera: createImageBitmap e il canvas sono finti.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const h = vi.hoisted(() => ({
  carica: vi.fn(),
  toastError: vi.fn(),
  dropzone: [] as Array<{ onDrop: (f: File[]) => Promise<void> }>,
  mutazioni: [] as Array<{ mutationFn: () => Promise<unknown>; onError?: (e: unknown) => void }>,
}));

vi.mock('@/lib/storage/carica-immagine', async (orig) => ({
  ...(await orig<typeof import('@/lib/storage/carica-immagine')>()),
  caricaImmagine: h.carica,
}));
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: () => ({ insert: async () => ({ error: null }) }),
    storage: { from: () => ({ remove: async () => ({}) }) },
  },
}));
vi.mock('sonner', () => ({ toast: { error: h.toastError, success: vi.fn() } }));
vi.mock('next/image', () => ({ default: () => null }));
vi.mock('react-dropzone', () => ({
  useDropzone: (o: { onDrop: (f: File[]) => Promise<void> }) => {
    h.dropzone.push(o);
    return { getRootProps: () => ({}), getInputProps: () => ({}), isDragActive: false };
  },
}));
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: [], isPending: false, isError: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useMutation: (o: { mutationFn: () => Promise<unknown>; onError?: (e: unknown) => void }) => {
    h.mutazioni.push(o);
    return { mutate: vi.fn() };
  },
}));
vi.mock('@/components/ui/Modal', () => ({
  Modal: ({ children }: { children?: unknown }) => createElement('div', null, children as never),
}));
vi.mock('@/components/seller/SellerPageTitle', () => ({ default: () => null }));
vi.mock('@/components/EmptyState', () => ({ default: () => null }));
vi.mock('@/components/ConfirmDialog', () => ({ confirmDialog: vi.fn() }));

import PhotoReviewUpload from '@/components/PhotoReviewUpload';
import SellerStoriesPage from '@/app/seller/stories/page';
import GalleryFields from '@/components/seller/site/GalleryFields';
import { SingleImageUpload, uploadSiteImage } from '@/components/seller/site/ImageUpload';

const MESSAGGIO = /formato HEIC: salvala come JPG/;
const heic = () => new File(['heic-grezzo'], 'IMG_0001.HEIC', { type: 'image/heic' });
const jpeg = () => new File(['jpeg'], 'vetrina.jpg', { type: 'image/jpeg' });

function decodificaRiesce() {
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 4, height: 3, close: () => {} })));
  HTMLCanvasElement.prototype.getContext = (() => ({ drawImage: () => {} })) as never;
  HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback, type?: string) {
    cb(new Blob(['jpeg-convertito'], { type }));
  };
}
function decodificaFallisce() {
  vi.stubGlobal('createImageBitmap', vi.fn(async () => { throw new DOMException('formato non supportato'); }));
}
const fileCaricati = () => h.carica.mock.calls.map((c) => (c[1] as { file: File }).file);

let root: Root | null = null;
let box: HTMLDivElement;
async function monta(el: ReturnType<typeof createElement>) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  box = document.createElement('div');
  document.body.appendChild(box);
  root = createRoot(box);
  await act(async () => { root!.render(el); });
}
async function scegliFile(input: HTMLInputElement, files: File[]) {
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

beforeEach(() => {
  h.carica.mockReset();
  h.carica.mockImplementation(async (_c: unknown, r: { file: File }) => ({ percorso: `u1/${r.file.name}`, publicUrl: `https://cdn/${r.file.name}` }));
  h.toastError.mockReset();
  h.dropzone.length = 0;
  h.mutazioni.length = 0;
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  vi.unstubAllGlobals();
});

describe('foto delle recensioni', () => {
  it('HEIC illeggibile: non parte e compare il messaggio; la foto buona scelta insieme parte', async () => {
    decodificaFallisce();
    await monta(createElement(PhotoReviewUpload, { userId: 'u1', productId: 'p1', onUploaded: () => {} }));
    await scegliFile(box.querySelector('input[type=file]')!, [heic(), jpeg()]);
    expect(fileCaricati().map((f) => f.type)).toEqual(['image/jpeg']);
    expect(fileCaricati()[0].name).toBe('vetrina.jpg');
    expect(h.toastError.mock.calls.flat().join(' ')).toMatch(MESSAGGIO);
  });
  it('HEIC leggibile: parte come JPEG', async () => {
    decodificaRiesce();
    await monta(createElement(PhotoReviewUpload, { userId: 'u1', productId: 'p1', onUploaded: () => {} }));
    await scegliFile(box.querySelector('input[type=file]')!, [heic()]);
    expect(fileCaricati().map((f) => [f.type, f.name])).toEqual([['image/jpeg', 'IMG_0001.jpg']]);
  });
});

describe('storie 24h', () => {
  async function pubblica(file: File) {
    await monta(createElement(SellerStoriesPage));
    await scegliFile(box.querySelector('#foto-storia') as HTMLInputElement, [file]);
    // La pagina crea due mutazioni a ogni render: «create» (pubblica) e «del» (cancella).
    return h.mutazioni[h.mutazioni.length - 2];
  }
  it('HEIC illeggibile: la storia non parte e chi carica legge il messaggio', async () => {
    decodificaFallisce();
    const m = await pubblica(heic());
    const err = await m.mutationFn().then(() => null, (e: unknown) => e);
    expect(h.carica).not.toHaveBeenCalled();
    m.onError?.(err);
    expect(h.toastError.mock.calls.flat().join(' ')).toMatch(MESSAGGIO);
  });
  it('HEIC leggibile: parte come JPEG', async () => {
    decodificaRiesce();
    const m = await pubblica(heic());
    await m.mutationFn();
    expect(fileCaricati().map((f) => f.type)).toEqual(['image/jpeg']);
  });
});

describe('sito del negozio: copertina e galleria', () => {
  it('uploadSiteImage: HEIC leggibile parte come JPEG, illeggibile non parte', async () => {
    decodificaRiesce();
    await uploadSiteImage(heic());
    expect(fileCaricati().map((f) => f.type)).toEqual(['image/jpeg']);
    h.carica.mockClear();
    decodificaFallisce();
    await expect(uploadSiteImage(heic())).rejects.toThrow(MESSAGGIO);
    expect(h.carica).not.toHaveBeenCalled();
  });
  it('copertina: HEIC illeggibile mostra il messaggio', async () => {
    decodificaFallisce();
    await monta(createElement(SingleImageUpload, { value: '', onChange: () => {} }));
    await act(async () => { await h.dropzone[h.dropzone.length - 1].onDrop([heic()]); });
    expect(h.carica).not.toHaveBeenCalled();
    expect(h.toastError.mock.calls.flat().join(' ')).toMatch(MESSAGGIO);
  });
  it('galleria: la HEIC illeggibile resta fuori col messaggio, la foto buona entra', async () => {
    decodificaFallisce();
    const onChange = vi.fn();
    const section = { id: 's1', type: 'gallery', config: { heading: '', items: [] } } as never;
    await monta(createElement(GalleryFields, { section, onChange }));
    await act(async () => { await h.dropzone[h.dropzone.length - 1].onDrop([heic(), jpeg()]); });
    expect(fileCaricati().map((f) => f.type)).toEqual(['image/jpeg']);
    expect(h.toastError.mock.calls.flat().join(' ')).toMatch(MESSAGGIO);
    const ultima = onChange.mock.calls.at(-1)?.[0] as { config: { items: unknown[] } } | undefined;
    expect(ultima?.config.items).toHaveLength(1);
  });
});

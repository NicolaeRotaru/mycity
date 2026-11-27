/**
 * @vitest-environment jsdom
 */
/**
 * R21-002 — LE FOTO DELL'IPHONE (HEIC/HEIF) ENTRAVANO, MA NESSUNO LE CONVERTIVA.
 *
 * Quattro punti di caricamento — le foto delle recensioni, le storie 24h, la galleria e la
 * copertina del sito del negozio — elencavano image/heic e image/heif fra i file accettati. Il file
 * si salvava com'era e su Chrome, Firefox, Edge e Android restava un riquadro rotto; in piu', con
 * HEIC nell'`accept`, l'iPhone smette di convertirle da solo in JPEG.
 *
 * Qui si montano i quattro componenti veri (react-dropzone vero per le due caselle della vetrina) e
 * si guarda il comportamento: il campo non offre piu' HEIC/HEIF, e un .heic che arriva lo stesso —
 * col tipo dichiarato o col tipo vuoto, come lo consegna un PC — non parte verso il magazzino e chi
 * carica legge perche'. I file buoni continuano a partire.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { screen, within, fireEvent } from '@testing-library/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const stato = vi.hoisted(() => ({
  errori: [] as string[],
  caricati: [] as File[],
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
const aspetta = (ms = 10) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

beforeEach(() => {
  stato.errori.length = 0;
  stato.caricati.length = 0;
});
afterEach(() => {
  for (const r of accesi.splice(0)) act(() => r.unmount());
  document.body.innerHTML = '';
});

async function monta(el: ReactElement): Promise<HTMLElement> {
  const radice = document.createElement('div');
  document.body.appendChild(radice);
  const root = createRoot(radice);
  accesi.push(root);
  await act(async () => { root.render(el); });
  return radice;
}

const DALL_IPHONE = () => new File([new Uint8Array([1, 2, 3])], 'IMG_0421.HEIC', { type: 'image/heic' });
const DAL_PC = () => new File([new Uint8Array([1, 2, 3])], 'IMG_0421.heic', { type: '' });
const UN_HEIF = () => new File([new Uint8Array([1, 2, 3])], 'scatto.heif', { type: 'image/heif' });
const UN_JPG = () => new File([new Uint8Array([1, 2, 3])], 'negozio.jpg', { type: 'image/jpeg' });

/** L'attributo `accept` non offre HEIC/HEIF, ma offre ancora i formati che si vedono ovunque. */
function accettaSenzaHeic(input: HTMLInputElement) {
  const accept = input.getAttribute('accept') ?? '';
  expect(accept, 'con HEIC nell accept l iPhone non converte piu in JPEG').not.toMatch(/hei[cf]/i);
  expect(accept).toContain('image/jpeg');
  expect(accept).toContain('image/png');
  expect(accept).toContain('image/webp');
}

async function scegli(input: HTMLInputElement, files: File[]) {
  await act(async () => { fireEvent.change(input, { target: { files } }); });
  await aspetta(20);
}

function campoFile(radice: HTMLElement): HTMLInputElement {
  const input = radice.querySelector('input[type="file"]') as HTMLInputElement | null;
  expect(input, 'controprova: il campo file c e').toBeTruthy();
  return input!;
}

describe('R21-002 — foto delle recensioni', () => {
  it('il campo non offre HEIC/HEIF', async () => {
    const r = await monta(createElement(PhotoReviewUpload, { userId: 'u1', productId: 'p1', onUploaded: () => {} }));
    accettaSenzaHeic(campoFile(r));
  });

  it.each([
    ['dall iPhone, col tipo dichiarato', DALL_IPHONE],
    ['da un PC, col tipo vuoto', DAL_PC],
    ['un HEIF', UN_HEIF],
  ])('un HEIC %s non parte, e chi carica sa perche', async (_t, crea) => {
    const r = await monta(createElement(PhotoReviewUpload, { userId: 'u1', productId: 'p1', onUploaded: () => {} }));
    await scegli(campoFile(r), [crea()]);
    expect(stato.caricati, 'il file HEIC e arrivato al magazzino').toHaveLength(0);
    expect(stato.errori.join(' ')).toMatch(/HEIC/);
    expect(stato.errori.join(' ')).toMatch(/JPG/);
  });

  it('insieme a un HEIC, la foto buona parte lo stesso', async () => {
    const ricevute: string[][] = [];
    const r = await monta(createElement(PhotoReviewUpload, { userId: 'u1', productId: 'p1', onUploaded: (u: string[]) => ricevute.push(u) }));
    await scegli(campoFile(r), [DAL_PC(), UN_JPG()]);
    expect(stato.caricati.map((f) => f.name)).toEqual(['negozio.jpg']);
    expect(ricevute.at(-1)).toEqual(['https://foto/1.jpg']);
    expect(stato.errori.join(' ')).toMatch(/HEIC/);
  });
});

describe('R21-002 — storie 24h', () => {
  async function apriLaStoria() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    await monta(createElement(QueryClientProvider, { client: qc }, createElement(SellerStoriesPage)));
    await aspetta(30);
    await act(async () => { screen.getByRole('button', { name: /Nuova storia/ }).click(); });
    const dialogo = screen.getByRole('dialog');
    return {
      input: dialogo.querySelector('input[type="file"]') as HTMLInputElement,
      pubblica: within(dialogo).getByRole('button', { name: /Pubblica/ }) as HTMLButtonElement,
    };
  }

  it('il campo non offre HEIC/HEIF', async () => {
    const { input } = await apriLaStoria();
    accettaSenzaHeic(input);
  });

  it.each([
    ['dall iPhone, col tipo dichiarato', DALL_IPHONE],
    ['da un PC, col tipo vuoto', DAL_PC],
  ])('un HEIC %s non si puo pubblicare, e il negoziante sa perche', async (_t, crea) => {
    const { input, pubblica } = await apriLaStoria();
    await scegli(input, [crea()]);
    expect(stato.errori.join(' ')).toMatch(/HEIC/);
    expect(pubblica.disabled, 'con un HEIC scelto la storia si poteva pubblicare').toBe(true);
    await act(async () => { pubblica.click(); });
    await aspetta(20);
    expect(stato.caricati).toHaveLength(0);
  });

  it('un JPG si sceglie e si pubblica come prima', async () => {
    const { input, pubblica } = await apriLaStoria();
    await scegli(input, [UN_JPG()]);
    expect(stato.errori).toEqual([]);
    expect(pubblica.disabled).toBe(false);
    await act(async () => { pubblica.click(); });
    await aspetta(30);
    expect(stato.caricati.map((f) => f.name)).toEqual(['negozio.jpg']);
  });
});

const sezioneGalleria = () => ({ id: 'g1', type: 'gallery', config: { items: [] } }) as never;

describe.each([
  ['copertina del sito (SingleImageUpload)', () => createElement(SingleImageUpload, { value: '', onChange: () => {} })],
  ['galleria della vetrina (GalleryFields)', () => createElement(GalleryFields, { section: sezioneGalleria(), onChange: () => {} })],
])('R21-002 — %s', (_nome, crea) => {
  it('la casella non offre HEIC/HEIF', async () => {
    const r = await monta(crea());
    accettaSenzaHeic(campoFile(r));
  });

  it.each([
    ['dall iPhone, col tipo dichiarato', DALL_IPHONE],
    ['da un PC, col tipo vuoto', DAL_PC],
    ['un HEIF', UN_HEIF],
  ])('un HEIC %s resta fuori, con una frase che dice perche', async (_t, file) => {
    const r = await monta(crea());
    await scegli(campoFile(r), [file()]);
    expect(stato.caricati, 'il file HEIC e arrivato al magazzino').toHaveLength(0);
    const detto = stato.errori.join(' ');
    expect(detto).toMatch(/HEIC/);
    expect(detto).toMatch(/JPG/);
  });

  it('un formato sbagliato non promette piu HEIC fra quelli caricabili', async () => {
    const r = await monta(crea());
    await scegli(campoFile(r), [new File(['<svg/>'], 'disegno.svg', { type: 'image/svg+xml' })]);
    const detto = stato.errori.join(' ');
    expect(detto).toContain('disegno.svg');
    expect(detto).toMatch(/JPG, PNG, WEBP, GIF o AVIF/);
    expect(detto).not.toMatch(/HEIC|HEIF/);
  });

  it('un JPG parte come prima', async () => {
    const r = await monta(crea());
    await scegli(campoFile(r), [UN_JPG()]);
    expect(stato.errori).toEqual([]);
    expect(stato.caricati.map((f) => f.name)).toEqual(['negozio.jpg']);
  });
});

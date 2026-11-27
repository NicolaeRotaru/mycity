/**
 * @vitest-environment jsdom
 */
/**
 * R04-002 — ALTRE CINQUE CASELLE NON SALVANO PIU' UN HEIC COSI' COM'E': DIVENTA JPEG, O NON PARTE.
 *
 * Il campo immagine dell'amministrazione (ImageUrlField), il logo e le foto del negozio (VendorForm,
 * StoreMediaManager), le foto del reso e la prova dei contanti del fattorino accettavano HEIC/HEIF e
 * lo salvavano tale e quale: su Chrome e Android un riquadro rotto (la prova dei contanti la guarda
 * l'amministrazione, il reso il negozio). Qui si montano i componenti veri (react-dropzone vero) e si
 * guarda cosa arriva al caricamento:
 *   · su un browser che sa leggere l'HEIC (Safari: `createImageBitmap` e la tela simulati) arriva un
 *     JPEG — tipo image/jpeg, nome .jpg — anche col tipo vuoto, come lo consegna un PC;
 *   · dove il browser non lo sa leggere non parte niente, e chi carica legge perche';
 *   · un JPG arriva intatto;
 *   · il campo file non chiede HEIC al telefono, cosi' l'iPhone consegna gia' un JPEG.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { fireEvent } from '@testing-library/dom';

const stato = vi.hoisted(() => ({
  errori: [] as string[],
  caricati: [] as File[],
  disegni: 0,
}));

vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
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
    return { percorso: `u1/x/${stato.caricati.length}.jpg`, publicUrl: `https://x.supabase.co/storage/v1/object/public/products/u1/${stato.caricati.length}.jpg` };
  },
}));
vi.mock('@/lib/supabase/client', () => {
  // Un ordine consegnato ieri, senza resi aperti: il modulo del reso si apre col campo delle foto.
  const ordine = () => ({
    id: 'ordine-1', total_price: 30, delivered_at: new Date(Date.now() - 86_400_000).toISOString(),
    created_at: new Date(Date.now() - 2 * 86_400_000).toISOString(), delivery_status: 'DELIVERED',
    payment_method: 'card', stripe_payment_intent: 'pi_1', wallet_applied_cents: 0,
  });
  const catena = (tabella: string) => {
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'neq', 'in', 'limit', 'order']) q[m] = () => q;
    q.single = async () => ({ data: tabella === 'orders' ? ordine() : null, error: null });
    q.maybeSingle = q.single;
    q.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok, ko);
    return q;
  };
  return {
    supabase: {
      auth: {
        getUser: async () => ({ data: { user: { id: 'u1' } } }),
        getSession: async () => ({ data: { session: { access_token: 't' } } }),
      },
      from: catena,
      storage: { from: () => ({ remove: async () => ({}) }) },
    },
  };
});
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('next/navigation', () => ({ useParams: () => ({ id: 'ordine-1' }), useRouter: () => ({ push: () => undefined }) }));
vi.mock('next/link', async () => {
  const { createElement: ce } = await import('react');
  return { default: ({ href, children, ...r }: Record<string, unknown>) => ce('a', { href: String(href), ...r }, children as never) };
});
vi.mock('next/image', async () => {
  const { createElement: ce } = await import('react');
  return { default: (p: Record<string, unknown>) => ce('img', { src: String(p.src ?? ''), alt: String(p.alt ?? '') }) };
});
vi.mock('@/components/ConfirmDialog', () => ({ confirmDialog: async () => true }));
vi.mock('@/components/StoreAvatar', () => ({ default: () => null }));
vi.mock('@/components/StoreLocationPickerLazy', () => ({ default: () => null }));
vi.mock('@/components/seller/AccentPicker', () => ({ default: () => null }));
vi.mock('@/components/seller/CoverPicker', () => ({ default: () => null }));
vi.mock('@/components/seller/AnnouncementEditor', () => ({ default: () => null }));
vi.mock('@/components/seller/BadgePicker', () => ({ default: () => null }));
vi.mock('@/components/seller/StoreHoursEditor', () => ({ default: () => null }));
vi.mock('@/components/seller/FeaturedProductsPicker', () => ({ default: () => null }));

import { ImageUrlField } from '@/components/ImageUrlField';
import VendorForm from '@/components/VendorForm';
import StoreMediaManager from '@/components/StoreMediaManager';
import PaginaReso from '@/app/orders/[id]/return/page';
import CashConfirmDialog from '@/components/rider/CashConfirmDialog';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
const accesi: Root[] = [];
const aspetta = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

/** Un browser che sa leggere l'HEIC, come Safari: la foto si decodifica e la tela codifica il JPEG. */
function browserCheLoSaLeggere() {
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 3024, height: 4032, close: () => undefined })));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({
    fillStyle: '',
    fillRect: () => undefined,
    drawImage: () => { stato.disegni++; },
  }) as never);
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
  stato.disegni = 0;
});
afterEach(() => {
  for (const r of accesi.splice(0)) act(() => r.unmount());
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
  vi.restoreAllMocks();
  delete (HTMLImageElement.prototype as unknown as Record<string, unknown>).decode;
});

async function monta(el: ReactElement): Promise<HTMLElement> {
  const radice = document.createElement('div');
  document.body.appendChild(radice);
  const root = createRoot(radice);
  accesi.push(root);
  await act(async () => { root.render(el); });
  await aspetta();
  return radice;
}

const DALL_IPHONE = () => new File([new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112])], 'IMG_0421.HEIC', { type: 'image/heic' });
const DAL_PC = () => new File([new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112])], 'IMG_0421.heic', { type: '' });
const UN_JPG = () => new File([new Uint8Array([0xff, 0xd8, 0xff])], 'negozio.jpg', { type: 'image/jpeg' });

/** Ogni casella: come si monta, e quale campo file guardare. */
type Casella = { nome: string; apri: () => Promise<HTMLInputElement> };

function campo(radice: ParentNode, etichetta?: string): HTMLInputElement {
  const sel = etichetta ? `input[type="file"][aria-label="${etichetta}"]` : 'input[type="file"]';
  const input = radice.querySelector(sel) as HTMLInputElement | null;
  expect(input, `controprova: il campo file c e (${etichetta ?? 'il primo'})`).toBeTruthy();
  return input!;
}

const CASELLE: Casella[] = [
  {
    nome: 'ImageUrlField (amministrazione: home, eventi, negozio del mese)',
    apri: async () => campo(await monta(createElement(ImageUrlField, { value: '', onChange: () => {}, pathPrefix: 'home', label: 'Immagine' })), 'Carica immagine'),
  },
  {
    nome: 'VendorForm (logo del negozio)',
    apri: async () => campo(
      await monta(createElement(VendorForm, { onSubmit: () => {}, mode: 'branding', defaultValues: { storeName: 'Pane Quotidiano' } })),
      'Carica il logo del negozio',
    ),
  },
  {
    nome: 'StoreMediaManager (foto del negozio)',
    apri: async () => campo(await monta(createElement(StoreMediaManager, { value: [], onChange: () => {} })), 'Carica le foto del negozio'),
  },
  {
    nome: 'foto del reso (pagina del reso)',
    apri: async () => campo(await monta(createElement(PaginaReso)), 'Aggiungi una foto alla richiesta di reso'),
  },
  {
    nome: 'prova dei contanti del fattorino (CashConfirmDialog)',
    apri: async () => {
      await monta(createElement(CashConfirmDialog, { orderId: 'ordine-1', expectedCents: 6000, aperto: true, onChiudi: () => {} }));
      return campo(document);
    },
  },
];

async function scegli(input: HTMLInputElement, files: File[]) {
  await act(async () => { fireEvent.change(input, { target: { files } }); });
  await aspetta();
}

describe.each(CASELLE)('R04-002 — $nome', ({ apri }) => {
  it('un HEIC dall iPhone, dove il browser lo sa leggere, arriva come JPEG', async () => {
    browserCheLoSaLeggere();
    await scegli(await apri(), [DALL_IPHONE()]);
    expect(stato.caricati, 'al caricamento doveva arrivare una foto').toHaveLength(1);
    expect(stato.caricati[0].type, 'al magazzino e arrivato un HEIC, che Chrome e Android non mostrano').toBe('image/jpeg');
    expect(stato.caricati[0].name).toBe('IMG_0421.jpg');
    expect(stato.disegni).toBe(1);
  });

  it('un HEIC da un PC, col tipo vuoto, arriva come JPEG', async () => {
    browserCheLoSaLeggere();
    await scegli(await apri(), [DAL_PC()]);
    expect(stato.caricati.map((f) => [f.name, f.type])).toEqual([['IMG_0421.jpg', 'image/jpeg']]);
  });

  it('dove il browser non sa leggere l HEIC non parte niente, e chi carica sa perche', async () => {
    browserCheNonLoSaLeggere();
    await scegli(await apri(), [DAL_PC()]);
    expect(stato.caricati, 'un HEIC che il browser non sa convertire e partito lo stesso').toHaveLength(0);
    expect(stato.errori.join(' ')).toMatch(/HEIC/);
    expect(stato.errori.join(' ')).toMatch(/JPG/);
  });

  it('un JPG arriva intatto', async () => {
    browserCheLoSaLeggere();
    const jpg = UN_JPG();
    await scegli(await apri(), [jpg]);
    expect(stato.caricati.map((f) => [f.name, f.type])).toEqual([['negozio.jpg', 'image/jpeg']]);
    expect(await stato.caricati[0].arrayBuffer()).toEqual(await jpg.arrayBuffer());
    expect(stato.disegni, 'un JPG non va ridisegnato').toBe(0);
  });

  it('il campo file non chiede HEIC al telefono, ma offre ancora i formati che si vedono ovunque', async () => {
    const accept = (await apri()).getAttribute('accept') ?? '';
    expect(accept, 'con HEIC nel campo l iPhone consegna l originale invece di un JPEG').not.toMatch(/hei[cf]/i);
    expect(accept).toContain('image/jpeg');
    expect(accept).toContain('image/png');
  });
});

/**
 * @vitest-environment jsdom
 */
/**
 * R16-013 — LE CASELLE DELLE FOTO ACCETTANO I SETTE TIPI DEL MAGAZZINO, NON TRE.
 *
 * Il campo immagine dell'amministrazione (ImageUrlField), il logo del modulo del negozio
 * (VendorForm) e il logo della domanda d'iscrizione (SellerApplicationForm) si scrivevano a mano
 * JPG, PNG e WEBP, mentre il deposito `products` ne accetta sette (`lib/storage/regole-secchi.ts`,
 * copia della migrazione 070): una foto HEIC scattata con l'iPhone restava fuori, con un avviso che
 * nominava tre formati. Qui si guarda cosa ognuno passa davvero a react-dropzone, cosa dice quando
 * scarta, e che un HEIC col tipo vuoto (Windows) parta col tipo giusto.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, createElement, type ComponentType } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { TIPI_IMMAGINE } from '@/lib/storage/regole-secchi';

type OpzioniDropzone = {
  accept?: Record<string, string[]>;
  onDrop?: (files: File[]) => Promise<void> | void;
  onDropRejected?: (r: Array<{ file: File; errors: Array<{ code: string; message: string }> }>) => void;
};

const stato = vi.hoisted(() => ({
  dropzone: [] as OpzioniDropzone[],
  errori: [] as string[],
  caricati: [] as File[],
}));

vi.mock('react-dropzone', () => ({
  useDropzone: (o: OpzioniDropzone) => {
    stato.dropzone.push(o);
    return { getRootProps: () => ({}), getInputProps: () => ({}), isDragActive: false, open: () => undefined };
  },
}));
vi.mock('sonner', () => ({
  toast: Object.assign(() => undefined, {
    success: () => undefined,
    info: () => undefined,
    error: (m: string) => { stato.errori.push(String(m)); },
  }),
}));
vi.mock('@/lib/storage/carica-immagine', () => ({
  ANNO_IN_SECONDI: 31536000,
  caricaImmagine: async (_s: unknown, r: { file: File }) => { stato.caricati.push(r.file); return { publicUrl: 'https://x.supabase.co/storage/v1/object/public/products/u1/logo.heic' }; },
}));
vi.mock('@/lib/supabase/client', () => ({
  supabase: { auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) } },
}));
vi.mock('next/link', async () => {
  const { createElement: ce } = await import('react');
  return { default: ({ href, children, ...r }: Record<string, unknown>) => ce('a', { href: String(href), ...r }, children as never) };
});
vi.mock('next/image', async () => {
  const { createElement: ce } = await import('react');
  return { default: ({ src, alt }: { src: string; alt: string }) => ce('img', { src, alt }) };
});
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('@/components/StoreAvatar', () => ({ default: () => null }));
vi.mock('@/components/StoreMediaManager', () => ({ default: () => null }));
vi.mock('@/components/StoreLocationPickerLazy', () => ({ default: () => null }));
vi.mock('@/components/seller/AccentPicker', () => ({ default: () => null }));
vi.mock('@/components/seller/CoverPicker', () => ({ default: () => null }));
vi.mock('@/components/seller/AnnouncementEditor', () => ({ default: () => null }));
vi.mock('@/components/seller/BadgePicker', () => ({ default: () => null }));
vi.mock('@/components/seller/StoreHoursEditor', () => ({ default: () => null }));
vi.mock('@/components/seller/FeaturedProductsPicker', () => ({ default: () => null }));

const accesi: Root[] = [];
beforeEach(() => {
  stato.dropzone.length = 0;
  stato.errori.length = 0;
  stato.caricati.length = 0;
});
afterEach(() => {
  for (const r of accesi.splice(0)) act(() => r.unmount());
  document.body.innerHTML = '';
});

async function disegna(C: ComponentType<Record<string, unknown>>, props: Record<string, unknown>): Promise<OpzioniDropzone> {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const radice = document.createElement('div');
  document.body.appendChild(radice);
  const root = createRoot(radice);
  accesi.push(root);
  await act(async () => { root.render(createElement(C, props)); });
  const o = stato.dropzone.at(-1);
  expect(o, 'controprova: la casella delle foto c\'è').toBeTruthy();
  return o!;
}

const CASELLE: Array<{ nome: string; carica: () => Promise<[ComponentType<Record<string, unknown>>, Record<string, unknown>]> }> = [
  {
    nome: 'ImageUrlField (amministrazione: home, eventi, negozio del mese)',
    carica: async () => [(await import('@/components/ImageUrlField')).ImageUrlField as never, { value: '', onChange: () => undefined, pathPrefix: 'home', label: 'Immagine' }],
  },
  {
    nome: 'VendorForm (logo del negozio)',
    carica: async () => [(await import('@/components/VendorForm')).default as never, { onSubmit: () => undefined, mode: 'branding', defaultValues: { storeName: 'Pane Quotidiano' } }],
  },
  // 25/11/2026 — La domanda d'iscrizione (SellerApplicationForm) non carica più il logo: il modulo
  // corto chiede solo i dati per riconoscere l'attività, e il logo si mette dopo, dalla vetrina.
];

describe('R16-013 — le caselle delle foto accettano quello che il magazzino accetta', () => {
  for (const { nome, carica } of CASELLE) {
    it(`${nome}: i sette tipi, con le estensioni (HEIC compreso)`, async () => {
      const [C, props] = await carica();
      const o = await disegna(C, props);
      expect(Object.keys(o.accept ?? {}).sort(), 'la casella accetta meno tipi del magazzino').toEqual([...TIPI_IMMAGINE].sort());
      expect(o.accept?.['image/heic'], 'senza .heic un HEIC col tipo vuoto resta fuori').toContain('.heic');
    });

    it(`${nome}: quando scarta un formato dice tutti i formati ammessi`, async () => {
      const [C, props] = await carica();
      const o = await disegna(C, props);
      act(() => {
        o.onDropRejected?.([{ file: new File(['x'], 'disegno.svg', { type: 'image/svg+xml' }), errors: [{ code: 'file-invalid-type', message: '' }] }]);
      });
      expect(stato.errori.at(-1) ?? '', 'l\'avviso nomina solo tre formati').toMatch(/HEIC/);
      expect(stato.errori.at(-1) ?? '').toMatch(/AVIF/);
    });

    // 27/11/2026 (R04-002) — Prima pretendeva che l'HEIC partisse così com'era («image/heic»): salvato
    // così, su Chrome e Android resta un riquadro rotto. Adesso diventa JPEG dove il browser lo sa
    // leggere (riparazione-r04-foto-heic-altre-caselle.test.tsx); qui, senza decodifica, non parte.
    it(`${nome}: un HEIC col tipo vuoto non arriva al deposito così com'è`, async () => {
      const [C, props] = await carica();
      const o = await disegna(C, props);
      await act(async () => { await o.onDrop?.([new File(['x'], 'IMG_0001.HEIC', { type: '' })]); });
      expect(stato.caricati, 'un HEIC salvato così com\'è non si vede su Chrome e Android').toHaveLength(0);
      expect(stato.errori.at(-1) ?? '', 'chi carica non sa perché la foto non è partita').toMatch(/HEIC/);
    });
  }
});

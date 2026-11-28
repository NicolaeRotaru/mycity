/**
 * @vitest-environment jsdom
 */
/**
 * R10-005 — LA CASELLA DEI MEDIA DEL NEGOZIO ACCETTA I SETTE TIPI DI FOTO, NON TRE.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, createElement } from 'react';
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
  caricaImmagine: async (_s: unknown, r: { file: File }) => { stato.caricati.push(r.file); return { publicUrl: 'https://x.supabase.co/storage/v1/object/public/products/u1/m.heic' }; },
}));
vi.mock('@/lib/supabase/client', () => ({
  supabase: { auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) } },
}));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));

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

async function disegna(): Promise<OpzioniDropzone> {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const Comp = (await import('@/components/StoreMediaManager')).default;
  const radice = document.createElement('div');
  document.body.appendChild(radice);
  const root = createRoot(radice);
  accesi.push(root);
  await act(async () => { root.render(createElement(Comp, { value: [], onChange: () => undefined })); });
  const o = stato.dropzone.at(-1);
  expect(o, 'controprova: la casella c\'è').toBeTruthy();
  return o!;
}

describe('R10-005 — la casella dei media del negozio', () => {
  it('accetta i sette tipi, .heic compreso', async () => {
    const o = await disegna();
    expect(Object.keys(o.accept ?? {}).sort()).toEqual([...TIPI_IMMAGINE].sort());
    expect(o.accept?.['image/heic']).toContain('.heic');
  });
  it('quando scarta un formato nomina HEIC e AVIF', async () => {
    const o = await disegna();
    act(() => {
      o.onDropRejected?.([{ file: new File(['x'], 'a.svg', { type: 'image/svg+xml' }), errors: [{ code: 'file-invalid-type', message: '' }] }]);
    });
    expect(stato.errori.at(-1) ?? '').toMatch(/HEIC/);
    expect(stato.errori.at(-1) ?? '').toMatch(/AVIF/);
  });
  // 27/11/2026 (R04-002) — Prima pretendeva che l'HEIC partisse così com'era («image/heic»): salvato
  // così, su Chrome e Android resta un riquadro rotto. Adesso diventa JPEG dove il browser lo sa
  // leggere (riparazione-r04-foto-heic-altre-caselle.test.tsx); qui, senza decodifica, non parte.
  it('un HEIC col tipo vuoto non arriva al deposito così com\'è', async () => {
    const o = await disegna();
    await act(async () => { await o.onDrop?.([new File(['x'], 'IMG_0001.HEIC', { type: '' })]); });
    expect(stato.caricati).toHaveLength(0);
    expect(stato.errori.at(-1) ?? '').toMatch(/HEIC/);
  });
});

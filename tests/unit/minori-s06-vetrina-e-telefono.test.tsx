/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';

/**
 * S06 — Copertina della vetrina e telefono del negozio.
 * 318: «caricato» solo se è entrato qualcosa; l'invio aspetta la foto che sale.
 * 577: «0523 456789» e «+39 333 123 4567» sono numeri buoni.
 */
const stato = vi.hoisted(() => ({
  opzioni: null as null | { onDrop: (f: File[]) => Promise<void> },
  carica: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock('react-dropzone', () => ({
  useDropzone: (o: typeof stato.opzioni) => { stato.opzioni = o; return { getRootProps: () => ({}), getInputProps: () => ({}), isDragActive: false }; },
}));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('sonner', () => ({ toast: stato.toast }));
vi.mock('@/lib/supabase/client', () => ({ supabase: { auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) } } }));
vi.mock('@/lib/storage/carica-immagine', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  caricaImmagine: (...a: unknown[]) => stato.carica(...a),
}));
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const { default: StoreMediaManager } = await import('@/components/StoreMediaManager');
const { normalizzaTelefonoNegozio, telefonoNegozioValido } = await import('@/components/VendorForm');

async function monta() {
  const onChange = vi.fn();
  const onUploadingChange = vi.fn();
  const div = document.createElement('div');
  const root = createRoot(div);
  await act(async () => { root.render(createElement(StoreMediaManager, { value: [], onChange, onUploadingChange })); });
  return { onChange, onUploadingChange, root, div };
}
const foto = () => new File(['x'], 'a.jpg', { type: 'image/jpeg' });

beforeEach(() => { stato.toast.success.mockClear(); stato.toast.error.mockClear(); stato.carica.mockReset(); });

describe('318 — copertina della vetrina', () => {
  it('se il caricamento cade non dice «caricato» e non cambia niente', async () => {
    stato.carica.mockRejectedValue(new Error('rete'));
    const m = await monta();
    await act(async () => { await stato.opzioni!.onDrop([foto()]); });
    expect(stato.toast.success).not.toHaveBeenCalled();
    expect(m.onChange).not.toHaveBeenCalled();
    m.root.unmount();
  });
  it('dice quante sono entrate e quante no', async () => {
    stato.carica.mockResolvedValueOnce({ publicUrl: 'https://x/1.jpg' }).mockRejectedValueOnce(new Error('rete'));
    const m = await monta();
    await act(async () => { await stato.opzioni!.onDrop([foto(), foto()]); });
    expect(stato.toast.success).toHaveBeenCalledWith('1 foto caricata, 1 no');
    m.root.unmount();
  });
  it('il modulo sa quando sta salendo e non invia', async () => {
    let rilascia: (v: unknown) => void = () => {};
    stato.carica.mockReturnValue(new Promise((r) => { rilascia = r; }));
    const m = await monta();
    let fatto: Promise<void> = Promise.resolve();
    await act(async () => { fatto = stato.opzioni!.onDrop([foto()]); });
    expect(m.onUploadingChange).toHaveBeenLastCalledWith(true);
    await act(async () => { rilascia({ publicUrl: 'https://x/1.jpg' }); await fatto; });
    expect(m.onUploadingChange).toHaveBeenLastCalledWith(false);
    for (const p of ['components/SellerApplicationForm.tsx', 'components/VendorForm.tsx']) {
      expect(readFileSync(p, 'utf8'), p).toContain('disabled={isLoading || uploadingLogo || uploadingMedia}');
    }
    m.root.unmount();
  });
  it('il testo non promette il trascinamento per riordinare', () => {
    expect(readFileSync('components/StoreMediaManager.tsx', 'utf8')).not.toContain('Trascina per riordinare');
  });
});

describe('577 — il telefono del negozio', () => {
  it('scritto come sul biglietto da visita passa e si salva pulito', () => {
    expect(telefonoNegozioValido('0523 456789')).toBe(true);
    expect(telefonoNegozioValido('+39 333 123 4567')).toBe(true);
    expect(telefonoNegozioValido('0523-45.67.89')).toBe(true);
    expect(normalizzaTelefonoNegozio('+39 333 123 4567')).toBe('3331234567');
  });
  it('un numero senza senso no', () => {
    expect(telefonoNegozioValido('123')).toBe(false);
    expect(telefonoNegozioValido('abc def')).toBe(false);
  });
});

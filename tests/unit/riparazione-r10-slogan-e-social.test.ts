/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { fireEvent } from '@testing-library/dom';

vi.mock('next/link', async () => {
  const { createElement: ce } = await import('react');
  return { default: ({ href, children, ...r }: Record<string, unknown>) => ce('a', { href: String(href), ...r }, children as never) };
});
vi.mock('@/components/StoreAvatar', () => ({ default: () => null }));
vi.mock('@/components/StoreMediaManager', () => ({ default: () => null }));
vi.mock('@/components/StoreLocationPickerLazy', () => ({ default: () => null }));
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('sonner', () => ({
  toast: Object.assign(() => undefined, { success: () => undefined, error: () => undefined, info: () => undefined }),
}));
vi.mock('react-dropzone', () => ({
  useDropzone: () => ({ getRootProps: () => ({}), getInputProps: () => ({}), isDragActive: false, open: () => undefined }),
}));
vi.mock('@/lib/storage/carica-immagine', () => ({ ANNO_IN_SECONDI: 31536000, caricaImmagine: async () => '' }));
vi.mock('@/components/seller/AccentPicker', () => ({ default: () => null }));
vi.mock('@/components/seller/CoverPicker', () => ({ default: () => null }));
vi.mock('@/components/seller/AnnouncementEditor', () => ({ default: () => null }));
vi.mock('@/components/seller/BadgePicker', () => ({ default: () => null }));
vi.mock('@/components/seller/StoreHoursEditor', () => ({ default: () => null }));
vi.mock('@/components/seller/FeaturedProductsPicker', () => ({ default: () => null }));

import VendorForm from '@/components/VendorForm';

const accesi: Root[] = [];
afterEach(() => {
  for (const r of accesi.splice(0)) act(() => r.unmount());
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});
const aspetta = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });
const monta = async (props: Record<string, unknown>) => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const radice = document.createElement('div');
  document.body.appendChild(radice);
  const root = createRoot(radice);
  accesi.push(root);
  await act(async () => { root.render(createElement(VendorForm, props as never)); });
  await aspetta();
  return radice;
};
const campoSlogan = (radice: HTMLElement) => {
  const label = Array.from(radice.querySelectorAll('label')).find((l) => l.textContent?.startsWith('Slogan'))!;
  return radice.querySelector(`[id="${label.htmlFor}"]`) as HTMLInputElement;
};

/**
 * R10-008, R10-009 — Lo slogan del negozio non taglia più in silenzio a 80 caratteri: il testo resta
 * intero e sotto il campo si legge quanto è lungo.
 */
describe('R10-008 R10-009 — lo slogan dice il suo limite invece di tagliare', () => {
  it('nessun maxLength: oltre 80 caratteri compare l\'errore sotto il campo, legato al campo', async () => {
    const radice = await monta({ onSubmit: vi.fn(), mode: 'branding', defaultValues: { storeName: 'Pane' } });
    const campo = campoSlogan(radice);
    expect(campo.hasAttribute('maxlength')).toBe(false);
    await act(async () => { fireEvent.change(campo, { target: { value: 'x'.repeat(85) } }); });
    expect(campo.value).toHaveLength(85);
    const errore = document.getElementById(campo.getAttribute('aria-describedby') ?? '-');
    expect(errore?.textContent).toContain('85 caratteri su 80');
    expect(campo.getAttribute('aria-invalid')).toBe('true');
  });

  it('entro il limite niente errore', async () => {
    const radice = await monta({ onSubmit: vi.fn(), mode: 'branding', defaultValues: { storeName: 'Pane' } });
    const campo = campoSlogan(radice);
    await act(async () => { fireEvent.change(campo, { target: { value: 'Pane fresco dal 1962' } }); });
    expect(campo.hasAttribute('aria-invalid')).toBe(false);
    expect(radice.textContent).not.toContain('Troppo lungo');
  });
});

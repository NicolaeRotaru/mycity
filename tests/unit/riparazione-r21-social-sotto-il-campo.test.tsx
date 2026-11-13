/**
 * @vitest-environment jsdom
 */
/**
 * R21-004 — Un campo social sbagliato nel modulo della vetrina non si salva, ma
 * dice DOVE: l'errore sta sotto il campo giusto e la sezione «Social e contatti»
 * (che parte chiusa) si apre da sola.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

vi.mock('next/link', async () => {
  const { createElement: ce } = await import('react');
  return { default: ({ href, children, ...r }: Record<string, unknown>) => ce('a', { href: String(href), ...r }, children as never) };
});
vi.mock('@/components/StoreAvatar', () => ({ default: () => null }));
vi.mock('@/components/StoreMediaManager', () => ({ default: () => null }));
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
});
const aspetta = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });

async function invia(socials: Record<string, string>) {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const onSubmit = vi.fn();
  const radice = document.createElement('div');
  document.body.appendChild(radice);
  const root = createRoot(radice);
  accesi.push(root);
  await act(async () => {
    root.render(createElement(VendorForm, {
      mode: 'branding', onSubmit,
      defaultValues: { storeName: 'Pane Quotidiano', storeCustomization: { socials } },
    } as never));
  });
  await aspetta();
  await act(async () => { radice.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  await aspetta();
  return { radice, onSubmit };
}

describe('R21-004 · il campo social sbagliato lo dice sotto di sé', () => {
  it('Facebook scritto col nome della pagina: non salva, errore sotto Facebook, sezione aperta', async () => {
    const { radice, onSubmit } = await invia({ facebook: 'Pane Quotidiano Piacenza' });
    expect(onSubmit).not.toHaveBeenCalled();
    const campo = radice.querySelector<HTMLInputElement>('#social-facebook')!;
    const errore = campo.parentElement!.parentElement!.querySelector('[role="alert"]');
    expect(errore?.textContent).toContain('panequotidiano');
    // gli altri campi non si accusano
    expect(radice.querySelector('#social-instagram')!.parentElement!.parentElement!.querySelector('[role="alert"]')).toBeNull();
    expect(campo.closest('details')!.open).toBe(true);
  });

  it('con i social corretti si salva e non resta nessun errore sotto i campi', async () => {
    const { radice, onSubmit } = await invia({ instagram: 'https://www.instagram.com/panequotidiano/', website: 'www.panequotidiano.it' });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(radice.querySelectorAll('#social-instagram ~ [role="alert"], [id$="-errore"]').length).toBe(0);
    expect(onSubmit.mock.calls[0][0].storeCustomization.socials).toMatchObject({ instagram: 'panequotidiano', website: 'https://www.panequotidiano.it' });
  });
});

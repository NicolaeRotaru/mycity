/**
 * @vitest-environment jsdom
 */
/**
 * R02-007 — Il negoziante incolla il link del profilo o scrive il sito senza https: il link si
 * corregge da solo; se resta sbagliato, l'errore compare sotto il campo giusto, la sezione si
 * apre e gli altri dati non si perdono.
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
});
const aspetta = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });

async function monta(socials: Record<string, string>) {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const onSubmit = vi.fn();
  const radice = document.createElement('div');
  document.body.appendChild(radice);
  const root = createRoot(radice);
  accesi.push(root);
  await act(async () => {
    root.render(createElement(VendorForm, {
      onSubmit,
      mode: 'branding',
      defaultValues: { storeName: 'Pane Quotidiano', storeCustomization: { socials } },
    }));
  });
  await aspetta();
  return { radice, onSubmit };
}
async function invia(radice: HTMLElement) {
  await act(async () => { radice.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  await aspetta();
}
const sezione = (r: HTMLElement) => campo(r, 'facebook').closest('details')!;
const campo = (r: HTMLElement, k: string) => r.querySelector<HTMLInputElement>(`#social-${k}`)!;

describe('R02-007 · link social incollati', () => {
  it('il link di instagram, la @ e il sito senza https si correggono e il salvataggio parte', async () => {
    const { radice, onSubmit } = await monta({
      instagram: 'https://www.instagram.com/panequotidiano/',
      tiktok: '@panequotidiano',
      website: 'www.panequotidiano.it',
    });
    await invia(radice);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0].storeCustomization.socials).toMatchObject({
      instagram: 'panequotidiano',
      tiktok: 'panequotidiano',
      website: 'https://www.panequotidiano.it',
    });
  });

  // 27/11/2026 (R04-010) — Il nome con spazi lo SCRIVE il negoziante, sopra un Facebook già salvato e
  // sbagliato: un valore già salvato e non toccato non blocca più il resto (riparazione-r04-social-salvato-non-blocca).
  it('un nome con spazi in Facebook: errore sotto Facebook, sezione aperta, nessun salvataggio', async () => {
    const { radice, onSubmit } = await monta({ facebook: 'Pane Quotidiano', website: 'www.panequotidiano.it' });
    expect(sezione(radice).open).toBe(false);
    await act(async () => { fireEvent.change(campo(radice, 'facebook'), { target: { value: 'Pane Quotidiano Piacenza' } }); });
    await invia(radice);
    expect(onSubmit).not.toHaveBeenCalled();
    const errore = radice.querySelector('#social-facebook-errore');
    expect(errore?.textContent).toBe('Scrivi solo il nome del profilo, per esempio iltuonegozio');
    expect(campo(radice, 'facebook').getAttribute('aria-invalid')).toBe('true');
    expect(radice.querySelector('#social-instagram-errore')).toBeNull();
    expect(sezione(radice).open).toBe(true);
    expect(radice.textContent).toContain('Facebook: ');
  });

  it('due campi sbagliati: due errori; correggerne uno toglie solo il suo e la sezione resta aperta', async () => {
    const { radice } = await monta({ facebook: 'Pane Quotidiano', instagram: 'pane quotidiano' });
    await invia(radice);
    expect(radice.querySelector('#social-facebook-errore')).not.toBeNull();
    expect(radice.querySelector('#social-instagram-errore')).not.toBeNull();
    await act(async () => { fireEvent.change(campo(radice, 'facebook'), { target: { value: 'panequotidiano' } }); });
    expect(radice.querySelector('#social-facebook-errore')).toBeNull();
    expect(radice.querySelector('#social-instagram-errore')).not.toBeNull();
    expect(sezione(radice).open).toBe(true);
  });
});

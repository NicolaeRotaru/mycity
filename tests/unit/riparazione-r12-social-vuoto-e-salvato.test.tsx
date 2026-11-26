/**
 * @vitest-environment jsdom
 */
/**
 * R12-005 — Con due social sbagliati, uno vuoto e uno già salvato, il messaggio diceva «sono rimasti
 * com'erano» anche per quello vuoto, che invece non si è salvato.
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
  const props = (salvataggioRiuscito: number) => ({
    onSubmit,
    mode: 'branding',
    salvataggioRiuscito,
    defaultValues: { storeName: 'Pane Quotidiano', storeDescription: 'Forno di quartiere', storeCustomization: { socials } },
  });
  await act(async () => { root.render(createElement(VendorForm, props(0) as never)); });
  await aspetta();
  // Il genitore passa l'ora dell'invio riuscito (update.isSuccess ? submittedAt : 0).
  const riuscito = async (quando: number) => {
    await act(async () => { root.render(createElement(VendorForm, props(quando) as never)); });
    await aspetta();
  };
  return { radice, onSubmit, riuscito };
}
const campo = (r: HTMLElement, k: string) => r.querySelector<HTMLInputElement>(`#social-${k}`)!;
async function scrivi(r: HTMLElement, k: string, v: string) {
  await act(async () => { fireEvent.change(campo(r, k), { target: { value: v } }); });
}
async function invia(radice: HTMLElement) {
  await act(async () => { fireEvent.submit(radice.querySelector('form')!); });
  await aspetta();
}

describe('R12-005 · due social sbagliati, uno vuoto e uno già salvato', () => {
  it('il vuoto «non si è salvato», il già salvato «è rimasto com era»', async () => {
    const { radice, riuscito } = await monta({ instagram: 'vecchio' });
    await scrivi(radice, 'instagram', 'https://www.instagram.com/p/Cabc123/');
    await scrivi(radice, 'facebook', 'Pane Quotidiano Piacenza');
    await invia(radice);
    await riuscito(1764000000000);
    expect(radice.textContent).toContain("Il resto è salvato; Facebook non si è salvato, Instagram è rimasto com'era.");
    expect(radice.textContent).not.toContain("sono rimasti com'erano");
  });
});

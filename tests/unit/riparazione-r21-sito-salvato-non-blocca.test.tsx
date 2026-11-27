/**
 * @vitest-environment jsdom
 */
/**
 * R21-012 — Un negozio che ha già salvato website='ftp://sito.it' e cambia solo il nome non riusciva più a
 * salvare: il valore salvato, rimesso nel modulo, veniva rifiutato di nuovo e il salvataggio si fermava.
 * Un valore già salvato e non toccato non blocca il resto (resta com'era, con l'avviso); uno NUOVO sbagliato sì.
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
      onSubmit, mode: 'branding', salvataggioRiuscito: 0,
      defaultValues: { storeName: 'Pane Quotidiano', storeDescription: 'Forno di quartiere', storeCustomization: { socials } },
    } as never));
  });
  await aspetta();
  return { radice, onSubmit };
}
async function scrivi(el: HTMLInputElement, v: string) {
  await act(async () => { fireEvent.change(el, { target: { value: v } }); });
}
async function invia(radice: HTMLElement) {
  await act(async () => { fireEvent.submit(radice.querySelector('form')!); });
  await aspetta();
}
const nome = (r: HTMLElement) => r.querySelector<HTMLInputElement>('input[name="storeName"]')!;

describe('R21-012 · un sito già salvato e non toccato non blocca il salvataggio del resto', () => {
  it('sito salvato con ftp://, cambia solo il nome: il salvataggio parte e il sito resta com’era', async () => {
    const { radice, onSubmit } = await monta({ website: 'ftp://sito.it' });
    await scrivi(nome(radice), 'Pane Quotidiano Piacenza');
    await invia(radice);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0].storeName).toBe('Pane Quotidiano Piacenza');
    expect(onSubmit.mock.calls[0][0].storeCustomization.socials.website).toBe('ftp://sito.it');
  });

  it('un sito NUOVO sbagliato continua a essere rifiutato quando si cambia il campo', async () => {
    const { radice, onSubmit } = await monta({ website: 'https://sito.it' });
    await scrivi(radice.querySelector<HTMLInputElement>('#social-website')!, 'ftp://altro.it');
    await invia(radice);
    expect(onSubmit.mock.calls[0]?.[0].storeCustomization.socials.website).toBe('https://sito.it');
  });

  it('un sito salvato sbagliato e poi cambiato in un altro sbagliato resta rifiutato', async () => {
    const { radice, onSubmit } = await monta({ website: 'ftp://sito.it' });
    await scrivi(radice.querySelector<HTMLInputElement>('#social-website')!, 'ftp://nuovo.it');
    await invia(radice);
    expect(onSubmit, 'un valore nuovo sbagliato non passa').not.toHaveBeenCalled();
  });
});

/**
 * @vitest-environment jsdom
 */
/**
 * R04-009 — UN SITO GIÀ SALVATO E SCRITTO MALE NON BLOCCA IL SALVATAGGIO DEL NEGOZIO, NEMMENO LA SECONDA VOLTA.
 *
 * Un sito salvato quando le regole erano più larghe («www.panequotidiano.it/chi siamo», con lo
 * spazio e senza https) si rimette nel modulo così com'era. Al primo «Salva» si correggeva da solo in
 * «https://…» nel campo e il resto si salvava; al secondo «Salva» il campo non era più uguale al
 * valore salvato, il modulo lo prendeva per un sito NUOVO e si fermava: nome, logo e colore non si
 * salvavano più finché il negoziante non correggeva o svuotava un campo che non aveva toccato.
 * Il confronto col valore salvato si fa sulla forma corretta di tutti e due.
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

describe('R04-009 · un sito già salvato e scritto male non blocca il resto', () => {
  it('sito scritto male, cambio il nome e salvo due volte: tutte e due le volte parte, e il sito resta com era', async () => {
    const { radice, onSubmit } = await monta({ website: 'www.panequotidiano.it/chi siamo' });
    await scrivi(nome(radice), 'Pane Quotidiano Piacenza');
    await invia(radice);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0].storeCustomization.socials.website).toBe('www.panequotidiano.it/chi siamo');
    await scrivi(nome(radice), 'Pane Quotidiano di Piacenza');
    await invia(radice);
    expect(onSubmit, 'al secondo salvataggio il sito già salvato bloccava tutto il negozio').toHaveBeenCalledTimes(2);
    expect(onSubmit.mock.calls[1][0].storeName).toBe('Pane Quotidiano di Piacenza');
    expect(onSubmit.mock.calls[1][0].storeCustomization.socials.website).toBe('www.panequotidiano.it/chi siamo');
    expect(radice.querySelector('#social-website-errore')?.textContent, 'l avviso resta sotto il campo').toBeTruthy();
  });

  it('sito con ftp:// già salvato: anche il secondo salvataggio parte', async () => {
    const { radice, onSubmit } = await monta({ website: 'ftp://sito.it' });
    await invia(radice);
    await scrivi(nome(radice), 'Pane Quotidiano Piacenza');
    await invia(radice);
    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(onSubmit.mock.calls[1][0].storeCustomization.socials.website).toBe('ftp://sito.it');
  });

  it('un sito NUOVO scritto male sopra quello già salvato e sbagliato si ferma ancora', async () => {
    const { radice, onSubmit } = await monta({ website: 'www.panequotidiano.it/chi siamo' });
    await scrivi(radice.querySelector<HTMLInputElement>('#social-website')!, 'www.altro sito.it');
    await invia(radice);
    expect(onSubmit, 'un valore nuovo sbagliato non passa').not.toHaveBeenCalled();
  });
});

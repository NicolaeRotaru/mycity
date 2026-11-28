/**
 * @vitest-environment jsdom
 */
/**
 * R04-010 — UN SOCIAL GIÀ SALVATO CHE LE REGOLE NUOVE RIFIUTANO NON BLOCCA IL SALVATAGGIO DEL NEGOZIO.
 *
 * Come il sito: un Instagram, Facebook o TikTok salvato quando le regole erano più larghe («Pane
 * Quotidiano Piacenza», con gli spazi) si rimette nel modulo così com'era. Il negoziante cambia solo il
 * nome e preme «Salva»: il valore salvato veniva rifiutato di nuovo e il modulo si fermava, e nome,
 * logo e colore non si salvavano finché non correggeva un campo che non aveva toccato. Adesso il
 * valore già salvato e non toccato resta com'era, con l'avviso sotto il suo campo, e il resto si salva.
 * Un valore NUOVO sbagliato scritto sopra uno già sbagliato si ferma ancora.
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

const errore = (r: HTMLElement, k: string) => r.querySelector(`#social-${k}-errore`)?.textContent ?? '';

describe('R04-010 · un social già salvato e rifiutato dalle regole nuove non blocca il resto', () => {
  it.each([
    ['facebook', 'Pane Quotidiano Piacenza'],
    ['instagram', 'pane quotidiano'],
    ['tiktok', 'pane quotidiano'],
  ])('%s salvato come «%s», cambio solo il nome: il salvataggio parte e il social resta com era', async (k, salvato) => {
    const { radice, onSubmit } = await monta({ [k]: salvato });
    await scrivi(nome(radice), 'Pane Quotidiano di Piacenza');
    await invia(radice);
    expect(onSubmit, `un ${k} già salvato bloccava tutto il negozio`).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0].storeName).toBe('Pane Quotidiano di Piacenza');
    expect(onSubmit.mock.calls[0][0].storeCustomization.socials[k]).toBe(salvato);
    expect(errore(radice, k), 'l avviso resta sotto il suo campo').not.toBe('');
  });

  it('anche il secondo salvataggio parte', async () => {
    const { radice, onSubmit } = await monta({ facebook: 'Pane Quotidiano Piacenza', website: 'https://www.panequotidiano.it' });
    await invia(radice);
    await scrivi(nome(radice), 'Pane Quotidiano di Piacenza');
    await invia(radice);
    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(onSubmit.mock.calls[1][0].storeCustomization.socials).toMatchObject({
      facebook: 'Pane Quotidiano Piacenza',
      website: 'https://www.panequotidiano.it',
    });
  });

  it('un Facebook NUOVO sbagliato scritto sopra quello già salvato e sbagliato si ferma ancora', async () => {
    const { radice, onSubmit } = await monta({ facebook: 'Pane Quotidiano' });
    await scrivi(radice.querySelector<HTMLInputElement>('#social-facebook')!, 'Pane Quotidiano Piacenza');
    await invia(radice);
    expect(onSubmit, 'un valore nuovo sbagliato non passa').not.toHaveBeenCalled();
    expect(errore(radice, 'facebook')).not.toBe('');
  });
});

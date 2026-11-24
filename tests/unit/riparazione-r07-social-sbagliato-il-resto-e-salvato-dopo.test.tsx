/**
 * @vitest-environment jsdom
 */
/**
 * R07-007 — Un social sbagliato non ferma più il resto della vetrina: quel social resta com'era, il
 * resto parte. Ma il messaggio diceva «Il resto è salvato» appena premuto «Salva», prima che il
 * salvataggio partisse: se poi falliva, il negoziante leggeva quella frase accanto all'errore.
 * Ora la frase compare solo a salvataggio riuscito (salvataggioRiuscito), e dice il vero anche con
 * due campi o con un campo che prima era vuoto.
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

describe('R07-007 · «Il resto è salvato» solo quando il salvataggio è riuscito', () => {
  it('appena premuto «Salva» il resto parte e l errore dice il campo, ma non dice ancora «Il resto è salvato»', async () => {
    const { radice, onSubmit } = await monta({ instagram: 'vecchio' });
    await scrivi(radice, 'instagram', 'https://www.instagram.com/p/Cabc123/');
    await invia(radice);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(radice.textContent).toContain('Instagram: ');
    expect(radice.textContent, 'la frase arriva prima che il salvataggio sia riuscito').not.toContain('Il resto è salvato');
  });

  it('a salvataggio riuscito il messaggio dice «Il resto è salvato» e che Instagram è rimasto com era', async () => {
    const { radice, riuscito } = await monta({ instagram: 'vecchio' });
    await scrivi(radice, 'instagram', 'https://www.instagram.com/p/Cabc123/');
    await invia(radice);
    await riuscito(1764000000000);
    expect(radice.textContent).toContain("Il resto è salvato; Instagram è rimasto com'era.");
  });

  it('se il salvataggio non riesce (salvataggioRiuscito resta 0) la frase non compare mai', async () => {
    const { radice, riuscito } = await monta({ instagram: 'vecchio' });
    await scrivi(radice, 'instagram', 'https://www.instagram.com/p/Cabc123/');
    await invia(radice);
    await riuscito(0);
    expect(radice.textContent).not.toContain('Il resto è salvato');
  });

  it('due campi sbagliati: il messaggio parla al plurale', async () => {
    const { radice, riuscito } = await monta({ instagram: 'vecchio', facebook: 'pane.quotidiano' });
    await scrivi(radice, 'instagram', 'https://www.instagram.com/p/Cabc123/');
    await scrivi(radice, 'facebook', 'Pane Quotidiano Piacenza');
    await invia(radice);
    await riuscito(1764000000000);
    expect(radice.textContent).toContain("Il resto è salvato; Instagram, Facebook sono rimasti com'erano.");
  });

  it('un campo che prima era vuoto non «resta com era»: non si è salvato', async () => {
    const { radice, riuscito } = await monta({});
    await scrivi(radice, 'facebook', 'Pane Quotidiano Piacenza');
    await invia(radice);
    await riuscito(1764000000000);
    expect(radice.textContent).toContain('Il resto è salvato; Facebook non si è salvato.');
  });
});

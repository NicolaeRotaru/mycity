/**
 * @vitest-environment jsdom
 */
/**
 * R02-006 — Dettagli negozio e profilo usano VendorForm: con un campo cambiato, uscire senza
 * salvare avvisa (beforeunload e «Tutte le impostazioni»); senza modifiche, o dopo un salvataggio
 * riuscito, no.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { fireEvent } from '@testing-library/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

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
import StoreDetailsEditor from '@/components/seller/site/StoreDetailsEditor';

const accesi: Root[] = [];
afterEach(() => {
  for (const r of accesi.splice(0)) act(() => r.unmount());
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});
const aspetta = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });

async function monta(salvataggioRiuscito = 0) {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const radice = document.createElement('div');
  document.body.appendChild(radice);
  const root = createRoot(radice);
  accesi.push(root);
  const disegna = (n: number) =>
    root.render(createElement(VendorForm, {
      onSubmit: vi.fn(), mode: 'branding', salvataggioRiuscito: n,
      defaultValues: { storeName: 'Pane Quotidiano', storeDescription: 'Forno' },
    }));
  await act(async () => { disegna(salvataggioRiuscito); });
  await aspetta();
  return { radice, riDisegna: async (n: number) => { await act(async () => { disegna(n); }); await aspetta(); } };
}
const tentaUscita = () => {
  const e = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(e);
  return e.defaultPrevented;
};
const scrivi = async (radice: HTMLElement, testo: string) => {
  const campo = radice.querySelector('textarea') as HTMLTextAreaElement;
  await act(async () => { fireEvent.change(campo, { target: { value: testo } }); });
};

describe('R02-006 · modifiche non salvate dentro VendorForm', () => {
  it('senza modifiche uscire non è fermato', async () => {
    await monta();
    expect(tentaUscita()).toBe(false);
  });

  it('con un campo cambiato beforeunload viene fermato; tornando com\'era no', async () => {
    const { radice } = await monta();
    await scrivi(radice, 'Forno e pasticceria');
    expect(tentaUscita()).toBe(true);
    await scrivi(radice, 'Forno');
    expect(tentaUscita()).toBe(false);
  });

  it('dopo il salvataggio riuscito non è più fermato; se cade, sì', async () => {
    const { radice, riDisegna } = await monta();
    await scrivi(radice, 'Forno e pasticceria');
    expect(tentaUscita()).toBe(true);
    await act(async () => { radice.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    await aspetta();
    await riDisegna(0); // salvataggio caduto: il numero non cambia
    expect(tentaUscita()).toBe(true);
    await riDisegna(1735000000000);
    expect(tentaUscita()).toBe(false);
  });

  it('il clic su un link del pannello chiede conferma e, se dici no, si ferma', async () => {
    const { radice } = await monta();
    const link = document.createElement('a');
    link.href = '/seller/orders';
    document.body.appendChild(link);
    const conferma = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await scrivi(radice, 'Forno e pasticceria');
    const e = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    link.dispatchEvent(e);
    expect(conferma).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(true);
  });

  it('«Tutte le impostazioni» con modifiche chiede, e dice no resta', async () => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    const radice = document.createElement('div');
    document.body.appendChild(radice);
    const root = createRoot(radice);
    accesi.push(root);
    const onBack = vi.fn();
    const profilo = { store_name: 'Pane Quotidiano', store_phone: null, store_address: null, store_lat: null, store_lng: null,
      store_logo: null, store_media: [], store_description: 'Forno', store_hours: {}, store_customization: {} };
    const qc = new QueryClient();
    await act(async () => {
      root.render(createElement(QueryClientProvider, { client: qc }, createElement(StoreDetailsEditor, { profile: profilo, onBack })));
    });
    await aspetta();
    const indietro = () => Array.from(radice.querySelectorAll('button')).find((b) => /Tutte le impostazioni/.test(b.textContent ?? ''))!;
    await act(async () => { indietro().click(); });
    expect(onBack).toHaveBeenCalledTimes(1); // niente modifiche: esce
    const conferma = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await scrivi(radice, 'Forno e pasticceria');
    await act(async () => { indietro().click(); });
    expect(conferma).toHaveBeenCalledTimes(1);
    expect(onBack).toHaveBeenCalledTimes(1);
    conferma.mockReturnValue(true);
    await act(async () => { indietro().click(); });
    expect(onBack).toHaveBeenCalledTimes(2);
  });
});

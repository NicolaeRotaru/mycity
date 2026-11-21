/**
 * @vitest-environment jsdom
 */
/**
 * R02-006 (correzione) — con il selettore della mappa VERO (leaflet finto):
 * - un negozio salvato col vecchio punto di Roma, aperto e chiuso senza toccare niente, non avvisa;
 * - dopo una modifica vera sì;
 * - quello che si scrive mentre il salvataggio è in volo non risulta «salvato».
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { fireEvent } from '@testing-library/dom';

const mappa = vi.hoisted(() => ({ click: null as null | ((e: unknown) => void) }));

vi.mock('leaflet/dist/leaflet.css', () => ({}));
vi.mock('leaflet', () => {
  const marker: Record<string, unknown> = {};
  marker.addTo = () => marker;
  marker.on = () => marker;
  marker.setLatLng = () => marker;
  marker.getLatLng = () => ({ lat: 0, lng: 0 });
  const map: Record<string, unknown> = {};
  map.setView = () => map;
  map.on = (ev: string, fn: (e: unknown) => void) => { if (ev === 'click') mappa.click = fn; return map; };
  map.remove = () => undefined;
  const L = {
    Icon: { Default: { prototype: {}, mergeOptions: () => undefined } },
    map: () => map,
    tileLayer: () => ({ addTo: () => undefined }),
    marker: () => marker,
  };
  return { default: L };
});
vi.mock('@/components/StoreLocationPickerLazy', async () => {
  const mod = await import('@/components/StoreLocationPicker');
  return { default: mod.default };
});
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
  mappa.click = null;
  vi.restoreAllMocks();
});
const aspetta = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });

async function monta(defaultValues: Record<string, unknown>) {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const radice = document.createElement('div');
  document.body.appendChild(radice);
  const root = createRoot(radice);
  accesi.push(root);
  const onDirtyChange = vi.fn();
  const onSubmit = vi.fn();
  const disegna = (n: number) =>
    root.render(createElement(VendorForm, { onSubmit, onDirtyChange, mode: 'all', salvataggioRiuscito: n, defaultValues }));
  await act(async () => { disegna(0); });
  await aspetta();
  return { radice, onDirtyChange, onSubmit, riDisegna: async (n: number) => { await act(async () => { disegna(n); }); await aspetta(); } };
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
const base = { storeName: 'Pane Quotidiano', storeDescription: 'Forno', storeAddress: 'Via Roma 1, Piacenza', storePhone: '0523123456' };

describe('R02-006 · falso avviso col selettore vero', () => {
  it.each([
    ['il vecchio punto di Roma', { storeLat: 41.9028, storeLng: 12.4964 }],
    ['coordinate non valide', { storeLat: 999, storeLng: 999 }],
  ])('negozio con %s: aperto e chiuso senza toccare niente non avvisa', async (_c, coord) => {
    const { onDirtyChange } = await monta({ ...base, ...coord });
    expect(mappa.click).not.toBeNull(); // il selettore vero si è montato davvero
    expect(tentaUscita()).toBe(false);
    expect(onDirtyChange).not.toHaveBeenCalledWith(true);
  });

  it('dopo una modifica vera avvisa', async () => {
    const { radice, onDirtyChange } = await monta({ ...base, storeLat: 41.9028, storeLng: 12.4964 });
    await scrivi(radice, 'Forno e pasticceria');
    expect(tentaUscita()).toBe(true);
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
  });

  it('un tocco sulla mappa dopo il primo gesto è una modifica vera', async () => {
    const { radice } = await monta({ ...base, storeLat: 45.07, storeLng: 9.69 });
    expect(tentaUscita()).toBe(false);
    await act(async () => { fireEvent.pointerDown(radice.querySelector('textarea')!); });
    await act(async () => { mappa.click!({ latlng: { lat: 45.1, lng: 9.8 } }); });
    expect(tentaUscita()).toBe(true);
  });
});

describe('R02-006 · la fotografia si prende all\'invio', () => {
  it('quello che si scrive mentre il salvataggio è in volo tiene accesa la guardia', async () => {
    const { radice, onSubmit, riDisegna } = await monta({ ...base, storeLat: 45.07, storeLng: 9.69 });
    await scrivi(radice, 'Forno e pasticceria');
    await act(async () => { radice.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    await aspetta();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    await scrivi(radice, 'Forno, pasticceria e pizza'); // mentre la risposta è in volo
    await riDisegna(1735000000000); // risposta riuscita
    expect(tentaUscita()).toBe(true);
  });

  it('senza nuove modifiche, a salvataggio riuscito la guardia si spegne', async () => {
    const { radice, onSubmit, riDisegna } = await monta({ ...base, storeLat: 45.07, storeLng: 9.69 });
    await scrivi(radice, 'Forno e pasticceria');
    await act(async () => { radice.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    await aspetta();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    await riDisegna(1735000000000);
    expect(tentaUscita()).toBe(false);
  });
});

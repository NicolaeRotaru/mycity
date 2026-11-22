/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { fireEvent } from '@testing-library/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { clicDaFermare } from '@/components/seller/site/dove-e-l-errore';

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

/**
 * R10-007 — Il conferma delle modifiche non salvate nomina la cosa giusta: «al profilo» sul
 * profilo (modulo dei contatti), «alla vetrina» nell'editor della vetrina («Dettagli negozio»).
 * La prova monta i moduli veri, cambia un campo, clicca un link del pannello e legge il testo
 * che arriva a window.confirm.
 */
const accesi: Root[] = [];
afterEach(() => {
  for (const r of accesi.splice(0)) act(() => r.unmount());
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});
const aspetta = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });
const radiceNuova = () => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const radice = document.createElement('div');
  document.body.appendChild(radice);
  const root = createRoot(radice);
  accesi.push(root);
  return { radice, root };
};
const clicSuUnLink = () => {
  const link = document.createElement('a');
  link.href = '/seller/orders';
  document.body.appendChild(link);
  const conferma = vi.spyOn(window, 'confirm').mockReturnValue(false);
  link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
  return conferma;
};

describe('R10-007 — il conferma dice di cosa si tratta', () => {
  it('il modulo dei contatti (profilo) chiede «al profilo», non «la vetrina»', async () => {
    const { radice, root } = radiceNuova();
    await act(async () => {
      root.render(createElement(VendorForm, { onSubmit: vi.fn(), mode: 'contact', defaultValues: { storeName: 'Pane', storePhone: '0523 456789' } }));
    });
    await aspetta();
    const tel = radice.querySelector('input[name="storePhone"]') as HTMLInputElement;
    await act(async () => { fireEvent.change(tel, { target: { value: '0523 111111' } }); });
    const conferma = clicSuUnLink();
    expect(conferma).toHaveBeenCalledTimes(1);
    const msg = String(conferma.mock.calls[0][0]);
    expect(msg).toContain('modifiche al profilo non salvate');
    expect(msg).not.toContain('vetrina');
  });

  it('i «Dettagli negozio» dentro l\'editor della vetrina chiedono «alla vetrina», non «il profilo»', async () => {
    const { radice, root } = radiceNuova();
    const profilo = { store_name: 'Pane Quotidiano', store_phone: null, store_address: null, store_lat: null, store_lng: null,
      store_logo: null, store_media: [], store_description: 'Forno', store_hours: {}, store_customization: {} };
    await act(async () => {
      root.render(createElement(QueryClientProvider, { client: new QueryClient() },
        createElement(StoreDetailsEditor, { profile: profilo, onBack: vi.fn() })));
    });
    await aspetta();
    const campo = radice.querySelector('textarea') as HTMLTextAreaElement;
    await act(async () => { fireEvent.change(campo, { target: { value: 'Forno e pasticceria' } }); });
    const conferma = clicSuUnLink();
    expect(conferma).toHaveBeenCalledTimes(1);
    const msg = String(conferma.mock.calls[0][0]);
    expect(msg).toContain('modifiche alla vetrina non salvate');
    expect(msg).not.toContain('profilo');
  });

  it('clicDaFermare: la vetrina è il testo predefinito, e un altro testo si può passare', () => {
    const a = document.createElement('a');
    a.href = '/seller/orders';
    document.body.appendChild(a);
    const ev = { defaultPrevented: false, button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, target: a };
    const c1 = vi.fn((_m: string) => false);
    clicDaFermare(ev, true, '/seller/site', c1);
    expect(c1.mock.calls[0]?.[0]).toContain('modifiche alla vetrina non salvate');
    const c2 = vi.fn((_m: string) => false);
    clicDaFermare(ev, true, '/seller/profile', c2, 'al profilo');
    expect(c2.mock.calls[0]?.[0]).toContain('modifiche al profilo non salvate');
  });
});

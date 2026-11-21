/**
 * @vitest-environment jsdom
 */
/**
 * R02-006 — Il profilo del negozio (contatti e orari) usa VendorForm: con il telefono cambiato
 * uscire avvisa; dopo il salvataggio riuscito no; se il salvataggio cade, sì.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { fireEvent } from '@testing-library/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const stato = vi.hoisted(() => ({ erroreUpdate: null as null | { message: string } }));

vi.mock('@/lib/supabase/client', () => {
  const profilo = {
    id: 'n1', is_approved: true, store_name: 'Pane Quotidiano', store_phone: '0523 456789',
    store_address: 'Via Roma 10, Piacenza', store_lat: 45.06, store_lng: 9.7, store_hours: {},
    store_description: '', store_media: [], store_customization: {}, offers_express: false,
  };
  const lettura = () => {
    const q: Record<string, unknown> = {};
    q.select = () => q;
    q.eq = () => q;
    q.single = async () => ({ data: profilo, error: null });
    q.update = () => ({ eq: async () => ({ error: stato.erroreUpdate }) });
    return q;
  };
  return { supabase: { auth: { getUser: async () => ({ data: { user: { id: 'n1' } } }) }, from: () => lettura() } };
});
vi.mock('@/components/StoreLocationPickerLazy', async () => {
  const { useEffect } = await import('react');
  return {
    default: function Finto({ onChange }: { onChange: (l: unknown) => void }) {
      useEffect(() => { onChange({ address: 'Via Roma 10, Piacenza', lat: 45.06, lng: 9.7, confermata: true }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
      return null;
    },
  };
});
vi.mock('next/link', async () => {
  const { createElement: ce } = await import('react');
  return { default: ({ href, children, ...r }: Record<string, unknown>) => ce('a', { href: String(href), ...r }, children as never) };
});
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('sonner', () => ({ toast: Object.assign(() => undefined, { success: () => undefined, error: () => undefined, info: () => undefined }) }));
vi.mock('react-dropzone', () => ({
  useDropzone: () => ({ getRootProps: () => ({}), getInputProps: () => ({}), isDragActive: false, open: () => undefined }),
}));
vi.mock('@/components/StoreAvatar', () => ({ default: () => null }));
vi.mock('@/components/StoreMediaManager', () => ({ default: () => null }));
vi.mock('@/components/PushNotificationOptIn', () => ({ default: () => null }));
vi.mock('@/components/seller/DatiPerIBonifici', () => ({ default: () => null }));
vi.mock('@/components/seller/GestisciAbbonamento', () => ({ default: () => null }));
vi.mock('@/components/seller/StoreHoursEditor', () => ({ default: () => null }));

import SellerProfilePage from '@/app/seller/profile/page';

const accesi: Root[] = [];
beforeEach(() => { stato.erroreUpdate = null; });
afterEach(() => {
  for (const r of accesi.splice(0)) act(() => r.unmount());
  document.body.innerHTML = '';
});
const aspetta = () => act(async () => { await new Promise((r) => setTimeout(r, 40)); });
const tentaUscita = () => {
  const e = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(e);
  return e.defaultPrevented;
};

async function monta() {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const radice = document.createElement('div');
  document.body.appendChild(radice);
  const root = createRoot(radice);
  accesi.push(root);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  await act(async () => { root.render(createElement(QueryClientProvider, { client: qc }, createElement(SellerProfilePage))); });
  await aspetta();
  await aspetta();
  return radice;
}
const telefono = (r: HTMLElement) => r.querySelector('input[name="storePhone"]') as HTMLInputElement;
async function cambiaTelefono(r: HTMLElement) {
  await act(async () => { fireEvent.input(telefono(r), { target: { value: '0523 111222' } }); });
}
async function salva(r: HTMLElement) {
  await act(async () => { r.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  await aspetta();
}

describe('R02-006 · profilo del negozio', () => {
  it('aperto e non toccato: uscire non è fermato', async () => {
    await monta();
    expect(tentaUscita()).toBe(false);
  });

  it('con il telefono cambiato uscire è fermato', async () => {
    const r = await monta();
    expect(telefono(r).value).toBe('0523 456789');
    await cambiaTelefono(r);
    expect(tentaUscita()).toBe(true);
  });

  it('dopo il salvataggio riuscito non è più fermato', async () => {
    const r = await monta();
    await cambiaTelefono(r);
    await salva(r);
    expect(tentaUscita()).toBe(false);
  });

  it('se il salvataggio cade, l\'avviso resta', async () => {
    stato.erroreUpdate = { message: 'rete' };
    const r = await monta();
    await cambiaTelefono(r);
    await salva(r);
    expect(tentaUscita()).toBe(true);
  });
});

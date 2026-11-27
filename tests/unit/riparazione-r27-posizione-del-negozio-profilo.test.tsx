/**
 * @vitest-environment jsdom
 */
/**
 * La posizione del negozio poteva finire lontano da Piacenza e il profilo la salvava lo stesso.
 *
 * Il profilo scrive le coordinate direttamente nel database (nessuna rotta le guarda): una
 * posizione a Roma o a Milano (un «Cerca» finito nell'altra città, il GPS di chi aggiorna da
 * casa) si salvava e il negozio smetteva di ricevere consegne. Qui la pagina vera si monta col
 * selettore finto che manda una posizione già «confermata», e si guarda cosa arriva al database.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { fireEvent } from '@testing-library/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const stato = vi.hoisted(() => ({
  aggiornamenti: [] as Record<string, unknown>[],
  errori: [] as string[],
  posizione: { lat: 45.06, lng: 9.7 },
}));

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
    q.update = (v: Record<string, unknown>) => { stato.aggiornamenti.push(v); return { eq: async () => ({ error: null }) }; };
    return q;
  };
  return { supabase: { auth: { getUser: async () => ({ data: { user: { id: 'n1' } } }) }, from: () => lettura() } };
});
vi.mock('@/components/StoreLocationPickerLazy', async () => {
  const { useEffect } = await import('react');
  return {
    default: function Finto({ onChange }: { onChange: (l: unknown) => void }) {
      useEffect(() => { onChange({ address: 'Via Roma 10', lat: stato.posizione.lat, lng: stato.posizione.lng, confermata: true }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
      return null;
    },
  };
});
vi.mock('next/link', async () => {
  const { createElement: ce } = await import('react');
  return { default: ({ href, children, ...r }: Record<string, unknown>) => ce('a', { href: String(href), ...r }, children as never) };
});
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('sonner', () => ({
  toast: Object.assign(() => undefined, { success: () => undefined, error: (m: string) => { stato.errori.push(m); }, info: () => undefined }),
}));
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
beforeEach(() => { stato.aggiornamenti = []; stato.errori = []; stato.posizione = { lat: 45.06, lng: 9.7 }; });
afterEach(() => {
  for (const r of accesi.splice(0)) act(() => r.unmount());
  document.body.innerHTML = '';
});
const aspetta = () => act(async () => { await new Promise((r) => setTimeout(r, 40)); });
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

describe('il profilo non salva una posizione fuori da Piacenza e dintorni', () => {
  it('posizione a Roma: nessuna scrittura, e il negozio legge perché', async () => {
    stato.posizione = { lat: 41.9009, lng: 12.4833 };
    const r = await monta();
    await cambiaTelefono(r);
    await salva(r);
    expect(stato.aggiornamenti, 'le coordinate di Roma arrivavano al database').toHaveLength(0);
    expect(stato.errori.join(' ')).toContain('fuori da Piacenza');
  });

  it('posizione a Piacenza: si salva come prima', async () => {
    const r = await monta();
    await cambiaTelefono(r);
    await salva(r);
    expect(stato.aggiornamenti).toHaveLength(1);
    expect(stato.aggiornamenti[0]).toMatchObject({ store_lat: 45.06, store_lng: 9.7 });
  });
});

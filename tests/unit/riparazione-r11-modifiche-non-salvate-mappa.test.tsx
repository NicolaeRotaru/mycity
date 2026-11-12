// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement, useEffect, type ReactNode } from 'react';
import { disegna } from './aiuti/cabina-admin';

/**
 * R11-015 (dal controllo qa) — All'apertura la mappa rimanda al modulo il suo punto di partenza: con
 * una posizione salvata non valida (o il vecchio punto di Roma) l'avviso d'uscita compariva senza che
 * nessuno avesse toccato niente. Qui la mappa finta fa lo stesso: un allineamento all'apertura.
 */

const mappa = vi.hoisted(() => ({ sposta: null as null | ((l: unknown) => void) }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k, useLocale: () => 'it' }));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn() }) }));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children?: ReactNode }) => createElement('a', { href }, children) }));
vi.mock('@/lib/supabase/client', () => ({ supabase: { auth: { getUser: async () => ({ data: { user: { id: 'forno' } } }) } } }));
vi.mock('@/components/StoreLocationPickerLazy', () => ({
  default: ({ onChange }: { onChange: (l: unknown) => void }) => {
    useEffect(() => {
      onChange({ address: 'Via Calzolai 1', lat: 45.0532, lng: 9.6914, confermata: false });
      mappa.sposta = onChange;
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return null;
  },
}));

import VendorForm from '@/components/VendorForm';

let chiudi: (() => void) | null = null;
afterEach(() => { chiudi?.(); chiudi = null; });

const lasciaLaPagina = () => {
  const e = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(e);
  return e.defaultPrevented;
};

describe('R11-015 — la mappa che si allinea all apertura non è una modifica', () => {
  it('nessun avviso all apertura; avviso dopo aver spostato il negozio sulla mappa', async () => {
    const r = await disegna(
      createElement(VendorForm, {
        mode: 'contact', onSubmit: () => {},
        defaultValues: { storeName: 'Pane', storePhone: '0523 123456', storeAddress: 'Via Calzolai 1', storeLat: 41.9028, storeLng: 12.4964 },
      }),
    );
    chiudi = r.chiudi;
    await act(async () => { await new Promise((ok) => setTimeout(ok, 10)); });
    expect(lasciaLaPagina(), 'l avviso compare senza che nessuno abbia toccato niente').toBe(false);
    await act(async () => { mappa.sposta?.({ address: 'Via Calzolai 1', lat: 45.05, lng: 9.69, confermata: true }); });
    expect(lasciaLaPagina()).toBe(true);
  });
});

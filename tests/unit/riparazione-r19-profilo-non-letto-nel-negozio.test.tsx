/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';

/**
 * R19-023 — se la lettura del profilo non riesce, il negoziante approvato
 * leggeva «Il tuo account è di altro tipo» col pulsante «Diventa venditore».
 *
 * Qui si monta il layout vero di /seller con l'aggancio useProfile vero: il
 * finto è solo supabase. L'utente è autenticato; la lettura di `profiles` può
 * rispondere 500, riuscire, o non partire perché manca la rete.
 */

type Esito = { data: Record<string, unknown> | null; error: { message: string; code: string } | null };
let esitoProfilo: Esito = { data: null, error: null };

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock('next-intl', () => ({
  useTranslations: () => (k: string) => ({ retry: 'Riprova', back: 'Indietro', generic: 'Errore' } as Record<string, string>)[k] ?? k,
}));
vi.mock('@/lib/analytics/posthog', () => ({ identify: () => undefined, resetUser: () => undefined }));
vi.mock('@/lib/analytics/sentry', () => ({ setSentryUser: () => undefined }));
vi.mock('@/components/seller/SellerShell', () => ({
  default: ({ children }: { children: React.ReactNode }) => createElement('div', { 'data-prova': 'cruscotto' }, children),
}));
vi.mock('@/components/seller/SubscriptionBanner', () => ({ SubscriptionBanner: () => null }));
vi.mock('@/lib/supabase/client', () => {
  const catena = {
    select: () => catena,
    eq: () => catena,
    single: async () => esitoProfilo,
  };
  return {
    supabase: {
      auth: {
        getUser: async () => ({ data: { user: { id: 's1', email: 'forno@test.it' } } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
      },
      from: () => catena,
    },
  };
});

const { default: SellerLayout } = await import('@/app/seller/layout');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let radice: HTMLElement;
let root: Root;

async function lascia() {
  for (let i = 0; i < 10; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

async function monta() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  radice = document.createElement('div');
  document.body.appendChild(radice);
  await act(async () => {
    root = createRoot(radice);
    root.render(
      createElement(QueryClientProvider, { client: qc }, createElement(SellerLayout, null, createElement('p', null, 'contenuto'))),
    );
  });
  await lascia();
}

const NEGOZIO = { id: 's1', role: 'seller', is_approved: true, store_name: 'Forno', store_logo: null, full_name: 'Gino', subscription_status: 'active' };

beforeEach(() => {
  esitoProfilo = { data: null, error: { message: 'boom', code: '500' } };
});
afterEach(async () => {
  onlineManager.setOnline(true);
  await act(async () => { root.unmount(); });
  radice.remove();
});

describe('R19-023 · il negozio col profilo non letto non legge «altro tipo»', () => {
  it('lettura del profilo a 500: niente «altro tipo» né «Diventa venditore», c è «Riprova» e funziona', async () => {
    await monta();
    const testo = radice.textContent ?? '';
    expect(testo).not.toContain('altro tipo');
    expect(testo).not.toContain('Diventa venditore');
    expect(radice.querySelector('a[href="/sell"]')).toBeNull();
    const riprova = [...radice.querySelectorAll('button')].find((b) => /Riprova/.test(b.textContent ?? ''));
    expect(riprova, 'manca il pulsante «Riprova»').toBeDefined();

    // Torna il database: «Riprova» rilegge e il negozio entra nel suo pannello.
    esitoProfilo = { data: NEGOZIO, error: null };
    await act(async () => { riprova!.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
    await lascia();
    expect(radice.querySelector('[data-prova="cruscotto"]')?.textContent).toContain('contenuto');
  });

  it('senza rete la lettura resta in pausa: anche lì niente «altro tipo», si propone di riprovare', async () => {
    onlineManager.setOnline(false);
    esitoProfilo = { data: NEGOZIO, error: null };
    await monta();
    const testo = radice.textContent ?? '';
    expect(testo).not.toContain('altro tipo');
    expect(testo).not.toContain('Diventa venditore');
    expect([...radice.querySelectorAll('button')].some((b) => /Riprova/.test(b.textContent ?? ''))).toBe(true);
  });

  it('un cliente col profilo letto vede ancora «Quest area è per i venditori»', async () => {
    esitoProfilo = { data: { ...NEGOZIO, role: 'buyer', is_approved: false, store_name: null }, error: null };
    await monta();
    const testo = radice.textContent ?? '';
    expect(testo).toContain("Quest'area è per i venditori");
    expect(testo).toContain('un acquirente');
  });
});

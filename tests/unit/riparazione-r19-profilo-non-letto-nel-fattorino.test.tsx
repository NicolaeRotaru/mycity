/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';

/**
 * R19-023 (giro di correzione) — il collaudo K06 ha montato il layout vero del fattorino con
 * useProfile vero e la lettura del profilo a 500: il fattorino leggeva «Accesso riservato ai
 * rider.» e veniva mandato alla home, lo stesso difetto già curato nel layout del negozio.
 *
 * Qui si monta il layout vero di /rider con l'aggancio useProfile vero: il finto è solo supabase
 * (e il router, per vedere dove si viene mandati).
 */

type Esito = { data: Record<string, unknown> | null; error: { message: string; code: string } | null };
let esitoProfilo: Esito = { data: null, error: null };
const sostituisci = vi.fn();

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: sostituisci, push: vi.fn() }) }));
vi.mock('next-intl', () => ({
  useTranslations: () => (k: string) => ({ retry: 'Riprova', back: 'Indietro', generic: 'Errore' } as Record<string, string>)[k] ?? k,
}));
vi.mock('@/lib/analytics/posthog', () => ({ identify: () => undefined, resetUser: () => undefined }));
vi.mock('@/lib/analytics/sentry', () => ({ setSentryUser: () => undefined }));
vi.mock('@/components/rider/RiderShell', () => ({
  default: ({ children }: { children: React.ReactNode }) => createElement('div', { 'data-prova': 'pannello-rider' }, children),
}));
vi.mock('@/lib/supabase/client', () => {
  const catena = {
    select: () => catena,
    eq: () => catena,
    single: async () => esitoProfilo,
  };
  return {
    supabase: {
      auth: {
        getUser: async () => ({ data: { user: { id: 'r1', email: 'rider@test.it' } } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
      },
      from: () => catena,
    },
  };
});

const { default: RiderLayout } = await import('@/app/rider/layout');

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
      createElement(QueryClientProvider, { client: qc }, createElement(RiderLayout, null, createElement('p', null, 'contenuto'))),
    );
  });
  await lascia();
}

const RIDER = { id: 'r1', role: 'rider', is_approved: true, store_name: null, store_logo: null, full_name: 'Gino' };

beforeEach(() => {
  esitoProfilo = { data: null, error: { message: 'boom', code: '500' } };
  sostituisci.mockClear();
});
afterEach(async () => {
  onlineManager.setOnline(true);
  await act(async () => { root.unmount(); });
  radice.remove();
});

describe('R19-023 · il fattorino col profilo non letto non legge «riservato ai rider»', () => {
  it('lettura del profilo a 500: niente «Accesso riservato», nessun rimando alla home, «Riprova» fa entrare', async () => {
    await monta();
    expect(radice.textContent ?? '').not.toContain('Accesso riservato ai rider');
    expect(sostituisci).not.toHaveBeenCalledWith('/');
    const riprova = [...radice.querySelectorAll('button')].find((b) => /Riprova/.test(b.textContent ?? ''));
    expect(riprova, 'manca il pulsante «Riprova»').toBeDefined();

    // Torna il database: «Riprova» rilegge e il fattorino entra nel suo pannello.
    esitoProfilo = { data: RIDER, error: null };
    await act(async () => { riprova!.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
    await lascia();
    expect(radice.querySelector('[data-prova="pannello-rider"]')?.textContent).toContain('contenuto');
    expect(sostituisci).not.toHaveBeenCalledWith('/');
  });

  it('senza rete la lettura resta in pausa: niente «Accesso riservato», niente home, si propone di riprovare', async () => {
    onlineManager.setOnline(false);
    esitoProfilo = { data: RIDER, error: null };
    await monta();
    expect(radice.textContent ?? '').not.toContain('Accesso riservato ai rider');
    expect(sostituisci).not.toHaveBeenCalledWith('/');
    expect([...radice.querySelectorAll('button')].some((b) => /Riprova/.test(b.textContent ?? ''))).toBe(true);
  });

  it('un cliente col profilo letto resta fuori: «Accesso riservato ai rider» e rimando alla home', async () => {
    esitoProfilo = { data: { ...RIDER, role: 'buyer' }, error: null };
    await monta();
    expect(radice.textContent ?? '').toContain('Accesso riservato ai rider');
    expect(sostituisci).toHaveBeenCalledWith('/');
  });
});

/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';

/**
 * 17/11/2026 (R01-013) — Se la lettura del profilo non riesce, chi entra in /admin leggeva
 * «Accesso riservato agli amministratori.» e veniva mandato alla home: lo stesso difetto già
 * curato nei layout del negozio e del fattorino. Un profilo non letto non è «un altro ruolo».
 *
 * L'accesso non si allarga: senza profilo letto il cockpit non si apre (si offre «Riprova»), e chi
 * ha un profilo letto ma non è amministratore resta fuori, con il rimando alla home di prima.
 *
 * Qui si monta il layout vero di /admin con l'aggancio useProfile vero: il finto è solo supabase
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
vi.mock('@/components/admin/AdminSidebar', () => ({
  default: () => createElement('nav', { 'data-prova': 'barra-admin' }),
  AdminMobileTopbar: () => null,
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
        getUser: async () => ({ data: { user: { id: 'a1', email: 'admin@test.it' } } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
      },
      from: () => catena,
    },
  };
});

const { default: AdminLayout } = await import('@/app/admin/layout');

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
      createElement(QueryClientProvider, { client: qc }, createElement(AdminLayout, null, createElement('p', null, 'cockpit'))),
    );
  });
  await lascia();
}

const ADMIN = { id: 'a1', role: 'admin', is_approved: true, store_name: null, store_logo: null, full_name: 'Ada' };

beforeEach(() => {
  esitoProfilo = { data: null, error: { message: 'boom', code: '500' } };
  sostituisci.mockClear();
});
afterEach(async () => {
  onlineManager.setOnline(true);
  await act(async () => { root.unmount(); });
  radice.remove();
});

describe('R01-013 · in amministrazione il profilo non letto non vale «non sei amministratore»', () => {
  it('lettura del profilo a 500: niente «Accesso riservato», nessun rimando alla home, il cockpit resta chiuso, «Riprova» fa entrare', async () => {
    await monta();
    expect(radice.textContent ?? '').not.toContain('Accesso riservato agli amministratori');
    expect(sostituisci).not.toHaveBeenCalledWith('/');
    expect(radice.textContent ?? '', 'senza profilo letto il cockpit non si apre').not.toContain('cockpit');
    expect(radice.querySelector('[data-prova="barra-admin"]')).toBeNull();
    expect(radice.textContent ?? '').toContain('Non riesco a leggere i dati del tuo account');
    const riprova = [...radice.querySelectorAll('button')].find((b) => /Riprova/.test(b.textContent ?? ''));
    expect(riprova, 'manca il pulsante «Riprova»').toBeDefined();

    // Torna il database: «Riprova» rilegge e l'amministratore entra nel cockpit.
    esitoProfilo = { data: ADMIN, error: null };
    await act(async () => { riprova!.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
    await lascia();
    expect(radice.textContent ?? '').toContain('cockpit');
    expect(radice.querySelector('[data-prova="barra-admin"]')).not.toBeNull();
    expect(sostituisci).not.toHaveBeenCalledWith('/');
  });

  it('senza rete la lettura resta in pausa: niente «Accesso riservato», niente home, cockpit chiuso, si propone di riprovare', async () => {
    onlineManager.setOnline(false);
    esitoProfilo = { data: ADMIN, error: null };
    await monta();
    expect(radice.textContent ?? '').not.toContain('Accesso riservato agli amministratori');
    expect(sostituisci).not.toHaveBeenCalledWith('/');
    expect(radice.textContent ?? '').not.toContain('cockpit');
    expect([...radice.querySelectorAll('button')].some((b) => /Riprova/.test(b.textContent ?? ''))).toBe(true);
  });

  it('un venditore col profilo letto resta fuori: «Accesso riservato agli amministratori» e rimando alla home', async () => {
    esitoProfilo = { data: { ...ADMIN, role: 'seller' }, error: null };
    await monta();
    expect(radice.textContent ?? '').toContain('Accesso riservato agli amministratori');
    expect(radice.textContent ?? '').not.toContain('cockpit');
    expect(sostituisci).toHaveBeenCalledWith('/');
  });
});

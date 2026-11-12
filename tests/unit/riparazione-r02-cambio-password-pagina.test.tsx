/**
 * @vitest-environment jsdom
 *
 * R02-012 (12/11/2026) — La prova del cambio password monta la pagina vera e invia il modulo:
 * deve partire UNA chiamata a /api/account/cambia-password con la password attuale, e nessun
 * auth.updateUser con una password dal browser (che la cambierebbe senza chiedere quella vecchia).
 * La prova di prima leggeva la pagina come testo: bastava scrivere `updateUser({password: …})`
 * senza lo spazio per farla passare.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from 'react';
import { accendi } from './aiuti/schermo';

const UTENTE = { id: 'u-1', email: 'anna@example.com' };
const stato: { updateUser: unknown[]; fetch: Array<{ url: string; metodo: string; corpo: unknown }> } = { updateUser: [], fetch: [] };

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: {
      getUser: async () => ({ data: { user: UTENTE }, error: null }),
      getSession: async () => ({ data: { session: { access_token: 'gettone' } }, error: null }),
      updateUser: async (attributi: unknown) => { stato.updateUser.push(attributi); return { data: {}, error: null }; },
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: { notif_order_updates: true, notif_promos: true, notif_groups: true, notif_newsletter: false, email_marketing: false },
            error: null,
          }),
        }),
      }),
      update: () => ({ eq: async () => ({ error: null }) }),
    }),
  },
}));
vi.mock('next/navigation', () => {
  const rotta = { push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} };
  return { useRouter: () => rotta };
});
vi.mock('next/link', async () => {
  const { createElement } = await import('react');
  return {
    default: function Collegamento({ href, children, ...resto }: { href: unknown; children?: unknown } & Record<string, unknown>) {
      return createElement('a', { ...resto, href: String(href) }, children as never);
    },
  };
});
vi.mock('next-intl', () => ({ useTranslations: () => (chiave: string) => chiave }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/analytics/events', () => ({ trackErrorShown: () => {} }));
vi.mock('@/components/PushNotificationOptIn', () => ({ default: function PushNotificationOptIn() { return null; } }));
vi.mock('@/components/PublicProfileToggle', () => ({ default: function PublicProfileToggle() { return null; } }));

import SettingsPage from '@/app/profile/settings/page';

async function aspetta() {
  for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

function scrivi(campo: HTMLInputElement, valore: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(campo, valore);
  campo.dispatchEvent(new Event('input', { bubbles: true }));
}

beforeEach(() => {
  stato.updateUser = [];
  stato.fetch = [];
  window.history.replaceState(null, '', '/profile/settings?tab=password');
  (globalThis as Record<string, unknown>).fetch = async (url: string, init?: RequestInit) => {
    stato.fetch.push({ url: String(url), metodo: (init?.method ?? 'GET').toUpperCase(), corpo: init?.body ? JSON.parse(String(init.body)) : null });
    return new Response(JSON.stringify({ ok: true, pending: false }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
});

describe('R02-012 · il cambio password dalla pagina passa dal server, con la password attuale', () => {
  it('una sola chiamata a /api/account/cambia-password e nessun updateUser con password', async () => {
    const s = accendi(SettingsPage);
    await aspetta();
    let campi = Array.from(s.radice.querySelectorAll('input[type="password"]')) as HTMLInputElement[];
    if (campi.length === 0) {
      const scheda = Array.from(s.radice.querySelectorAll('button')).find((b) => /password/i.test(b.textContent ?? ''));
      await act(async () => { scheda?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
      await aspetta();
      campi = Array.from(s.radice.querySelectorAll('input[type="password"]')) as HTMLInputElement[];
    }
    expect(campi).toHaveLength(3);
    await act(async () => {
      scrivi(campi[0], 'vecchia-123');
      scrivi(campi[1], 'nuovissima-123');
      scrivi(campi[2], 'nuovissima-123');
    });
    const form = campi[0].closest('form') as HTMLFormElement;
    await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    await aspetta();

    const cambi = stato.fetch.filter((f) => f.url.includes('/api/account/cambia-password'));
    expect(cambi).toHaveLength(1);
    expect(cambi[0].metodo).toBe('POST');
    expect(cambi[0].corpo).toEqual({ passwordAttuale: 'vecchia-123', nuovaPassword: 'nuovissima-123' });
    expect(stato.updateUser.filter((a) => a && typeof a === 'object' && 'password' in (a as object))).toEqual([]);
    s.smonta();
  });
});

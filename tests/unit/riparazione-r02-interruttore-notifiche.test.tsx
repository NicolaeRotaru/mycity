/**
 * @vitest-environment jsdom
 *
 * R02-017 (12/11/2026) — Se un'impostazione delle notifiche non si salva, l'interruttore torna
 * nella posizione di prima: non dice «spento» mentre nel database è acceso.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from 'react';
import { accendi } from './aiuti/schermo';

const UTENTE = { id: 'u-1', email: 'anna@example.com' };
const stato: { erroreSalvataggio: unknown; scritture: unknown[] } = { erroreSalvataggio: null, scritture: [] };

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: {
      getUser: async () => ({ data: { user: UTENTE }, error: null }),
      getSession: async () => ({ data: { session: { access_token: 'gettone' } }, error: null }),
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
      update: (v: unknown) => { stato.scritture.push(v); return { eq: async () => ({ error: stato.erroreSalvataggio }) }; },
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

beforeEach(() => {
  stato.scritture = [];
  window.history.replaceState(null, '', '/profile/settings?tab=notifications');
  (globalThis as Record<string, unknown>).fetch = async () =>
    new Response(JSON.stringify({ pending: false }), { status: 200, headers: { 'content-type': 'application/json' } });
});

async function premiIlPrimoInterruttore() {
  const s = accendi(SettingsPage);
  await aspetta();
  const interruttore = s.radice.querySelector('[role="switch"]') as HTMLButtonElement;
  expect(interruttore, 'la scheda Notifiche deve avere i suoi interruttori').toBeTruthy();
  expect(interruttore.getAttribute('aria-checked')).toBe('true');
  await act(async () => { interruttore.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await aspetta();
  const dopo = interruttore.getAttribute('aria-checked');
  s.smonta();
  return dopo;
}

describe('R02-017 · l interruttore delle notifiche e il salvataggio', () => {
  it('salvataggio rifiutato: l interruttore torna acceso', async () => {
    stato.erroreSalvataggio = { message: 'permesso negato' };
    expect(await premiIlPrimoInterruttore()).toBe('true');
    expect(stato.scritture).toHaveLength(1);
  });

  it('salvataggio riuscito: l interruttore resta spento', async () => {
    stato.erroreSalvataggio = null;
    expect(await premiIlPrimoInterruttore()).toBe('false');
  });
});

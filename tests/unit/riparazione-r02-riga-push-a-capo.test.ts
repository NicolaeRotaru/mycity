/**
 * @vitest-environment jsdom
 *
 * R02-003 — La riga «Notifiche push del browser» delle impostazioni non aveva min-w-0 sul testo.
 *
 * Nelle altre righe della scheda Notifiche (components/ui/Toggle.tsx) il testo sta in un
 * contenitore `min-w-0 break-words`: dentro una riga flex è quello che lo fa andare a capo invece
 * di spingere fuori il comando a destra. La riga delle push ne era senza. Prova leggera: si monta
 * la pagina vera sulla scheda Notifiche e si guarda il contenitore del testo di quella riga.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from 'react';
import { accendi } from './aiuti/schermo';

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: {
      getUser: async () => ({ data: { user: { id: 'u-1', email: 'anna@example.com' } }, error: null }),
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

beforeEach(() => {
  window.history.replaceState(null, '', '/profile/settings?tab=notifications');
  (globalThis as Record<string, unknown>).fetch = async () =>
    new Response(JSON.stringify({ pending: false }), { status: 200, headers: { 'content-type': 'application/json' } });
});

describe('R02-003 · la riga delle notifiche push va a capo come le altre', () => {
  it('il testo della riga sta in un contenitore min-w-0 break-words, come quello degli interruttori', async () => {
    const s = accendi(SettingsPage);
    await aspetta();
    const titolo = Array.from(s.radice.querySelectorAll('div.font-semibold'))
      .find((el) => el.textContent?.includes('Notifiche push del browser'));
    expect(titolo, 'la scheda Notifiche non mostra più la riga delle push').toBeTruthy();
    const testo = titolo!.parentElement!;
    const riga = testo.parentElement!;
    expect(riga.className).toMatch(/\bflex\b/);
    expect(testo.className.split(/\s+/), 'il testo della riga push non ha min-w-0: spinge fuori il comando').toContain('min-w-0');
    expect(testo.className.split(/\s+/)).toContain('break-words');

    // Lo stesso contenitore che usano le righe degli interruttori nella stessa scheda.
    const interruttore = s.radice.querySelector('[role="switch"]')!;
    const testoInterruttore = interruttore.parentElement!.firstElementChild!;
    expect(testo.className).toBe(testoInterruttore.className);
    s.smonta();
  });
});

/**
 * @vitest-environment jsdom
 *
 * R19-020 (giro di correzione, 14/11/2026) — IL RIPIEGO DELLE IMPOSTAZIONI TIENE `?tab=`.
 *
 * Il portiere (middleware) porta già percorso e query fino all'accesso. Ma se la pagina delle
 * impostazioni si apre e non trova l'utente (sessione scaduta fra il portiere e la pagina, la
 * «corsa rara» del collaudo K06), rimandava da sola a `/sign-in?returnTo=/profile/settings` e la
 * scheda chiesta si perdeva. Qui si monta la pagina vera con un Supabase finto senza utente e si
 * guarda dove manda il router.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from 'react';
import { accendi } from './aiuti/schermo';

const stato: { push: string[] } = { push: [] };

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: {
      getUser: async () => ({ data: { user: null }, error: null }),
      getSession: async () => ({ data: { session: null }, error: null }),
    },
    from: () => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: null, error: null }) }) }),
      update: () => ({ eq: async () => ({ error: null }) }),
    }),
  },
}));
vi.mock('next/navigation', () => {
  const rotta = {
    push: (dove: string) => { stato.push.push(dove); },
    replace: () => {},
    refresh: () => {},
    back: () => {},
    forward: () => {},
    prefetch: () => {},
  };
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
vi.mock('sonner', () => ({ toast: { success: () => {}, error: () => {}, info: () => {} } }));
vi.mock('@/lib/analytics/events', () => ({ trackErrorShown: () => {} }));
vi.mock('@/components/PushNotificationOptIn', () => ({ default: function PushNotificationOptIn() { return null; } }));
vi.mock('@/components/PublicProfileToggle', () => ({ default: function PublicProfileToggle() { return null; } }));

import SettingsPage from '@/app/profile/settings/page';
import { safeInternalPath } from '@/lib/safe-redirect';

async function aspetta() {
  for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

/** Il `returnTo` che l'accesso leggerà, come lo legge `app/sign-in/page.tsx`. */
function ritornoDellAccesso(): string {
  const ultimo = stato.push.find((d) => d.startsWith('/sign-in'));
  expect(ultimo, 'la pagina non ha mandato all accesso').toBeDefined();
  const url = new URL(ultimo!, 'https://mycity.test');
  return safeInternalPath(url.searchParams.get('returnTo'), '/');
}

beforeEach(() => {
  stato.push = [];
});

describe('R19-020 · senza utente, le impostazioni mandano all accesso tenendo la scheda', () => {
  it('da ?tab=danger si torna su ?tab=danger', async () => {
    window.history.replaceState(null, '', '/profile/settings?tab=danger');
    accendi(SettingsPage);
    await aspetta();
    expect(ritornoDellAccesso()).toBe('/profile/settings?tab=danger');
  });

  it('senza query il ritorno resta /profile/settings', async () => {
    window.history.replaceState(null, '', '/profile/settings');
    accendi(SettingsPage);
    await aspetta();
    expect(ritornoDellAccesso()).toBe('/profile/settings');
  });

  it('una query oltre i 512 caratteri non si porta: resta il solo percorso, come nel portiere', async () => {
    window.history.replaceState(null, '', `/profile/settings?tab=danger&x=${'a'.repeat(600)}`);
    accendi(SettingsPage);
    await aspetta();
    expect(ritornoDellAccesso()).toBe('/profile/settings');
  });
});

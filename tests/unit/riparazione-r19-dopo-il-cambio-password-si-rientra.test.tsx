/**
 * @vitest-environment jsdom
 *
 * R19-021 (13/11/2026) — DOPO IL CAMBIO DELLA PASSWORD NON SI RESTA DENTRO PER FINTA.
 *
 * La rotta scrive la password nuova col client di servizio, e il servizio di accesso
 * chiude tutte le sessioni dell'account, anche quella che ha fatto il cambio. La
 * pagina diceva «Password aggiornata con successo» e restava lì: al clic dopo ogni
 * rotta rispondeva 401 e /orders chiedeva di accedere, senza che nessuno l'avesse
 * detto. Qui si monta la pagina vera con un Supabase finto, si cambia la password e
 * si guarda cosa succede dopo il 200: la sessione del browser si chiude (in locale),
 * si va all'accesso col ritorno alle impostazioni, e il messaggio dice di accedere
 * con la password nuova. Se la rotta dice di no, si resta sulla pagina come prima.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from 'react';
import { accendi } from './aiuti/schermo';

const UTENTE = { id: 'u-1', email: 'anna@example.com' };
const stato: { signOut: unknown[]; push: string[]; ordine: string[]; risposta: { status: number; corpo: unknown } } = {
  signOut: [],
  push: [],
  ordine: [],
  risposta: { status: 200, corpo: { ok: true } },
};
const avvisi = vi.hoisted(() => ({ success: [] as string[], error: [] as string[] }));

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: {
      getUser: async () => ({ data: { user: UTENTE }, error: null }),
      getSession: async () => ({ data: { session: { access_token: 'gettone' } }, error: null }),
      updateUser: async () => ({ data: {}, error: null }),
      signOut: async (opzioni?: unknown) => {
        stato.signOut.push(opzioni ?? null);
        stato.ordine.push('signOut');
        return { error: null };
      },
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
  const rotta = {
    push: (dove: string) => { stato.push.push(dove); stato.ordine.push('push'); },
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
vi.mock('sonner', () => ({
  toast: {
    success: (testo: string) => { avvisi.success.push(testo); },
    error: (testo: string) => { avvisi.error.push(testo); },
    info: () => {},
  },
}));
vi.mock('@/lib/analytics/events', () => ({ trackErrorShown: () => {} }));
vi.mock('@/components/PushNotificationOptIn', () => ({ default: function PushNotificationOptIn() { return null; } }));
vi.mock('@/components/PublicProfileToggle', () => ({ default: function PublicProfileToggle() { return null; } }));

import SettingsPage from '@/app/profile/settings/page';

async function aspetta() {
  for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

function scrivi(campo: HTMLInputElement, valore: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(campo, valore);
  campo.dispatchEvent(new Event('input', { bubbles: true }));
}

async function cambiaPassword() {
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
  return s;
}

beforeEach(() => {
  stato.signOut = [];
  stato.push = [];
  stato.ordine = [];
  stato.risposta = { status: 200, corpo: { ok: true } };
  avvisi.success = [];
  avvisi.error = [];
  window.history.replaceState(null, '', '/profile/settings?tab=password');
  (globalThis as Record<string, unknown>).fetch = async () =>
    new Response(JSON.stringify(stato.risposta.corpo), {
      status: stato.risposta.status,
      headers: { 'content-type': 'application/json' },
    });
});

describe('R19-021 · dopo il cambio della password si rientra, e lo si dice', () => {
  it('dopo il 200: sessione del browser chiusa in locale, poi all\'accesso col ritorno alle impostazioni', async () => {
    const s = await cambiaPassword();

    expect(stato.signOut, 'la sessione del browser resta lì, ma sul server è già chiusa: al clic dopo si è fuori senza saperlo').toEqual([
      { scope: 'local' },
    ]);
    expect(stato.push, 'dopo il cambio si resta sulla pagina invece di andare all\'accesso').toEqual([
      '/sign-in?returnTo=%2Fprofile%2Fsettings',
    ]);
    expect(stato.ordine, 'prima si chiude la sessione, poi si va all\'accesso').toEqual(['signOut', 'push']);
    expect(avvisi.success.join(' | '), 'il messaggio deve dire di accedere con la password nuova').toMatch(
      /accedi con quella nuova/i,
    );
    s.smonta();
  });

  it('se la rotta rifiuta il cambio, la sessione resta e non si va da nessuna parte', async () => {
    stato.risposta = { status: 401, corpo: { error: { message: 'Password attuale non corretta' } } };
    const s = await cambiaPassword();

    expect(stato.signOut).toEqual([]);
    expect(stato.push).toEqual([]);
    expect(avvisi.success).toEqual([]);
    expect(avvisi.error.length).toBeGreaterThan(0);
    s.smonta();
  });
});

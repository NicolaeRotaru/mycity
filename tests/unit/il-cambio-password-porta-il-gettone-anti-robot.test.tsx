/**
 * @vitest-environment jsdom
 *
 * Il cambio password (/profile/settings) mostra il riquadro anti-robot e manda il suo gettone a
 * /api/account/cambia-password, che lo passa a Supabase per verificare la password attuale: col
 * CAPTCHA acceso su Supabase quella verifica lo vuole. Dopo ogni tentativo il riquadro si rifà.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { act, type ComponentType } from 'react';
import { accendi } from './aiuti/schermo';

const UTENTE = { id: 'u-1', email: 'anna@example.com' };
const stato = vi.hoisted(() => ({ fetch: [] as Array<{ url: string; corpo: unknown }> }));

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: {
      getUser: async () => ({ data: { user: UTENTE }, error: null }),
      getSession: async () => ({ data: { session: { access_token: 'gettone' } }, error: null }),
      updateUser: async () => ({ data: {}, error: null }),
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
vi.mock('@/lib/auth/uscita', () => ({ esciEVaiAllAccesso: async () => {} }));
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

const w = window as unknown as Record<string, unknown>;
const riquadro = { disegnati: 0, rifatti: 0, richiamo: null as null | ((t: string) => void) };
const chiavePrima = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
let SettingsPage: ComponentType;

beforeAll(async () => {
  // La chiave pubblica di prova di Cloudflare (sempre «passa»): la pagina la legge quando si carica.
  process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = '1x00000000000000000000AA';
  SettingsPage = (await import('@/app/profile/settings/page')).default as ComponentType;
});
afterAll(() => {
  if (chiavePrima === undefined) delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  else process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = chiavePrima;
  delete w.__turnstileLoaded;
  delete w.turnstile;
});

async function aspetta() {
  for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

function scrivi(campo: HTMLInputElement, valore: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(campo, valore);
  campo.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('il cambio password', () => {
  it('manda alla rotta il gettone del riquadro anti-robot, e dopo il riquadro si rifà', async () => {
    w.__turnstileLoaded = true;
    w.turnstile = {
      render: (_el: unknown, opzioni: { callback: (t: string) => void }) => {
        riquadro.disegnati += 1;
        riquadro.richiamo = opzioni.callback;
        return 'riquadro-pwd';
      },
      remove: () => undefined,
      reset: () => {
        riquadro.rifatti += 1;
      },
    };
    window.history.replaceState(null, '', '/profile/settings?tab=password');
    (globalThis as Record<string, unknown>).fetch = async (url: string, init?: RequestInit) => {
      stato.fetch.push({ url: String(url), corpo: init?.body ? JSON.parse(String(init.body)) : null });
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
    };

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
    expect(riquadro.disegnati, 'il modulo del cambio password non disegna il riquadro anti-robot').toBe(1);
    await act(async () => {
      riquadro.richiamo!('gettone-della-password');
      scrivi(campi[0], 'vecchia-123');
      scrivi(campi[1], 'nuovissima-123');
      scrivi(campi[2], 'nuovissima-123');
    });
    const form = campi[0].closest('form') as HTMLFormElement;
    await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    await aspetta();

    const cambi = stato.fetch.filter((f) => f.url.includes('/api/account/cambia-password'));
    expect(cambi).toHaveLength(1);
    expect(cambi[0].corpo).toEqual({
      passwordAttuale: 'vecchia-123',
      nuovaPassword: 'nuovissima-123',
      captchaToken: 'gettone-della-password',
    });
    expect(riquadro.rifatti, 'dopo il tentativo il riquadro non chiede un gettone nuovo').toBe(1);
    s.smonta();
  });
});

/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';

/**
 * R10-001 — Dopo l'accesso con email e password il ritorno vale per tutti i ruoli.
 *
 * Prima amministratore, negozio e fattorino finivano sempre sulla home del ruolo, anche quando
 * la pagina di accesso aveva un `returnTo` (per esempio /accetta-condizioni): il ritorno si
 * perdeva. Qui si monta la pagina vera, si accede con un profilo di ogni ruolo e si guarda dove
 * manda il router. Senza ritorno (o con un ritorno non sicuro, che la pagina ripulisce in '/')
 * resta la home del ruolo, come prima.
 */
const stato = vi.hoisted(() => ({
  cerca: '' as string,
  ruolo: 'buyer' as string,
  destinazioni: [] as string[],
}));
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: {
      setSession: async () => ({ data: {}, error: null }),
      signInWithOAuth: async () => ({ error: null }),
      getSession: async () => ({ data: { session: null }, error: null }),
      getUser: async () => ({ data: { user: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({ single: async () => ({ data: { role: stato.ruolo }, error: null }) }),
      }),
    }),
  },
}));
vi.mock('sonner', () => ({
  toast: { error: () => undefined, success: () => undefined, info: () => undefined, warning: () => undefined },
}));
const router = vi.hoisted(() => ({
  push: (dove: string) => { stato.destinazioni.push(dove); },
  replace: () => undefined,
  refresh: () => undefined,
  prefetch: () => undefined,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(stato.cerca),
  usePathname: () => '/sign-in',
}));
vi.mock('next/link', () => ({
  default: ({ children, href, ...resto }: { children: unknown; href: unknown } & Record<string, unknown>) =>
    createElement('a', { ...resto, href: String(href) }, children as never),
}));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('@/components/Turnstile', () => ({ default: () => null }));
vi.mock('@/lib/analytics/events', () => ({ trackSignedIn: () => undefined, trackErrorShown: () => undefined }));
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const { default: Accesso } = await import('@/app/sign-in/page');

const aspetta = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };

function scrivi(campo: HTMLInputElement, valore: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(campo, valore);
    campo.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
}

/** Accede con email e password dalla pagina vera; torna l'indirizzo passato al router. */
async function accediCome(ruolo: string, cerca: string): Promise<string | undefined> {
  stato.ruolo = ruolo;
  stato.cerca = cerca;
  const div = document.createElement('div');
  document.body.appendChild(div);
  const root = createRoot(div);
  await act(async () => { root.render(createElement(Accesso)); });
  await aspetta();
  scrivi(div.querySelector<HTMLInputElement>('#signin-email')!, 'persona@esempio.it');
  scrivi(div.querySelector<HTMLInputElement>('#signin-password')!, 'giusta123');
  const modulo = div.querySelector<HTMLFormElement>('form')!;
  await act(async () => {
    modulo.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  });
  await aspetta();
  act(() => root.unmount());
  div.remove();
  return stato.destinazioni.at(-1);
}

beforeEach(() => {
  stato.destinazioni = [];
  vi.stubGlobal('fetch', async () => ({
    ok: true,
    status: 200,
    headers: new Headers(),
    json: async () => ({
      user: { id: 'utente-1', email_confirmed_at: '2026-11-01T10:00:00Z' },
      session: { access_token: 'a', refresh_token: 'r' },
    }),
  }));
});
afterEach(() => { vi.unstubAllGlobals(); });

const verso = (p: string) => `returnTo=${encodeURIComponent(p)}`;

describe('R10-001 — il ritorno dopo l\'accesso vale per ogni ruolo', () => {
  it.each(['admin', 'seller', 'rider', 'buyer'])('%s con ritorno verso /accetta-condizioni ci torna', async (ruolo) => {
    expect(await accediCome(ruolo, verso('/accetta-condizioni?next=/checkout'))).toBe('/accetta-condizioni?next=/checkout');
  });

  it('il negozio rimandato da una sua pagina ci torna, non sulla dashboard', async () => {
    expect(await accediCome('seller', verso('/seller/products/import'))).toBe('/seller/products/import');
  });

  it.each([
    ['admin', '/admin'],
    ['seller', '/seller/dashboard'],
    ['rider', '/rider'],
    ['buyer', '/'],
  ])('senza ritorno %s va dove andava prima (%s)', async (ruolo, casa) => {
    expect(await accediCome(ruolo, '')).toBe(casa);
  });

  it.each(['//sito-cattivo.example/x', '/\\sito-cattivo.example', 'javascript:alert(1)', 'https://sito-cattivo.example'])(
    'un ritorno non sicuro (%s) non porta fuori: il negozio va sulla sua dashboard',
    async (cattivo) => {
      expect(await accediCome('seller', verso(cattivo))).toBe('/seller/dashboard');
    },
  );
});

/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';

/**
 * R23-006 — Dopo l'accesso con email e password il ritorno si riconosce dal percorso risolto.
 *
 * '/rider/..', '/admin/../', '/.' portano su '/', e '/%73eller/dashboard' su /seller/dashboard:
 * la pagina guardava la stringa, quindi non li riconosceva come '/' o come area di un altro ruolo e
 * il portiere rimandava sulla home del sito invece che sulla home del ruolo. Qui si monta la pagina
 * vera, si accede con un profilo di ogni ruolo e si guarda dove manda il router.
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
async function accediCome(ruolo: string, ritorno: string): Promise<string | undefined> {
  stato.ruolo = ruolo;
  stato.cerca = `returnTo=${encodeURIComponent(ritorno)}`;
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

describe('R23-006 — il ritorno dopo l\'accesso guarda il percorso risolto', () => {
  it.each([
    ['rider', '/rider/..', '/rider'],
    ['admin', '/admin/../', '/admin'],
    ['seller', '/.', '/seller/dashboard'],
    ['seller', '/seller/%2e%2e?x=1', '/seller/dashboard'],
  ])('%s con ritorno %s (che porta su «/») va sulla sua home', async (ruolo, ritorno, casa) => {
    expect(await accediCome(ruolo, ritorno)).toBe(casa);
  });

  it('il fattorino con ritorno «/%73eller/dashboard» (l\'area del negozio scritta in codice) va sulla sua home', async () => {
    expect(await accediCome('rider', '/%73eller/dashboard')).toBe('/rider');
  });

  it('il negozio con ritorno «/x/../admin/utenti» (l\'area amministratore) va sulla sua dashboard', async () => {
    expect(await accediCome('seller', '/x/../admin/utenti')).toBe('/seller/dashboard');
  });

  it('un ritorno che si risolve nell\'area del proprio ruolo resta com\'è', async () => {
    expect(await accediCome('seller', '/%73eller/products')).toBe('/%73eller/products');
    expect(await accediCome('rider', '/accetta-condizioni?next=/checkout')).toBe('/accetta-condizioni?next=/checkout');
  });

  it('il cliente non cambia: va dove dice il ritorno', async () => {
    expect(await accediCome('buyer', '/rider/..')).toBe('/rider/..');
  });
});

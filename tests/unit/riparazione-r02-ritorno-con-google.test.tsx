/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';

/**
 * R02-010 — Il ritorno dopo l'accesso non perde ?tab=, neanche con Google.
 *
 * Il portiere (middleware) porta già percorso e query in `returnTo`, e l'accesso con email e
 * password ci torna. Il pulsante Google invece mandava a /auth/callback senza `next`: chi apriva
 * l'email «Annulla la cancellazione» e entrava con Google finiva sulla home, non su
 * /profile/settings?tab=… . Qui si monta la pagina vera di accesso, si spunta la casella dei
 * Termini, si preme Google e si guarda l'indirizzo di ritorno che parte verso Google.
 */
const stato = vi.hoisted(() => ({
  ritorno: '' as string,
  cerca: '' as string,
}));
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: {
      signInWithOAuth: async (opz: { options?: { redirectTo?: string } }) => {
        stato.ritorno = String(opz.options?.redirectTo ?? '');
        return { error: null };
      },
      getSession: async () => ({ data: { session: null }, error: null }),
      getUser: async () => ({ data: { user: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
    },
  },
}));
vi.mock('sonner', () => ({
  toast: { error: () => undefined, success: () => undefined, info: () => undefined, warning: () => undefined },
}));
const router = vi.hoisted(() => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined, prefetch: () => undefined }));
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

const aspetta = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };

/** Entra con Google dalla pagina vera; torna il `next` dell'indirizzo di ritorno (o null). */
async function entraConGoogle(): Promise<string | null> {
  const div = document.createElement('div');
  document.body.appendChild(div);
  const root = createRoot(div);
  await act(async () => { root.render(createElement(Accesso)); });
  await aspetta();
  const spunta = [...div.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find((c) =>
    /Termini/.test(c.closest('label')?.textContent ?? ''),
  );
  expect(spunta, 'controprova: la spunta dei Termini sotto Google deve essere a video').toBeTruthy();
  await act(async () => { spunta!.click(); });
  const google = [...div.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === 'Google');
  expect(google, 'controprova: il pulsante Google deve essere a video').toBeTruthy();
  await act(async () => { google!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await aspetta();
  act(() => root.unmount());
  div.remove();
  expect(stato.ritorno, 'controprova: il pulsante deve partire verso Google').not.toBe('');
  const url = new URL(stato.ritorno);
  expect(url.pathname).toBe('/auth/callback');
  return url.searchParams.get('next');
}

beforeEach(() => { stato.ritorno = ''; stato.cerca = ''; });

describe('R02-010 — con Google si torna dove si era, query compresa', () => {
  it('da /profile/settings?tab=danger si torna su ?tab=danger', async () => {
    stato.cerca = `returnTo=${encodeURIComponent('/profile/settings?tab=danger')}`;
    expect(await entraConGoogle()).toBe('/profile/settings?tab=danger');
  });

  it('un ritorno verso un altro sito non parte: la pagina lo ripulisce prima', async () => {
    stato.cerca = `returnTo=${encodeURIComponent('//sito-cattivo.example/x')}`;
    expect(await entraConGoogle()).toBeNull();
  });

  it('senza ritorno (la home) non si aggiunge niente', async () => {
    expect(await entraConGoogle()).toBeNull();
  });
});

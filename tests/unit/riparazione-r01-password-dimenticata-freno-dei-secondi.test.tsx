/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';

/**
 * R01-004 — «Password dimenticata?» premuto due volte entro un minuto: Supabase risponde 429
 * «For security purposes, you can only request this after 37 seconds» (codice
 * `over_email_send_rate_limit`). La traduzione condivisa non lo conosceva, e il ripiego della
 * pagina di accesso diceva «Accesso non riuscito. Riprova.»: la persona non sapeva né che il link
 * era già partito né quanto aspettare. Ora lo dice in italiano, coi secondi.
 * Qui si monta la pagina vera di accesso, con Supabase finto.
 */
const stato = vi.hoisted(() => ({
  risposta: { error: null as unknown },
  errori: [] as string[],
  successi: [] as string[],
}));
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: {
      resetPasswordForEmail: async () => stato.risposta,
      getSession: async () => ({ data: { session: null }, error: null }),
      getUser: async () => ({ data: { user: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
    },
  },
}));
vi.mock('sonner', () => ({
  toast: {
    error: (m: string) => { stato.errori.push(m); },
    success: (m: string) => { stato.successi.push(m); },
    info: () => undefined,
    warning: () => undefined,
  },
}));
const router = vi.hoisted(() => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined, prefetch: () => undefined }));
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(''),
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

/** Un errore come lo crea supabase-js (AuthApiError è un Error col codice e lo stato). */
const erroreDiSupabase = (message: string, code: string) => Object.assign(new Error(message), { code, status: 429, name: 'AuthApiError' });

async function chiediIlLink() {
  const div = document.createElement('div');
  document.body.appendChild(div);
  const root = createRoot(div);
  await act(async () => { root.render(createElement(Accesso)); });
  await aspetta();
  const email = div.querySelector<HTMLInputElement>('#signin-email');
  expect(email, 'controprova: il campo email deve essere a video').toBeTruthy();
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(email, 'maria.rossi@esempio.it');
    email!.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const pulsante = [...div.querySelectorAll('button')].find((b) => /Password dimenticata\?/.test(b.textContent ?? ''));
  expect(pulsante, 'controprova: «Password dimenticata?» deve essere a video').toBeTruthy();
  await act(async () => { pulsante!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await aspetta();
  act(() => root.unmount());
  div.remove();
}

beforeEach(() => { stato.errori = []; stato.successi = []; });

describe('R01-004 — il freno dei secondi su «Password dimenticata?»', () => {
  it('«after 37 seconds» arriva in italiano, coi secondi da aspettare', async () => {
    stato.risposta = { error: erroreDiSupabase('For security purposes, you can only request this after 37 seconds.', 'over_email_send_rate_limit') };
    await chiediIlLink();
    expect(stato.errori, 'controprova: la pagina deve dire qualcosa').toHaveLength(1);
    const frase = stato.errori[0];
    expect(frase).not.toMatch(/for security purposes|seconds/i);
    expect(frase).not.toBe('Accesso non riuscito. Riprova.');
    expect(frase).toMatch(/37 secondi/);
  });

  it('con un secondo solo la frase resta italiana', async () => {
    stato.risposta = { error: erroreDiSupabase('For security purposes, you can only request this after 1 second.', 'over_email_send_rate_limit') };
    await chiediIlLink();
    expect(stato.errori[0]).toMatch(/1 secondo\b/);
  });

  it('il tetto orario del progetto (stesso codice, altro testo) resta quello di prima', async () => {
    stato.risposta = { error: erroreDiSupabase('email rate limit exceeded', 'over_email_send_rate_limit') };
    await chiediIlLink();
    expect(stato.errori[0]).toBe('In questo momento non riusciamo a mandare email: riprova fra qualche minuto.');
  });
});
